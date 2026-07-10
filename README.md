#  Ikid — Local-First Personal Finance

Ikid is a personal finance dashboard that runs **entirely on your computer**. Import bank statements (CSV or PDF), auto-categorize transactions, track budgets and savings goals, and see exactly where your money goes. No cloud, no accounts, no telemetry — your data lives in a single SQLite file.

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

### Desktop app (no terminal needed)

Download the installer for your OS from the [Releases](https://github.com/damare42/ikid/releases)
page — `.dmg` (macOS), `.exe` (Windows), or `.AppImage` (Linux). Double-click,
sign up, import a statement. Builds are unsigned for now: see
[docs/DESKTOP.md](docs/DESKTOP.md) for the one-time "Open Anyway" step and
how the app is put together.

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
- **Import** — drag-and-drop CSV or PDF statements from any bank. Columns (date, description, amount, debit/credit, balance, reference) are auto-detected; a review screen lets you correct anything before committing. Duplicates are detected via a date+amount+description+reference hash and skipped automatically. Imports can be undone from Settings.
- **Auto-categorization** — keyword rules (longest/most specific match wins) seeded with real merchant patterns. Every time you categorize something — editing a transaction or correcting a category in the import review — Ikid saves a *learned* rule and retroactively fixes other uncategorized transactions from that merchant, so it gets smarter with use. Rules are fully editable in Settings.
- **Transactions** — search, filter by category/merchant/account/date range/amount range, sort, paginate; edit category, merchant, notes, and tags; mark transfers. Add income or expenses manually (cash, freelance payments, anything not on a statement) with the **+ Add transaction** button.
- **Profiles & accounts** — fully separate datasets (e.g. you / partner / business), each in its own SQLite file; budgets, goals, rules, and settings are all per-profile. Set a password in Settings → Security to turn profiles into sign-in accounts: scrypt-hashed passwords with per-profile salts, HttpOnly session cookies, login rate-limiting, and per-request database routing so concurrent users only ever see their own data. With no passwords set, Ikid stays in single-user open mode.
- **Budgets** — monthly limits per category with spent/remaining/% used and an end-of-month spending forecast.
- **Goals** — target, saved-so-far, monthly contribution, optional deadline. Ikid computes estimated completion, months remaining, required monthly contribution for a deadline, and a projected balance curve — with live "what if?" previews as you tweak numbers.
- **Planner** — a chat-style what-if modeler that uses your real income/expense/savings numbers. Ask "buy a house for $450k with 10% down", "wedding costing $20k in 18 months", or "what if I stop working for 8 months" and a deterministic engine computes upfront cash, loan payments, new savings rate, and a 24-month projection chart. If [Ollama](https://ollama.com) is installed (`ollama pull llama3.1`), freeform questions get natural-language answers from a local LLM — the math always stays in the engine.
- **Analytics** — monthly/weekly/yearly trends, category and merchant breakdowns, largest purchases, recurring payment detection, savings analysis, and a daily spending heatmap.
- **Smart Insights** — month-over-month category and merchant movements, possibly-unused subscriptions, recurring-spend totals, savings opportunities, yearly estimates.
- **Reports** — CSV export of transactions, plus a print-optimized report page (charts, tables, budget + goal status) — use *Save as PDF* in the print dialog.
- **Settings** — currency, date format, dark mode, accounts, categories, rules, import history/undo, and one-click database backup/restore/export.

## Architecture

```
ikid/
├─ client/           React 18 + TypeScript + Vite + Tailwind + Recharts
│  └─ src/
│     ├─ pages/      Dashboard, Transactions, Budgets, Goals, Analytics, Reports, Settings
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

`Transactions` (signed amounts, unique dedupe hash, transfer flag) ↔ `Categories`, `Merchants`, `Accounts`, `Imports`, `Tags` (many-to-many). `Rules` drive categorization, `Budgets` are per-category monthly limits, `Goals` hold planning inputs, `Settings` is a key-value store.

Conventions: **negative amount = money out**; transactions marked `isTransfer` (savings moves, card autopay) are excluded from income/spending so paying your credit card never counts as spending twice.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | set up DB if needed, run server (3001) + client (5173) |
| `npm test` | server unit tests (vitest): categorization, parsers, dedupe, goal math |
| `npm run build` | typecheck + production build of both packages |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run db:reset --prefix server` | wipe and reseed the database |

## Importing your own statements

1. Click **Import** in the top bar, drop a `.csv` or `.pdf`.
2. CSV headers are matched against common bank synonyms ("Posted Date", "Withdrawal", "Running Balance"…). PDFs are parsed generically for `date … description … amount [balance]` lines — text-based PDFs work; scanned images don't.
3. Review the parsed rows, fix anything, pick categories, then commit. Re-importing the same file is safe — duplicates are skipped.

## Privacy

Everything is local: SQLite file on disk, localhost-only API, zero external calls. Back up by copying `database/ikid.db` (or use Settings → Backup).

## License

MIT — see [LICENSE](LICENSE). Contributions welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- Import profiles: remember per-bank column mappings after the first import
- Merchant normalization pass ("AMZN Mktp" → "Amazon") with merge UI
- Net worth dashboard: asset/liability accounts with balance history
- Loan payoff + mortgage calculators; retirement projection
- Optional encrypted backups (SQLCipher or age-encrypted copies)
- Rules engine v2: amount ranges, account scoping, regex matches
- Investment tracking with manual price updates
- OCR fallback for scanned PDF statements
