# Changelog

## 0.6.0 — redesign & accessibility

Visual overhaul to the "Modernist" design system, plus a measured accessibility
pass. No feature was removed — every screen keeps its full functionality.

**Redesign**

- New design language: brick-red accent, warm neutral palette, Archivo
  typography, square structure with 9px only on interactive chrome
- Sidebar rail rebuilt at 222px with three collapsible groups — **Money**
  (Dashboard, Transactions, Accounts, Budgets, Goals), **Plan** (Net Worth,
  Planner, Calculators, Retirement), **Insight** (Analytics, Reports); open
  state persists
- Settings, Admin, Sign out, and profile switching moved into a header avatar
  menu; 64px header with a section kicker and centred search
- Transactions gained a header kicker, a pulsing table loading skeleton
  (`aria-busy`), and a filter-aware empty state
- Charts recoloured to semantic tokens; logo recoloured to the accent

**Accessibility (measured, not assumed)**

- Fixed four palettes whose text failed WCAG AA: stock `emerald-600` (3.77:1),
  `rose-500` (3.67:1), `amber-500` (2.15:1) and the app's own `slate-500`
  (2.89:1) — all now clear 4.5:1. For reference the previous brand green was
  2.68:1 on white
- "Money out" is no longer the brand colour: negatives use a distinct crimson,
  so a primary button and a loss never read the same
- Active nav is no longer signalled by colour alone (accent text **plus** a 2px
  left rule and heavier weight), per WCAG 1.4.1
- Small-caps kicker labels raised from 10px to 12px
- **25 contrast regression tests** pin every text token in light and dark, so a
  future palette tweak can't silently reintroduce unreadable text

**Robustness**

- Setup failures now return actionable 503s instead of a bare
  "Internal server error": ungenerated database client, an engine binary that
  won't load on this machine, and an unreachable data folder each explain the
  fix. Unexpected errors still return a generic 500 and never leak internals
- Covered by error-handler tests, including a check that error payloads can't
  leak stack traces or credentials

**Security**

- Password hashing strengthened from Node's scrypt defaults (N=16384) to
  **N=65536, r=8, p=2** — 4× the memory hardness, and slightly *faster* thanks
  to `p=2`. Cost parameters are now stored with each hash, so existing
  passwords keep working and are transparently upgraded at the next login.
  Nobody is locked out and nobody needs to reset anything
- `SECURITY.md` with a private reporting path, an explicit threat model, and a
  table mapping each stated guarantee to the test that enforces it
- Dependabot, CodeQL scanning, least-privilege CI tokens, plus CI gates that
  fail on high-severity production advisories or any committed user data
- Patched 6 dependency advisories (13 → 7; every remaining one is dev tooling)
- Audited the rest of the policy's claims against the code: account isolation,
  analytics containing no financial data, no path traversal from upload
  filenames, and no XSS sinks — all verified, now documented

Test suite: **155 passing** (was 116).

## Unreleased

- **React Router 6 → 7, which clears the last production advisory.**
  `npm audit --omit=dev` was reporting 2 moderate vulnerabilities
  (GHSA-337j-9hxr-rhxg, arbitrary constructor injection in React Router's SSR
  hydration) and now reports none. The bug was never reachable here — ikid is
  a client-side SPA on HashRouter and does no SSR — but a standing audit
  finding teaches you to skim past audit findings, which is the actual danger.
  No code changes were needed: every router API this app uses is unchanged.
  Worth noting Dependabot's own PR would *not* have fixed this; it proposed
  6.30.6, still inside the affected range
- Routine in-range dependency updates: papaparse 5.7.0, eslint 9.39.5,
  prettier 3.9.6, tsx 4.23.12, autoprefixer 10.5.4, typescript-eslint 8.68.0
- **Security: profile names can no longer be treated as paths.** A profile name
  becomes a filename on disk, which makes it the one piece of user input in the
  app that can turn into a path. `createProfile` and `renameProfile` sanitised
  it; `switchProfile` didn't, and the login route passes a name straight from
  the request body — so the guarantee held only by convention. `getDbPath` is
  the single place every database path is built, so the check now lives there:
  a name must be a bare filename *and* resolve inside the data directory, or it
  throws. Not known to have been exploitable — `/activate` is refused outright
  once accounts are enabled, and login still requires the password — but that's
  a poor thing to rest a finance app on. 7 new tests, including one asserting
  the guard still accepts everything the sanitiser can produce, so it can't
  drift into locking people out of their own data
