# Going public: what it would take, and what it would cost

ikid was built local-first: your data lives on your machine, nothing leaves.
This document is for the deliberate decision of whether — and how — to offer a
hosted, public version, and what the admin/analytics layer added in 0.5.0 does
and doesn't change.

> **This touches the manifesto.** `docs/PRINCIPLES.md` lists "cloud accounts",
> "telemetry", and "usage analytics" under *What we will never build*. The
> admin + usage-analytics layer is a conscious step toward the "carefully"
> and "never" columns. Per PRINCIPLES' own rule — *"when a change would require
> editing this file, that's a fork in the project's identity"* — shipping a
> public version means amending PRINCIPLES on purpose, not drifting into it.
> The design below is built to stay as close to the original spirit as
> possible: local by default, first-party only, opt-in, and auditable.

## What the 0.5.0 admin layer actually does

- **Accounts already existed.** Each profile is a separate SQLite database with
  its own password. 0.5.0 adds a central `accounts.json` with a role
  (`admin`/`user`), an enabled flag, and timestamps. The first account created
  becomes the admin; an existing install adopts its active profile as admin
  (override with `IKID_ADMIN=<profile>`).
- **Usage analytics are local and financial-data-free.** `analytics.jsonl`
  records feature *events* — "opened Retirement", "ran an import" — with a
  timestamp and which account. It never records amounts, merchants, categories,
  balances, or any transaction content. The admin dashboard aggregates counts.
- **Isolation holds.** Admins manage accounts and see aggregate usage. They
  **cannot** open another user's financial data — the per-request database
  routing that powers the whole app still applies. "First user = admin; manage
  others, not their data."
- **Still no third-party calls.** Everything above is first-party and stays on
  the machine/server. PRINCIPLES rule 1 ("no network calls to third parties")
  is intact. What changes is that *usage analytics now exist at all* — a
  first-party, on-box form of the thing the manifesto's "never" list named.

On your own machine this is just self-insight. It only becomes a privacy
question if you host it for other people — which is the actual decision.

## The honest tension

Local-first isn't literally "no data ever." Its real promise is: **no data
leaves without the user's knowledge and consent, and never to third parties.**
A public version can still honor that — but only if you make consent explicit
rather than assumed. The difference between acceptable and not is entirely in
the defaults and disclosures.

## How to get quality signal without betraying users

1. **Opt-in, aggregate-only telemetry.** Feature-usage counts and error rates,
   never financial values. A visible toggle, defaulting appropriately for the
   deployment (off for privacy-max, on with a clear notice for the hosted app).
   The 0.5.0 analytics layer is already shaped for this — point it at the
   server instead of a local file.
2. **In-app feedback, actively submitted.** A thumbs up/down + free-text box.
   Voluntary, so it's disclosure, not surveillance.
3. **Error reporting with scrubbing.** Stack traces and route names only —
   never request bodies, never financial fields.
4. **Self-hosting stays the escape hatch.** Like Obsidian or standard notes
   apps: offer a hosted version *and* a fully-local one. Privacy-conscious
   users self-host; everyone else uses the cloud with clear consent. The
   codebase already supports both because data routing is per-profile.

## What a hosted, multi-tenant version would require

Roughly in order of effort:

- **Shared database.** Replace the per-profile SQLite files with one server
  database (Postgres), keyed by user ID, with row-level tenancy so a query can
  never cross users. `accounts.json` → a `users` table; `analytics.jsonl` → an
  `events` table. The service seams are already isolated (`accountService`,
  `usageService`) to make this a swap rather than a rewrite.
- **Real auth hardening.** Email verification, password reset via email,
  rate-limited login (partly done), optional 2FA, session revocation (done),
  CSRF review for cookie auth, and `IKID_SECURE_COOKIES=1` behind HTTPS.
- **Legal + consent.** A privacy policy, terms, a cookie/telemetry consent
  banner, and a data-export + delete path (GDPR/CCPA "download my data" and
  "delete my account"). Non-negotiable for a public finance app.
- **Infrastructure.** Managed Postgres with encryption at rest, automated
  backups, HTTPS/reverse proxy, monitoring, and a plan for secrets.
- **Abuse & cost controls.** Sign-up gating (the `allowSignups` toggle exists),
  per-account storage limits, and import size/rate limits.
- **Security review.** A finance app is a target. Budget for a real audit
  before launch: injection, IDOR/tenancy leaks, session fixation, dependency
  CVEs.

## A staged path

1. **Now (0.5.0):** admin + local analytics on the single-owner install.
   Proves the model, costs nothing, leaks nothing.
2. **Small hosted pilot:** same code on a server with `IKID_REQUIRE_AUTH=1`,
   invite-only (`allowSignups` off), HTTPS, backups. Postgres optional at this
   size; the SQLite-per-profile model still works for a handful of trusted
   users.
3. **Public launch:** shared Postgres, email flows, consent + legal, opt-in
   telemetry, security audit, and an amended PRINCIPLES.md that states plainly
   what the hosted version collects and why.

Keep the local/self-hosted build first-class the whole way. The moment the
hosted version becomes the only option is the moment ikid becomes the thing it
was built to escape.
