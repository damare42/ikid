# Taking ikid online — the plan, and the current decision

The tactical companion to `GO-PUBLIC.md`. Rewritten after a review of what has
actually been built since the first draft, which turned out to be most of one
phase and none of another.

## The decision, September 2026

**Move the site and demo to a domain we own, on GitHub Pages. Defer the hosted
app.**

Runbook: `docs/CUSTOM-DOMAIN.md`. It is an hour of work, ~$12/yr, and entirely
reversible.

The reasoning is that these are two different projects wearing one word,
"online". The site is a static page and a browser demo with no accounts, no
server and no data — putting it on a real domain is a DNS change and a
one-file config edit. The hosted app means holding other people's financial
records on a machine we operate, which is a different undertaking with a
different risk profile and no way to undo it once someone has trusted it with
their data.

Doing the cheap half now costs nothing that the expensive half would need
later, and buys the thing actually asked for: an address that isn't a GitHub
username. Keeping `app.<domain>` unused keeps the other half open.

---

## Where this actually is

Written against the code, not the original plan's guesses.

### Built

**Deployment.** Dockerfile, `deploy/docker-compose.prod.yml`, a Caddyfile with
automatic HTTPS and a locked-down CSP, and `deploy/backup.sh`. Documented end
to end in `docs/DEPLOY-ONLINE.md` for both a VPS and Fly.io.

**Hardening.** `IKID_REQUIRE_AUTH`, `IKID_SECURE_COOKIES`, `IKID_TRUST_PROXY`,
`IKID_ORIGIN` for CORS. Rate limiting on `/api/auth` and `/api` with separate
budgets. scrypt password hashing with per-credential salts and an in-place
upgrade path. CodeQL in CI, scoped so its output is readable.

**Accounts.** Per-request profile routing, so every account is a physically
separate database — isolation by construction rather than by a `WHERE` clause
anyone can forget. Admin roles, account disable, session revocation, a
sign-up toggle, first-account-becomes-admin bootstrap.

**Data portability.** `GET /api/settings/export` and `export.json`, plus
backup and restore.

**The public face.** Landing page, and a demo that runs the real client against
an in-browser API. 595 tests.

### Not built — and these are the gate

**No email address on an account.** Not a missing feature so much as a missing
column, and everything for public sign-up hangs off it: verification, password
reset, breach notification, and any way to tell a user anything. Today a
forgotten password means the data is gone, permanently. That is defensible for
software you installed yourself. It is not defensible for a service someone
signed up for.

**No account deletion.** Admin can disable an account; nothing hard-deletes it.
Right-to-delete is table stakes for a finance service and legally required in
several places.

**No CSRF protection.** Session auth is cookie-based, and there is no token on
state-changing routes. Same-site cookie attributes cover much of it in current
browsers, but "mostly, by default, in recent versions" is not a control.

**No 2FA**, and no privacy policy, terms, or telemetry consent.

So the original plan's Phase 1 is essentially done and Phase 2 has not been
started. That is a comfortable place to pause, which is the other half of why
pausing here is the right call.

---

## Trust model — unchanged, and worth restating

| Model | Server sees your data? | Effort | Status |
|---|---|---|---|
| **A. Self-host only** | Only your own server | Done | Where we are |
| **B. Managed, encrypted at rest** | Yes, to run the engines | 3–5 weeks | Deferred |
| **C. Zero-knowledge (E2EE)** | No — ciphertext only | High | North star |

A is shipped. B is the real "online" work. C stays documented rather than built
because it breaks the server-side engines — import parsing, the planner and the
analytics all run on plaintext today. Interestingly, the demo has since proved
the C architecture is *possible*: it runs the whole client, including every
financial engine, entirely in the browser against no server. That does not make
C cheap, but it does mean it is no longer hypothetical.

Nothing in the custom-domain move forecloses any of these.

---

## If and when the app gets hosted

Roughly ordered by what blocks what. Sizes are rough.

### Stage 1 — private, invited people only (about a day)

Nothing new to build. Run the existing image on a small VM or Fly, with
`IKID_REQUIRE_AUTH=1`, `IKID_SECURE_COOKIES=1`, a persistent volume at
`/app/database`, sign-ups turned off, and `deploy/backup.sh` on a cron.
`docs/DEPLOY-ONLINE.md` is the runbook. Point `app.<domain>` at it.

This is the natural next step after the domain, and it carries almost no risk:
the only people affected are people who were told about it.

### Stage 2 — the account layer (2–3 weeks)

The gate list above, roughly in dependency order:

- [ ] `email` on accounts, unique, verification required before first login
- [ ] Password reset by single-use emailed token, ~30-minute expiry
- [ ] An outbound mail path — first-party SMTP or one provider, and note in
      `PRINCIPLES.md` that an email address now leaves the box, because it does
- [ ] Self-serve account deletion that actually hard-deletes the profile
      database, the account record and the analytics rows
- [ ] CSRF tokens on state-changing routes, or move to bearer tokens with CORS
      locked down
- [ ] Sign-up rate limiting and exponential lockout on repeated failures
- [ ] Optional TOTP 2FA with recovery codes
- [ ] Visible active-session list and "log out everywhere"

### Stage 3 — the things that make it lawful (about a week)

Privacy policy, terms, telemetry consent defaulting to off, error reporting
with scrubbing (route names and stack traces, never bodies or amounts), and an
amendment to `PRINCIPLES.md` stating plainly what a hosted instance stores and
why. That last one is a deliberate edit, per the manifesto's own rule — the
document is allowed to change, but not quietly.

### Stage 4 — before strangers (days, plus the audit)

Tenant-isolation review, a restore-from-backup drill against a real backup, a
load test, an incident runbook, and a security review by someone who did not
write the code.

### Storage

Stay on SQLite-per-user on a persistent volume. It is what the desktop and
Docker builds already do, isolation is physical, and it is good to low
thousands of accounts. Postgres with `tenant_id` and row-level security is the
answer when concurrency or ops pain demands it, and the seam is
`lib/prisma.ts` plus `server/src/repositories/` — services and routes never
touch the database directly, so the migration stays contained. Do not pre-pay
for it.

---

## What would change the decision

Written down so the pause is a position rather than a drift:

- Someone who is not us wants to use it and cannot self-host. That is the
  signal that Stage 2 is worth three weeks.
- Wanting our own data across two machines. Stage 1 alone solves it, today.
- Nothing else. Not a tidier architecture, not the domain sitting there looking
  empty.
