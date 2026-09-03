#  Ikid — Local-First Personal Finance

Ikid is a personal finance dashboard that runs **entirely on your computer**. Import bank statements (CSV or PDF), auto-categorize transactions, track budgets and savings goals, and see exactly where your money goes. No cloud, no accounts, no telemetry — your data lives in a single SQLite file.

## Where to find it

| | |
| --- | --- |
| **Website** | <https://damare42.github.io/ikid/> — what it does, why local-first, and how to start. A static page that makes zero external requests: no fonts, no scripts, no trackers. |
| **The app itself** | <http://localhost:3001>, on your own machine, after the quick start below. |
| **Source** | <https://github.com/damare42/ikid> |
| **Hosted version** | There isn't one, deliberately. There's no ikid server holding anyone's data — if you want access from anywhere, you [host it yourself](docs/DEPLOY-ONLINE.md). |

The website is documentation, not a place to sign in. Nothing you can reach on
the internet ever sees your transactions; the app only exists on machines you
run it on.

## Quick start

Requires **Node.js 20+** ([download](https://nodejs.org)).

```bash
npm install
npm run build   # one-time: builds the web app
npm start       # → http://localhost:3001
```

`npm start` sets up the SQLite database on first run (default categories +
190+ categorization rules — no sample data; your imported statements are the
only transactions), then serves everything from a single local process.
Open **http://localhost:3001**, sign up, and drop in a bank statement.

### Desktop app (not published yet)

Packaging for `.dmg` (macOS), `.exe` (Windows) and `.AppImage` (Linux) is built
and working, but the builds are **unsigned**, so nothing is on the
[Releases](https://github.com/damare42/ikid/releases) page yet — an unsigned
installer for a finance app is a bad first impression, and telling you to click
past your OS's warning is worse. Until signing is sorted, the quick start above
is the supported way in. See [docs/DESKTOP.md](docs/DESKTOP.md) for how the
desktop shell works and how to build it yourself.

### Docker (self-hosting / home server)

```bash
docker compose up -d                  # → http://localhost:3001
docker compose --profile ai up -d     # + local Ollama for the Planner
```

Sign-in is required by default in Docker, data persists in the `ikid-data`
volume, and upgrades auto-backup every database first. See
[docs/DEPLOY.md](docs/DEPLOY.md) for HTTPS, backups, and environment variables.

### Development mode

```bash
npm run dev
```

Runs the API (:3001) and the Vite dev server with hot reload (:5173).

### Upgrading

Pull the new version, then `npm install && npm run build && npm start`.
Before any version's first launch, every profile database is automatically
copied to `database/backups/pre-<version>/` — if anything goes wrong, your
previous data is one file-copy away. Use `npm run db:reset --prefix server`
to wipe everything and start fresh.

## Features

- **Dashboard** — monthly income, spending, net savings, savings rate, cash flow, largest categories, budget status, recent transactions, and a financial health score.
- **Import** — drag-and-drop CSV or PDF statements from any bank. Columns (date, description, amount, debit/credit, balance, reference) are auto-detected; a review screen lets you correct anything before committing. Duplicates are detected via a date + amount + description + merchant hash (per account) and skipped automatically — reference numbers are deliberately excluded, because banks fill them inconsistently and that caused both missed and false duplicates. A row flagged as a duplicate can still be kept if the match is wrong. Imports can be undone from Settings.
- **Auto-categorization** — keyword rules (longest/most specific match wins) seeded with real merchant patterns. Every time you categorize something — editing a transaction or correcting a category in the import review — Ikid saves a *learned* rule and retroactively fixes other uncategorized transactions from that merchant, so it gets smarter with use. Rules are fully editable in Settings.
- **Transactions** — search, filter by category/merchant/account/date range/amount range, sort, paginate; edit category, merchant, notes, and tags; mark transfers. Add income or expenses manually (cash, freelance payments, anything not on a statement) with the **+ Add transaction** button.
- **Accounts** — a per-card/account status page showing the latest transaction already imported, a freshness badge, transaction count, net on file, and the last import file, so you always know where each account left off and what to upload next. The import dialog echoes the same "upload after this date" hint for whichever account you pick.
- **Profiles & accounts** — fully separate datasets (e.g. you / partner / business), each in its own SQLite file; budgets, goals, rules, and settings are all per-profile. Set a password in Settings → Security to turn profiles into sign-in accounts: scrypt-hashed passwords with per-profile salts, HttpOnly session cookies, login rate-limiting, and per-request database routing so concurrent users only ever see their own data. With no passwords set, Ikid stays in single-user open mode.
- **Admin & usage analytics** — the first account is an admin. The Admin page (🛡️) shows how many people use the app, active-user counts, the most-used features, an activity trend, and an accounts table (promote/demote, disable/enable, reset password, toggle open sign-ups). Analytics record *feature events only* — never amounts, merchants, or any financial data — and stay entirely local. Admins can manage accounts but never open another user's data. See `docs/GO-PUBLIC.md` for how this maps to a possible hosted version and the local-first trade-offs.
- **Reconcile** — enter a statement's closing balance and date, and Ikid tells you whether its records agree with the bank. The difference is decomposed rather than just displayed: transactions you haven't marked cleared, transactions dated after the statement, and the **residual** neither explains — the residual being the one that means something is genuinely missing or duplicated. Mark cleared individually or in bulk, with one-click undo. Transfers count here (a card payment really does leave the account), even though they're excluded from income and spending.
- **Bills** — what's actually leaving your account in the next 30, 60 or 90 days, projected from detected recurring payments, with the total set against your average monthly surplus. Flags subscription price changes ("$15.49 → $17.99 in March") and tells a cancelled subscription apart from a merely late one where it can — and says so where it can't.
- **Budgets** — monthly limits per category with spent/remaining/% used and an end-of-month spending forecast.
- **Goals** — target, saved-so-far, monthly contribution, optional deadline. Ikid computes estimated completion, months remaining, required monthly contribution for a deadline, and a projected balance curve — with live "what if?" previews as you tweak numbers.
- **Net Worth** — track assets (cash, investments, property, vehicles) and liabilities (mortgage, loans, credit cards) as dated value snapshots. Update values whenever you like — back-dating fills in history — and Ikid charts net worth over time with carry-forward between updates. Investments can store units × unit price; loans with a rate and monthly payment show a projected payoff date and remaining interest.
- **Planner** — a chat-style what-if modeler that uses your real income/expense/savings numbers. Ask "buy a house for $450k with 10% down", "wedding costing $20k in 18 months", "invest $500 a month at 7% for 20 years", or "what if I stop working for 8 months" and a deterministic engine computes upfront cash, loan payments, compound growth, new savings rate, and a projection chart. If [Ollama](https://ollama.com) is installed (`ollama pull llama3.1`), freeform questions get natural-language answers from a local LLM — the math always stays in the engine.
- **Calculators** — loan amortization (monthly payment, payoff date, total interest, extra-payment savings, principal-vs-interest by year), compound interest (contributions vs growth), FIRE (your financial-independence number, projected FIRE age, and the path to it), and Coast FIRE (how much you need *today* to coast to retirement with no further contributions) — all computed by the same unit-tested engine the Planner uses. Any setup can be saved to a per-profile history panel and reloaded later.
- **Retirement Planner** — methodical early-retirement planning across account types: Traditional 401k/IRA, Roth (contribution basis tracked separately), brokerage (cost-basis-aware capital gains), and HSA. Simulates every year from now to your plan horizon with the age-59½ rule, Roth conversion ladders (5-year seasoning, sized to fill the standard deduction and low brackets), RMDs from the Uniform Lifetime Table, and a tax-aware withdrawal waterfall — then tells you whether the plan works, what the bridge to 59½ requires, and how to order contributions. Also lays out every route to money before 59½ — taxable, Roth basis, the Rule of 55, the ladder, and 72(t)/SEPP — ordered by how little each costs you in flexibility, and says which are actually open to your plan. Uses verified federal tax tables (documented constants, federal-only, today's dollars); planning support, not tax advice.
- **Analytics** — monthly/weekly/yearly trends, category and merchant breakdowns, largest purchases, recurring payment detection, savings analysis, and a daily spending heatmap.
- **Smart Insights** — month-over-month category and merchant movements, possibly-unused subscriptions, recurring-spend totals, savings opportunities, yearly estimates.
- **Reports** — CSV export of transactions, plus a print-optimized report page (charts, tables, budget + goal status) — use *Save as PDF* in the print dialog.
- **Demo mode** — fill a profile with two years of invented transactions (fake banks, fake merchants, fake salary) so every screen has something to show before you import anything real. Generated locally from a fixed seed, so it's identical every time. It goes into its own `demo` profile with its own database file, and refuses outright to load into a profile that already holds real transactions.
- **Settings** — currency, date format, dark mode, accounts, categories, rules, import history/undo, demo data, one-click database backup/restore, and a lossless JSON export.
- **No lock-in** — one-click **lossless JSON export** of everything in a profile, with relations stored by name rather than database ID, so the file is readable in a text editor and imports cleanly into another profile (merge or replace). See [docs/EXPORT-FORMAT.md](docs/EXPORT-FORMAT.md).

## Architecture

```
ikid/
├─ client/           React 18 + TypeScript + Vite + Tailwind + Recharts
│  └─ src/
│     ├─ pages/      Dashboard, Transactions, Budgets, Goals, Net Worth, Planner,
│     │              Calculators, Analytics, Reports, Settings
│     ├─ components/ ui primitives, ImportDialog (drag & drop)
│     ├─ hooks/      useFetch
│     └─ lib/        api client, formatters
├─ server/           Node + Express + TypeScript (tsx)
│  ├─ prisma/        schema + seed
│  └─ src/
│     ├─ routes/     thin HTTP layer (zod-validated DTOs)
│     ├─ services/   import pipeline, categorization, analytics, insights,
│     │              budgets, goal math, reports, backup (pure logic where possible)
│     ├─ repositories/  all Prisma/database access
│     └─ lib/        prisma client, logger, error handling
├─ shared/           TypeScript DTOs shared by client & server
├─ database/         one .db per profile (ikid.db by default) + backups/
├─ uploads/          statement files (yours; not committed)
└─ reports/          exported files
```

Patterns: repository layer isolates the DB, services hold business logic (categorization, parsing, goal math are pure functions with unit tests), routes are thin and zod-validated, DTOs shared across the wire. SQLite indexes on date, category, merchant, account, amount, and hash keep things fast at 100k+ transactions.

## Data model

`Transactions` (signed amounts, unique dedupe hash, transfer flag) ↔ `Categories`, `Merchants`, `Accounts`, `Imports`, `Tags` (many-to-many). `Rules` drive categorization, `Budgets` are per-category monthly limits, `Goals` hold planning inputs, `Settings` is a key-value store. `Assets` + `AssetSnapshots` hold net-worth items and their dated value history (snapshot values are always positive; liability kinds subtract in totals).

Conventions: **negative amount = money out**; transactions marked `isTransfer` (savings moves, card autopay) are excluded from income/spending so paying your credit card never counts as spending twice.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | set up DB if needed, run server (3001) + client (5173) |
| `npm test` | server unit tests (vitest): categorization, parsers, dedupe, goal math |
| `npm run build` | typecheck + production build of both packages |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run build:demo` | build the browser-only demo into `site/demo/` (see [docs/DEMO.md](docs/DEMO.md)) |
| `npm run db:reset --prefix server` | wipe and reseed the database |

### If a build fails with "Cannot find module @rollup/rollup-…"

A [long-standing npm bug](https://github.com/npm/cli/issues/4828) sometimes
skips the platform-specific binary that Rollup — and therefore Vite — needs.
The error suggests deleting `package-lock.json`; **don't**. This project's
lockfile already lists all 25 platform binaries, so the lockfile is fine and
regenerating it would only drop the pinned versions. Reinstall from it instead:

```bash
rm -rf node_modules client/node_modules server/node_modules
npm ci
```

## Importing your own statements

1. Click **Import** in the top bar, drop a `.csv` or `.pdf`.
2. CSV headers are matched against common bank synonyms ("Posted Date", "Withdrawal", "Running Balance"…). PDFs are parsed generically for `date … description … amount [balance]` lines — text-based PDFs work; scanned images don't.
3. Review the parsed rows, fix anything, pick categories, then commit. Re-importing the same file is safe — duplicates are skipped.

## Privacy

Everything is local: SQLite file on disk, localhost-only API, zero external calls. Back up by copying `database/ikid.db` (or use Settings → Backup).

## Principles

What ikid will and won't become is written down in
[docs/PRINCIPLES.md](docs/PRINCIPLES.md) — including the list of things we
will **never** build (bank credential sync, cloud accounts, telemetry, ads,
hosted AI). Feature requests are triaged against it.

## License

MIT — see [LICENSE](LICENSE). Contributions welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

Shipped since the first release: merchant normalization with a merge UI, net
worth with dated snapshots, loan/compound/FIRE/debt-payoff calculators, the
retirement planner, investment tracking with manual prices, and lossless JSON
export. What's still open:

- Import profiles: remember per-bank column mappings after the first import
- Reconciliation: a `cleared` flag and a "match my statement balance" screen
- Bills & renewals: project detected recurring payments forward 30 days
- Rules engine v2: amount ranges, account scoping, regex matches
- Multi-currency: conversion between currencies inside one profile
- Optional encrypted backups (SQLCipher or age-encrypted copies)
- OCR fallback for scanned PDF statements
- Signed desktop builds, so the installers can go on the releases page

Anything here is triaged against [docs/PRINCIPLES.md](docs/PRINCIPLES.md) first —
some requests are declined on purpose, and that list is written down too.
