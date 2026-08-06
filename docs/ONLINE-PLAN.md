# Taking ikid online — an implementation plan (without losing the principles)

This is the tactical companion to `GO-PUBLIC.md`. It maps a concrete build
path onto ikid's actual code, so "hosted" never quietly becomes "surveilled."

## The north star — what "same principles online" means

1. **Self-host stays first-class.** The Docker/local build is never second
   best. Privacy-maximalists run their own instance; that option never dies.
2. **Per-user isolation is absolute.** One user can never see another's data —
   already true via per-request profile routing.
3. **First-party only.** No third-party analytics, ad networks, or data
   brokers. Ever. (PRINCIPLES rule 1 survives.)
4. **Encryption in transit and at rest**, with an optional zero-knowledge tier
   for people who want the server to hold only ciphertext.
5. **Consent, export, delete.** Telemetry is opt-in, financial-data-free, and
   aggregate. Every user can download everything and delete their account.

## Decision 1 — the trust model (pick the destination first)

| Model | Server sees your data? | Features | Effort | Best for |
|---|---|---|---|---|
| **A. Self-host only** | Only your own server does | All | ~Done | Privacy maximalists, you today |
| **B. Managed, encrypted at rest** | Yes, to run planner/analytics server-side | All | Medium | Most people who want "just log in from anywhere" |
| **C. Zero-knowledge (E2EE)** | No — only ciphertext | Limited (compute moves to the browser) | High | The "never trust the host" crowd |

**Recommendation: ship A now (you're ~90% there), then B for real online
use, and keep C as a documented north-star.** C is the purest expression of
the principles, but it breaks the server-side engines (planner, analytics,
import parsing all run on plaintext today) — you'd have to move that math into
the browser. Do C later as an optional "private vault" mode if there's demand,
not as the v1 blocker.

Everything below assumes the **A → B** path.

## Decision 2 — the data store

Today each user is a separate SQLite file plus JSON side-stores
(`accounts.json`, `sessions.json`, `analytics.jsonl`). Two ways to host:

- **Keep SQLite-per-user** (e.g. with LiteFS/Litestream for replication). Least
  code change; isolation is physical. Works well to low-thousands of users.
- **Migrate to Postgres, one schema, `tenant_id` on every row + row-level
  security.** The scalable, standard multi-tenant answer.

**Recommendation:** start B on **SQLite-per-user on a persistent volume** (tiny
change — it's what the desktop/Docker build already does), and only move to
Postgres when concurrency or ops pain demands it. The repository layer
(`server/src/repositories/`) and the `prisma` proxy in `lib/prisma.ts` are the
single seam you'd swap — services and routes don't touch the DB directly, so
the migration stays contained.

## The phased plan

### Phase 0 — where you are
Local + accounts + admin + local, financial-data-free analytics. Done.

### Phase 1 — Self-host beta (days, not weeks)
Goal: you (and a few invited people) use it from anywhere, safely.

- Run the existing Docker image on a small VM (Fly.io, Render, a $5 VPS).
- Put it behind HTTPS (Caddy or a platform-managed cert). Set
  `IKID_SECURE_COOKIES=1`.
- Force auth: `IKID_REQUIRE_AUTH=1` (already supported).
- Close open registration: Admin → toggle **Allow new sign-ups** off; invite
  people by creating their accounts.
- Persist `/app/database` on a real volume; turn on daily volume snapshots.
- Verify the multi-profile schema push on boot (already added) covers everyone.

Files touched: none new — this is config + ops. `docs/DEPLOY.md` already covers
most of it.

### Phase 2 — Managed multi-tenant (the real "online" work)
Goal: strangers can sign up and it stays isolated and safe.

Auth hardening (extend `authService.ts` / `routes/auth.ts`):
- Email + password sign-up (add an `email` field to the account store).
- Email verification and password reset (needs an outbound email provider —
  first party, e.g. your own SMTP/Postmark; verification tokens only, no PII to
  third parties beyond the email address you must send to).
- Rate-limit login (partly done) and sign-up; add lockout backoff.
- Optional TOTP 2FA.
- Session revocation (done — `destroySessionsFor`), plus "log out everywhere."
- CSRF review for cookie auth, or move to `Authorization: Bearer` tokens.

Tenancy & storage:
- If staying on SQLite-per-user: nothing structural changes; just ensure the
  data volume is durable and backed up, and cap per-account DB size.
- If moving to Postgres: add `tenant_id`, enable row-level security, and swap
  `clientFor(profile)` for a tenant-scoped client. This is the one real
  refactor — isolated to `lib/prisma.ts` + repositories.

Encryption at rest:
- Volume/disk encryption at minimum (most hosts offer it).
- Optional field-level encryption for the most sensitive columns
  (transaction descriptions, notes) with a per-user key derived from their
  password at login — a stepping stone toward Model C.

### Phase 3 — Consent, telemetry, and legal
- **Telemetry consent banner**, defaulting to the deployment's stance; the
  local analytics layer already records only feature events — point it at the
  server and gate it behind the user's choice.
- **In-app feedback** (thumbs + text), voluntary.
- **Privacy policy + terms**, a cookie/telemetry notice, and self-serve
  **data export** (JSON of the user's own data) and **account deletion**
  (hard-delete their DB/rows + analytics). These are table stakes and, in some
  places, legally required for a finance app.
- **Error reporting** with scrubbing — stack traces and route names only,
  never request bodies or financial fields.

### Phase 4 — Security review & launch
- Third-party (or serious self-run) audit: tenant isolation / IDOR, injection,
  session fixation, dependency CVEs, secrets handling.
- Load test, backup-restore drill, incident runbook.
- Amend `PRINCIPLES.md` to state plainly what the hosted version stores and why
  — a deliberate edit, per the manifesto's own rule.

## Auth hardening checklist (Phase 2, concrete)

- [ ] `email` on accounts; unique; verification required before first login
- [ ] Password reset via emailed single-use token (30-min expiry)
- [ ] Argon2id or keep scrypt with higher params; per-user salt (have)
- [ ] Sign-up + login rate limits and exponential lockout
- [ ] Optional TOTP 2FA + recovery codes
- [ ] "Log out everywhere" and a visible active-session list
- [ ] Secure, HttpOnly, SameSite cookies over HTTPS only (flags exist)
- [ ] CSRF token on state-changing routes (or Bearer tokens + CORS lockdown)

## Cost & effort sketch

- **Phase 1:** an afternoon + ~$5–20/mo hosting.
- **Phase 2:** the bulk — 2–4 focused weeks for email flows, tenancy, and
  encryption, depending on SQLite-per-user vs Postgres.
- **Phase 3:** ~1 week for consent/export/delete + legal copy.
- **Phase 4:** a few days plus the audit (external audits cost real money;
  budget for one before public launch).

## What to build first (this week)

1. Stand up Phase 1 on a VM with HTTPS, `IKID_REQUIRE_AUTH=1`, invite-only.
   You'll be "online" immediately, with zero principle compromises.
2. Add an `email` field + verification scaffold to the account store — the
   foundation every later phase needs.
3. Add self-serve **export** and **delete** endpoints — cheap now, and they
   force the isolation guarantees to stay honest.

Do those three and you have a private, hosted, principled ikid you can use from
anywhere — with a clear, de-risked path to opening it up when you're ready.