- **CodeQL was reporting 253 alerts, mostly because of how we'd pointed it.**
  It was scanning `design/` — standalone design-tool scaffolding that nothing
  imports, including a 1,911-line file whose header reads "GENERATED … do not
  edit" — and running the `security-and-quality` suite, whose quality half
  duplicates the ESLint and TypeScript-strict checks already run on every
  commit. It now runs `security-extended`, a *superset* of the default security
  queries, over app code only (`.github/codeql/codeql-config.yml`). Security
  coverage increased; the noise that made 253 unreadable is gone
- Removed a raw NUL byte that had crept into `exportService.ts` inside the
  `importKey` separator. It worked, but it made the file read as binary to
  grep and diff, and an invisible control character is not a separator anyone
  can review. Written as an explicit escape sequence now
- **Marketing site rebuilt for launch** (`site/`, deployed to GitHub Pages).
  It now makes **zero external requests** — the previous version pulled Archivo
  from Google's font CDN, which handed every visitor's IP to a third party on a
  page whose entire argument is "your data goes nowhere". No fonts, no scripts,
  no trackers; the system font stack does the job. Added CSS illustrations of
  the real import, dashboard, budget and planner screens so the page shows the
  product instead of only describing it; a self-hosted social preview image
  (`og.svg` → `og.png`, regenerate with `site/build-og.sh`); `robots.txt`,
  `sitemap.xml`, `404.html` and `.nojekyll`. Contrast measured on all 30
  foreground/background pairs — light-mode green and amber were darkened
  because they fell to 3.85–4.45:1 against the recessed rows and tinted pills.
  The download CTA now leads with clone/Docker and says plainly that installers
  aren't published, rather than linking to an empty releases page
- Honest-limitations section extended: not finished, not multi-currency, not
  audited. Stale README roadmap replaced — it still listed net worth,
  calculators, merchant normalization and retirement as future work
- New `docs/LAUNCH-RUNBOOK.md` with the ordered steps to go live
- **Sign out** now lands on the public welcome page instead of the sign-in form
  for the profile you just left
- **Landing privacy band** was still the pre-redesign brand green
  (`#0e3d33`) — the only hardcoded hex and only green surface on the page. Now
  the warm near-black already used as the dark panel token
- **Lossless JSON export** (Settings → *Your data — take it anywhere*): one
  human-readable `.json` file containing everything in the profile — accounts,
  categories, merchants, tags, import history, every transaction, rules,
  budgets, goals, assets with their full value history, settings, saved
  calculations and planner conversations. Relations are stored **by name**, not
  by database ID, so the file is diffable in a text editor and imports cleanly
  into a different profile or a rebuilt database. Import comes in two modes:
  **merge** (adds what's missing, skips transactions whose dedupe hash you
  already have — so re-importing is a no-op) and **replace** (wipes the profile
  first, behind a confirmation). Dedupe hashes and each transaction's link to
  its import record survive the round trip, so duplicate detection and "Undo
  import" still work afterwards. The file is treated as untrusted input:
  validated with zod before a single row is written, and rejected with a
  readable message — including a specific one for exports made by a newer
  version. `GET /api/settings/export.json`, `POST /api/settings/import.json`.
  20 unit tests cover round-trip fidelity, null preservation, and junk input
- **Debt payoff planner** (Calculators → 🏔️ Debt payoff): compares **snowball**
  (smallest balance first) against **avalanche** (highest rate first) across all
  your debts at once. Shows the debt-free date, total interest, the balance
  curve, and — crucially — the **focus order**: which debt to attack with spare
  money, as distinct from the order debts happen to clear. Prefills from your
  Net Worth liabilities and credit/loan accounts. Honest about the trade-off:
  when the interest difference is small it says so, because the plan you'll
  actually finish beats the mathematically optimal one you abandon.
  Deterministic and unit-tested (21 tests) per PRINCIPLES rule 2
- Money helpers (`services/money.ts`) for exact cent-based arithmetic, so
  totals no longer accumulate floating-point drift — found by measuring the
  real 1,211-transaction database against CashFlux's "money is never a float"
  principle. See `docs/COMPETITIVE-NOTES.md`

- Import History → assign accounts from the filename: each row now has an Account column that auto-suggests the account matching the filename (e.g. "chase-oct.csv" → Chase, "capital-one…" → Capital One), with an Assign button that links all that import's transactions in one click. A header "✨ Auto-assign by filename" button does every unmatched import at once (`POST /api/imports/:id/assign-account`). Account balances update immediately

