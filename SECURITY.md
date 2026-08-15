# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's [Security Advisories](https://github.com/damare42/ikid/security/advisories/new)
("Report a vulnerability" on the Security tab). If that isn't available to you,
email the address on the repository owner's GitHub profile.

Please include: what you found, how to reproduce it, and what an attacker could
achieve. A proof of concept helps a lot.

**Response:** I aim to acknowledge within 5 working days and to ship a fix or a
mitigation plan within 30 days for anything exploitable. This is a small
project maintained in spare time — I'd rather set an honest expectation than a
flattering one. You'll be credited in the advisory unless you'd prefer not.

## Supported versions

Only the latest released version receives security fixes.

| Version | Supported |
| --- | --- |
| 0.6.x | ✅ |
| < 0.6 | ❌ |

## Threat model — what ikid is and isn't

ikid is **local-first**: it runs on your machine (or a server you control) and
stores everything in SQLite files on that machine. There is no ikid-operated
backend, no cloud account, and no third-party analytics. See `docs/PRINCIPLES.md`.

**In scope**

- Authentication and session handling (scrypt password hashing, session
  cookies, rate limiting, lockout)
- Cross-account data leakage — one signed-in user reaching another user's data
- Privilege escalation (a `user` gaining `admin` capability)
- Injection, path traversal, or SSRF in the import pipeline (CSV/PDF parsing)
- XSS in any rendered transaction/merchant/notes field
- Anything that causes user financial data to leave the machine
- Supply-chain issues in shipped dependencies

**Out of scope**

- Attacks requiring an already-compromised host or OS account. If someone has
  your filesystem, they have the SQLite files; ikid does not defend against
  that and does not claim to.
- Physical access to an unlocked machine
- Denial of service against your own single-user instance
- Vulnerabilities in Ollama (optional, user-installed, runs locally)
- Missing hardening in a deployment that ignores `docs/DEPLOY-ONLINE.md` (for
  example, exposing the app to the internet without HTTPS or without
  `IKID_REQUIRE_AUTH=1`)

## Security properties you can rely on

- **Passwords** are hashed with scrypt (N=16384) and a per-account random salt.
  Verification is timing-safe. Plaintext passwords are never stored or logged.
- **Sessions** are 32-byte random tokens in `HttpOnly; SameSite=Strict`
  cookies — unreadable from JavaScript. `IKID_SECURE_COOKIES=1` adds `Secure`
  for HTTPS deployments.
- **Login** is rate limited (5 failures → 30s lockout, per account).
- **Isolation** is physical: each account is its own SQLite database file, and
  every request is bound to the signed-in account, so a query cannot cross
  accounts. Admins can manage accounts but cannot read another account's
  financial data.
- **Errors** never leak stack traces, file paths, or credentials to the client
  (covered by tests in `server/src/tests/errors.test.ts`).
- **Analytics**, when enabled, record feature events only — never amounts,
  merchants, categories, or any transaction content.

## Deploying safely

If you host ikid for more than yourself, follow `docs/DEPLOY-ONLINE.md`. The
non-negotiables:

- `IKID_REQUIRE_AUTH=1` — never run a networked instance in open mode
- HTTPS in front of it, with `IKID_SECURE_COOKIES=1` and `IKID_TRUST_PROXY=1`
- Turn off open sign-ups in Admin unless you intend a public instance
- Back up the data volume somewhere encrypted — backups contain real financial
  data and password hashes
