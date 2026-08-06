# Changelog

## Unreleased

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