- Settings → Import History: the file label is now editable — click the filename (✎) to rename an import (e.g. "chase-oct.csv" → "Chase — October"); Enter saves, Escape cancels. Cosmetic only; transactions are untouched (`PATCH /api/imports/:id`)

- Assign accounts to existing transactions: the Transactions page now has an Account filter (including "Unassigned"), an Account column, checkboxes to select rows, and a bulk bar to assign the selection — or all matching the current filter — to any account in one click (or unassign). Individual transactions also gained an Account picker in the edit dialog (`PATCH /api/transactions/:id` now accepts `accountId`; new `POST /api/transactions/assign-account` for bulk)

- Import duplicate detection tightened: a row is a duplicate only when its **date, amount, description, and merchant all match exactly** (per account). Reference numbers are no longer part of the key — banks fill them inconsistently, which caused both missed and false duplicates. Existing transactions are re-hashed to the new format once, automatically, on the next start (collisions preserved, nothing lost)
- Import review: duplicate-flagged rows can now be kept — tick a row's status to import it anyway, or use "Import all anyway" — so a wrong duplicate label is no longer a dead end (identical look-alikes are stored side by side)

- Hosting (Phase 1 self-host beta): run ikid online behind HTTPS with sign-in required and no principle compromises. Server now honors `IKID_TRUST_PROXY` (X-Forwarded-* behind a reverse proxy) and `IKID_ORIGIN` (CORS lock-down), logs its data dir / profiles / auth mode on startup, and prints a clear message instead of crashing when the port is already in use. New `deploy/` artifacts (Caddy auto-HTTPS reverse proxy, production compose, backup script) and `docs/DEPLOY-ONLINE.md` walk through a VPS+Caddy or Fly.io deploy, invite-only setup, and backups. See `docs/ONLINE-PLAN.md` for the full A→B→(C) roadmap

- Retirement: **penalty-free bridge plan** — back-solves how much penalty-free money you need at retirement (5 years of spending + conversion taxes with a ladder, or the full gap without one), compares it to what you're on track to have, and computes the extra monthly investment (compound growth at your real return) or lump-sum-today needed to close any shortfall, with guidance on which accounts to fill
- Retirement: **Medicare IRMAA awareness** — flags years from age 63 whose income would push MAGI over the first surcharge tier (2026: $109k single / $218k joint), raising Part B/D premiums two years later, and reassures when conversions stay under it; plus an explicit tax-optimal withdrawal-order tip. Strategy explanations moved to hover tooltips so they no longer stretch the page

- Accounts page (🏦): per card/account, shows the latest transaction on file, a freshness badge (today / N days ago / never), transaction count, net on file, and the last import — so you know exactly where each account left off and what to upload next. Accounts needing attention (stale or never imported) sort to the top
- Import dialog now shows the selected account's latest-transaction date and last import inline, with an explicit "upload transactions after \<date\>" resume hint; pages can open the importer preselected to a specific account (`GET /api/accounts/status`, unit-tested assembler)

## 0.5.0 — accounts, admin & usage analytics

- Central account layer over the existing per-profile databases: each profile is an account with a role (admin/user), an enabled flag, and timestamps. The first account created becomes admin; an existing install adopts its active profile (override with `IKID_ADMIN`)
- Admin page (🛡️, admin-only): user counts, new/active users (7d/30d), a most-used-features chart, a 30-day activity trend, and an accounts table — promote/demote, disable/enable, reset password, and toggle open sign-ups. Guards prevent demoting or disabling the last admin
- Local, privacy-preserving usage analytics: records feature events (page views, key actions) only — never amounts, merchants, categories, or any financial data. Stored in an append-only local file; no third-party calls
- Account isolation preserved: admins manage accounts and see aggregate usage but cannot open another user's financial data. Disabling an account or resetting its password ends its sessions immediately
- `docs/GO-PUBLIC.md`: an honest plan for whether/how to offer a hosted version — the local-first tension, opt-in telemetry and feedback, and what a multi-tenant launch would require (this feature deliberately amends the "never build analytics" line in PRINCIPLES.md)

## 0.4.0 — net worth & investing

- Net Worth page (💎): track assets (cash, investments, property, vehicles) and liabilities (mortgage, loans, credit cards) as dated value snapshots — back-datable, one value per day, full history kept
- Net worth history chart (assets vs liabilities bars + net worth line, 24 months, carry-forward between updates) and summary cards with month-over-month change
- Investment holdings can store units × unit price; updating either recomputes the value
- Loans with a rate + monthly payment show a projected payoff date and remaining interest, and warn when the payment doesn't cover interest
- Calculators page (📐): loan amortization (payment, payoff date, total interest, extra-payment savings, principal-vs-interest yearly chart) and compound interest (contributions vs growth over time)
- FIRE calculator (🔥): FIRE number from retirement spending ÷ safe withdrawal rate, projected FIRE age/date from your balance and contributions, portfolio-vs-target chart (real, after-inflation returns keep everything in today's dollars)
- Coast FIRE calculator (🏖️): the amount that compounds to your FIRE number by retirement with zero further contributions — coast number today, gap or surplus, projected coast age against the rising threshold
- Saved calculations: 💾 Save any calculator setup with a name; a history panel beside the calculators reloads or deletes saved scenarios (stored per profile)
- Retirement Planner (🧭): year-by-year early-retirement simulation across Traditional 401k/IRA, Roth (with contribution basis), brokerage (cost-basis-aware LTCG), and HSA — models the age-59½ rule, Roth conversion ladders with 5-year seasoning, RMDs (Uniform Lifetime Table), and a tax-aware withdrawal waterfall
- Federal tax engine with verified 2026 brackets/standard deduction/LTCG thresholds (Rev. Proc. 2025-32), conversion-headroom math for filling low brackets, all unit-tested (federal only, real dollars; constants documented for yearly updates)
- Bridge analysis for retiring before 59½: how much must live in brokerage/Roth basis/HSA, gap detection, penalty flagging, and deterministic funding-order guidance
- Retirement plans can be saved and reloaded (💾 Save plan + saved-plans chips), sharing the per-profile saved-calculations store
- Planner understands investing: "Invest $500 a month at 7% for 20 years" runs the deterministic compound engine with a contributions-vs-balance chart
- Dashboard shows a Net Worth card (once you've added assets) that links to the new page
- New pure `finmath` engine (amortization, payoff, compound growth) — unit-tested, per PRINCIPLES.md every number is reproducible; 61 tests total

## 0.3.0 — desktop app

- Electron desktop app (`desktop/`): double-clickable ikid for macOS (.dmg, arm64 + Intel), Windows (.exe), and Linux (.AppImage) — no terminal or npm required
- Data lives in the OS per-user application folder; first launch installs a seeded template database
- Automatic on-upgrade schema migration per profile via bundled Prisma CLI, with pre-upgrade backups
- Release workflow: pushing a `v*` tag builds installers on GitHub Actions and attaches them to a draft release
- Portable data directory: `IKID_DATA_DIR` / `IKID_DATABASE_URL` / `IKID_CLIENT_DIST` env overrides; database setup unified behind `prisma/setup.ts`
- Desktop guide (`docs/DESKTOP.md`) including unsigned-build first-open instructions

## 0.2.0 — self-hosting

- Docker support: multi-stage image with healthcheck, persistent `/app/database` volume, and `docker-compose.yml` with an optional Ollama service (`--profile ai`)
- `IKID_REQUIRE_AUTH=1` forces sign-in even before any password exists (default in the Docker image, so networked instances never run in open mode)
- `IKID_SECURE_COOKIES=1` adds the `Secure` flag to session cookies for HTTPS deployments
- Profile renaming with permanent per-profile account IDs that survive renames
- Deployment guide (`docs/DEPLOY.md`): HTTPS via reverse proxy, volume backups, upgrade flow

## 0.1.0 — first public release

- Statement import (CSV + PDF, any bank) with column auto-detection, duplicate hashing, and a review/correct step
- Auto-categorization with 190+ seeded rules, learning from every manual correction
- Dashboard (month / year-to-date) with click-through drill-downs on every chart
- Conscious Spending Plan breakdown (fixed / investments / savings / guilt-free)
- Budgets with end-of-month forecasts; goals with completion-date math and what-if previews
- Analytics: trends, category & merchant breakdowns, top-10 merchants per category, recurring payment detection, spending heatmap
- Planner: deterministic what-if engine (house, car, wedding, moving, career break, emergency fund) + optional local AI via Ollama; conversations can be saved
- Smart insights, CSV export, print-to-PDF reports
- Merchant normalization (auto-merge variants) and manual merging
- Profiles: fully isolated per-person SQLite databases
- Accounts: scrypt-hashed passwords, HttpOnly session cookies, login rate-limiting, per-request database isolation, public sign-up
- Public landing page; light/dark theme; 47 unit tests
