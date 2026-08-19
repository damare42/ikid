# Handoff: Ikid — full UI redesign onto Modernist

## Overview

Ikid is a local-first personal finance app (SQLite on the user's machine, no cloud). This package
redesigns the entire product onto the **Modernist** design system: flat, near-mono red on a warm
light ground, everything set in Archivo, **zero corner radius on structure**, 1–2px rules instead of
cards-and-shadows, flush-left alignment throughout.

Scope covered: desktop app (13 screens), the CSV/OFX import flow, marketing landing + auth, a mobile
app pass, dark mode, and — new in this revision — **loading / empty / error states for every
data-backed screen** and a **tablet breakpoint**.

Source repo this was designed against: `damare42/ikid`, branch `main`, subtree `client/src`.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes that show intended
look, copy and behavior. They are **not production code to copy**. The task is to recreate them in
the Ikid codebase's existing environment (React + the app's current component/styling layer),
following its established patterns. Where a prototype uses a hand-rolled element that the codebase
already has a component for, use the codebase's component and restyle it with the tokens below.

Two prototype-only affordances exist in `Ikid App.dc.html` and must **not** be built:

1. The dashed **"Prototype states / Frame"** bar at the very top — a reviewer switch for data state
   and viewport width.
2. The 2.4s **splash animation** on first mount — it stands in for real app boot. Ship the skeleton
   states instead (see *Loading*).

## Fidelity

**High-fidelity.** Colors, type, spacing, rules, hover/active states and all copy are final. Build
pixel-accurately. Numbers in the mocks are sample data — do not ship them.

---

## Design tokens

### Base tokens (from the design system, `styles.css`)

| Token | Value | Use |
| --- | --- | --- |
| `--color-bg` | `#f3f2f2` | app ground |
| `--color-text` | `#201e1d` | ink |
| `--color-neutral-100…900` | `#f8f4f4 · #eae7e7 · #d7d3d3 · #bab6b6 · #9b9797 · #7d7979 · #605d5d · #444141 · #2d2b2b` | rules, secondary text, skeletons |
| `--color-divider` | `#201e1d` @ 40% | the strong 2px rule |
| `--font-heading` / `--font-body` | `"Archivo", system-ui, sans-serif` | everything |
| `--space-1…8` | `4 · 8 · 12 · 16 · 24 · 32` px | spacing scale |
| `--radius-sm/md/lg` | `0px` | **structure is never rounded** |
| `--shadow-sm/md/lg` | `0 1px 2px / 0 3px 10px / 0 12px 32px` ink 14/16/22% | only the account menu + import dialog use `lg` |

### App-level overrides (declared in the prototype's `:root`)

These deliberately depart from the stock design system — carry them over exactly.

| Token | Light | Dark | Why |
| --- | --- | --- | --- |
| `--color-accent` | `#c62f14` | `#ff7a5e` | stock `#ec3013` fails contrast on this ground at small sizes |
| `--color-accent-600` (hover) | `#a82710` | `#ff9783` | |
| `--color-accent-700` (pressed) | `#8a1f0c` | `#ffb5a3` | |
| `--panel` | `#ffffff` | `#201e1d` | nav rail, header, dialogs sit on a panel, not the ground |
| `--pos` | `#1a7f5a` | `#5fd3a3` | money in / on-track |
| `--neg` | `#c62f14` | `#ff7a5e` | money out / over budget |
| `--warn` | `#9a6a10` | `#e0ad55` | at-risk budget |
| `--pos-100` | `#1a7f5a` @16% | `#5fd3a3` @20% | positive row tint |

Dark mode is a class (`.dark`) that re-declares the tokens — see the prototype's `.dark {}` block for
the full list including an **inverted neutral ramp** (`--color-neutral-100: #252322` … `900: #f3f2f2`)
and lightened category colors. Do not auto-invert; use the declared values.

### Category colors (chart + budget bars, light / dark)

`groceries #5b7d3f / #9fc47c` · `dining #c0632c / #f0a274` · `transport #3d6d8f / #84b4d6` ·
`housing #7a5a86 / #bda6cd` · `subscriptions #8a6b2f / #d4b071` · `utilities #3f7d76 / #7fc7bd` ·
`shopping #a34f6a / #e293aa` · `income #1a7f5a / #5fd3a3`

Each is exposed as `--c-<name>`. Category color always appears **with** a text label — never as the
only signal.

### Type roles (as used, not as theorised)

| Role | Spec |
| --- | --- |
| Page title (`h1.display`) | Archivo 800, `clamp(32px,4vw,54px)`, `letter-spacing:-0.03em`, `line-height:1` |
| Hero figure | Archivo 800, `clamp(38px,6.4vw,82px)`, ls `-0.03em` |
| Stat figure (`.big`) | Archivo 800, `clamp(20px,2.4vw,34px)`, ls `-0.02em` |
| Section title (`.sectitle h2`) | Archivo 800, 16px, ls `-0.01em`, with a 1px bottom rule + 10px padding |
| Kicker / label (`.kick`) | Archivo 600, **10px**, ls `0.14em`, uppercase, `--color-neutral-600` |
| Body | Archivo 400, 15–16px, `line-height:1.6`, `--color-neutral-700`, `text-wrap:pretty` |
| Table / dense | 13px (12px in `.dense`), numbers `font-variant-numeric: tabular-nums` |
| Nav item | Archivo 600, 13px |

**All numeric columns and figures use tabular nums** (`.num`). Non-negotiable — the tables misalign
without it.

### Component departures from stock Modernist

The design system specifies `radius: 0` everywhere. The app keeps 0 on all **structure** (sections,
rules, tables, dialogs, tags, inputs) but uses a **9px radius on interactive chrome only**:
`.btn` (9px), `.iconbtn` (38×38, 9px), `.avatar` (34×34, 9px), `.menu` items, `.bubble` (14px).
This is intentional: it separates "things you press" from "structure". Keep the split exact.

| Component | Spec |
| --- | --- |
| `.btn-primary` | bg `--color-accent`, `#fff` text (`#201e1d` in dark), padding `9px 18px`, radius 9px, **label flush left** (`justify-content:flex-start`). Hover: bg `-600` + `0 2px 10px accent@32%`. Active: bg `-700`, no shadow. |
| `.btn-secondary` | transparent, accent text, `padding-inline:8px`. Hover accent@10% fill, active @18%. |
| `.btn-ghost` | transparent, ink text, same geometry as secondary. |
| `.input` | no border except `1px solid --color-neutral-300` **bottom**, no radius, no left padding, transparent bg. Hover: bottom rule → `--color-text`. Selects carry an inline SVG chevron. |
| `.field > label` | the `.kick` spec (10px uppercase). |
| `.track` | 8px (10px in budgets) bar, `--color-neutral-200` bed, category color fill, square ends. |
| `.table` | 1px row rules, themed header, `tbody tr:hover` → `--color-neutral-100`, last row no bottom rule. |
| `.sectitle` | flex, baseline-aligned, `min-height:34px`, 1px bottom rule, 20px bottom margin. |
| `.hr` | 2px `--color-divider`. |
| Active nav | accent text + `inset 0 -2px 0` accent underline (top nav / tabs); accent text only (side rail). |
| Focus | `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }` — **never** the browser default. |

Icons: Lucide, 18–20px, `stroke-width:2`, `currentColor`.

---

## Layout shell

```
┌───────────────────────────────────────────────────────────┐
│ [rail 222px]  │  header (sticky, 64px, --panel)           │
│  logo         ├───────────────────────────────────────────┤
│  Money ▾      │  main .wrap (max-width 1200, pad 0 32px)  │
│  Plan ▾       │                                           │
│  Insight ▾    │                                           │
│  ─────────    │                                           │
│  Local·SQLite │                                           │
└───────────────────────────────────────────────────────────┘
```

- **Rail**: 222px fixed, `--panel`, 1px right rule, `position:sticky; top:0; height:100vh`,
  padding `24px 22px`. Three collapsible groups — **Money** (Dashboard, Transactions, Accounts,
  Budgets, Goals), **Plan** (Net Worth, Planner, Calculators, Retirement), **Insight** (Analytics,
  Reports). Group headers are `.kick` + an 11px chevron that rotates −90° when collapsed. Open state
  per group persists in component state (default: all open).
- **Header**: page title as `.kick`, then right-aligned search icon button, primary **↑ Import**,
  and a 34px avatar that opens a 212px `--shadow-lg` menu (profile switcher: Personal / Partner /
  Business / ＋ New profile, then Settings, Admin, Sign out).
- **Main**: `.wrap` = `max-width:1200px; margin:0 auto; padding:0 32px`. Dashboard is the exception —
  it uses full-bleed `--panel` sections with `.wrap` inside.

---

## Responsive behavior

The prototype implements this with **container queries** on the app root
(`container-type: inline-size`) so the reviewer can preview it via the Frame switch. In production,
use ordinary media queries at the same widths unless the app is embedded. Each responsive grid carries
a real class — `g-1up-tablet` (dashboard 3-up hero section), `g-3up`, `g-2up`, `g-acctrow`,
`g-budgetrow` — and the breakpoint targets those classes, not inline styles.

### ≥ 1101px — desktop
As drawn above.

### 701–1100px — tablet
- **Side rail hides.** A horizontal, horizontally-scrollable nav bar takes its place at the top of
  the content column: `--panel`, 2px bottom divider, padding `12px 20px`, `gap:20px`, logo at 76px,
  then all 12 destinations as flat 13px links (groups are dropped — the flat order is
  Dashboard, Transactions, Accounts, Budgets, Goals, Net Worth, Planner, Calculators, Retirement,
  Analytics, Reports, Settings). Active item = accent text.
- Header padding → `12px 20px`; `.wrap` padding → `0 20px`.
- `h1.display` → 34px flat.
- 3-up grids → 2-up. The dashboard's `1.1fr 1fr 1fr` and the Accounts row grid → 1-up.
- Budget rows collapse from a 5-column `label / bar / spent / forecast / delete` grid to three lines:
  the category name, the full-width progress bar, then `spent / limit` + forecast (right-aligned) +
  delete on one row (`minmax(0,1fr) auto 24px`, `gap:10px 18px`; the bar spans `1 / -1`).
- Wide tables become horizontally scrollable (`display:block; overflow-x:auto; white-space:nowrap`).
  **Preferred production fix:** wrap the table in an `overflow-x:auto` container instead of changing
  the table's display, and drop the least important columns (Account, Note) first.

### ≤ 700px
Use the existing mobile design (`Ikid Mobile.dc.html`) — bottom tab bar, single column, not a
squeezed desktop. The 701px boundary is where the desktop layout stops being viable.

---

## Data states (new)

Every **data-backed** screen has three non-happy states. The eight data-backed screens are:
Dashboard, Transactions, Accounts, Budgets, Goals, Net Worth, Analytics, Reports.

Planner, Calculators, Retirement, Settings and Admin are **input-driven** — they have no empty or
error state because they compute from form values, not stored rows. (Retirement does read balances;
if the team wants a state there, reuse the Net Worth copy.)

### Loading — skeleton, four shapes

Layout-matched skeletons, not spinners. `background: --color-neutral-200`, pulse
`@keyframes ik-pulse { 0%,100%{opacity:1} 50%{opacity:.38} }`, `1.5s ease-in-out infinite`, with
staggered delays `.12 / .24 / .36 / .48s` so it reads as a wave. Square corners.

| Shape | Screens | Content |
| --- | --- | --- |
| `cards` | Dashboard | 4-up stat row between two rules, then 3 chart blocks (184px) |
| `table` | Transactions, Accounts, Net Worth, Reports | header row (2px divider) + 7 rows on the `96px 1fr 120px 90px` grid, 14px padding |
| `bars` | Budgets, Goals | 5 rows of `label / bar / value` on `minmax(120px,1.2fr) 1fr 150px` |
| `chart` | Analytics | 2-up 236px chart blocks + a 3-up stat row |

Every loading view carries a `.kick` "Reading {noun} · local database", a 48px title placeholder, and
the footnote: *"Nothing is fetched over the network — this is the local read. If it takes longer than
a second, the database is being rebuilt."* Container gets `aria-busy="true"`.

Because reads are local, expect these to flash. **Only render the skeleton after ~150ms** of pending
read; below that, render nothing. Never render a skeleton for a cached screen the user is returning to.

### Empty — first-run

Left-aligned, `max-width:820px`, padding-top 56px. Structure: accent `.kick` → `h1.display`
`clamp(32px,4vw,54px)` → 16px body at `max-width:56ch`, `line-height:1.6` → 2px `.hr` →
primary + ghost action → muted `.kick` hint. No illustration, no centered layout, no card.

Copy is **final** — implement verbatim:

| Screen | Kicker | Title | Body | Primary | Secondary | Hint |
| --- | --- | --- | --- | --- | --- | --- |
| Dashboard | No data yet | Nothing to summarise yet. | The dashboard is built from imported transactions. Import one statement and this fills in — net position, cash flow, category split and health score. | ↑ Import a statement | Show me a sample month | CSV, OFX or QFX · everything stays on this machine |
| Transactions | 0 transactions on file | No transactions yet. | Import a bank statement, or add a transaction by hand. Categories learn from your first few corrections and apply themselves after that. | ↑ Import a statement | ＋ Add one manually | Chase, Ally and Amex exports are recognised automatically |
| Accounts | No accounts | No accounts set up. | An account is created when you import a statement, or you can add one now and import into it later. Each one remembers where its last import left off. | ＋ Add account | ↑ Import a statement | Re-importing an overlapping statement is safe — duplicates are detected |
| Budgets | 0 of 9 categories budgeted | No budgets set. | Put a monthly limit on any category and this page tracks spend against it, with a forecast that flags an overrun before the month ends. | ＋ Set a budget | Suggest limits from history | Suggestions use your last three months of spending |
| Goals | No goals | No savings goals yet. | A goal is a target amount and, optionally, a deadline. Ikid projects the balance at your current contribution and tells you what the deadline actually needs. | ＋ New goal | Use my savings rate | Emergency fund, house deposit, a trip — start with one |
| Net Worth | Nothing recorded | No assets or liabilities yet. | Add what you own and what you owe to see net worth over time. Balances from imported accounts are counted automatically. | ＋ Add asset | ＋ Add liability | Update balances monthly for a trend worth reading |
| Analytics | Not enough history | Analytics needs two months. | Trends, category breakdowns and recurring payments appear once at least two full months of transactions are on file. | ↑ Import more statements | Go to Transactions | 0 of 2 months of history on file |
| Reports | Nothing to report on | No reports yet. | Reports are generated from a complete month of transactions. Import a statement and the first month becomes available. | ↑ Import a statement | What's in a report? | Monthly and year-to-date PDFs, generated locally |

The Analytics hint is dynamic: `{n} of 2 months of history on file`.

### Error

Same left-aligned frame, but the heading block sits behind a **2px accent left rule with 24px
padding** — the only place the design flags failure with color-plus-structure. Then: primary
**Try again**, ghost **Open Settings → Database**, a 2px `.hr`, a `Technical detail` kicker, and the
raw detail in a monospace 12px block on `--color-neutral-100` (14/16px padding, `overflow-wrap:anywhere`).
Footnote: *"Nothing was written. A copy of this detail is in ~/Library/Logs/ikid/ikid.log."*
Container gets `role="alert"`.

Error copy is a **map of real failure modes** — each screen's message names what actually failed, and
every one states whether data was written. Implement these as the fallback strings keyed by error
code; when a real error arrives, substitute its detail into the mono block but keep the human title
and body.

| Screen | Code | Title | Body | Detail (example) |
| --- | --- | --- | --- | --- |
| Dashboard | DB_READ | This month wouldn't load. | The database answered, but the monthly rollup query failed. Your transactions are intact and nothing was written. | `sqlite: no such column: txn.cleared_at — in rollup_month (schema v3, expected v4)` |
| Transactions | QUERY_TIMEOUT | The transaction query timed out. | The filtered query ran past 15 seconds. Narrowing the date range or clearing one filter usually resolves it. | `timeout after 15000ms · filters: … (1,284 rows scanned)` |
| Accounts | DB_LOCKED | Accounts are locked. | Another Ikid window is writing to the database. Close it, then try again — no changes are lost. | `sqlite: database is locked (SQLITE_BUSY) · lock held by pid 4821` |
| Budgets | DB_READ | Budgets wouldn't load. | Budget limits couldn't be read from the local database. Transactions and goals are unaffected. | `sqlite: malformed row in budget_limits at rowid 61` |
| Goals | IO_ERROR | Goals wouldn't load. | The goals table couldn't be read from disk. Retrying is safe; if it repeats, run Settings → Database → Verify. | `sqlite: disk I/O error reading page 412 of goals.db` |
| Net Worth | CALC_FAILED | Net worth couldn't be calculated. | One liability ends before it starts, so the trend can't be built. Correct that entry and the chart returns. | `invalid range on liability #7 'Auto loan'` |
| Analytics | WORKER_CRASH | Analytics stopped mid-calculation. | The background worker that builds these charts ran out of memory. Retrying re-runs it from the start. | `worker exited code 137 (OOM) at month 9 of 12` |
| Reports | EXPORT_FAILED | The report couldn't be generated. | The PDF writer couldn't create a file in your reports folder. Check the folder still exists and is writable. | `EACCES: permission denied, open '…/reports/2026-08.pdf'` |

Rules: **Try again** re-enters the loading state (never a dead-end). Every body says whether anything
was written. No apologies, no exclamation marks, no "Oops".

### Mobile states

The mobile app carries the same three states on all four tabs (Home, Activity, Budgets, Goals),
scaled to the phone and using the **same tokens, structure and voice** as desktop — only the copy is
shorter and the type steps down.

| Element | Desktop | Mobile |
| --- | --- | --- |
| Empty title | `clamp(32px,4vw,54px)` | 28px |
| Error title | `clamp(28px,3.4vw,44px)` | 24px |
| Body | 16px / 1.6 | 14px / 1.6 |
| Primary action | inline `.btn-primary` | `.btn-primary.btn-block`, full width, label still flush left |
| Secondary action | ghost button beside the primary | a text link below it |
| Rule under the heading block | 2px `--color-divider` | 1.5px `--color-text` (matches the mobile header/tab rules) |
| Error detail | 12px mono on `--color-neutral-100` | 11px mono, same fill |
| Skeleton shapes | cards / table / bars / chart | stat lines (Home) / list rows (Activity) / bars (Budgets, Goals) |

Mobile empty copy points at the desktop app where the action belongs there ("Import on desktop") —
statement import is not a phone task.

Mobile state copy:

| Tab | Empty title | Primary | Error |
| --- | --- | --- | --- |
| Home | Nothing to summarise yet. | ＋ Add a transaction | DB_READ — This month wouldn't load. |
| Activity | No activity yet. | ＋ Add a transaction | QUERY_TIMEOUT — Activity timed out. |
| Budgets | Nothing budgeted yet. | ＋ Set a budget | DB_READ — Budgets wouldn't load. |
| Goals | No savings goals yet. | ＋ New goal | IO_ERROR — Goals wouldn't load. |

### Mobile consistency pass (applied with the states)

- **Money colors now match desktop**: the net-position figure and positive amounts use `--pos`
  (`#1a7f5a` / `#5fd3a3` dark); over-budget amounts and their bars use `--neg`. Accent red is no
  longer used to mean "money in" — it is brand and emphasis only. Goal progress bars stay accent.
- **`.kick` is 10px** on mobile too (was 9px) — 10px is the floor everywhere.
- **Hit targets**: `.tab` and `.qa` are `min-height:44px`.
- **Focus**: the 2px accent `:focus-visible` ring is declared for tabs, quick actions, buttons and
  inputs.
- Dark mode gains `--color-neutral-100: #252322` so the error detail block has a dark fill.

### Partial failure — one widget fails, the screen does not

Designed. When a single computed widget fails, the page stays up and the failure is **scoped to that
section** — no full-screen error, no banner. Shown in the prototype on the Dashboard's Cash Flow
column (Prototype states → **Partial**).

The section keeps its `.sectitle`; the heading's right-hand kicker changes from `August` to
`unavailable`. The chart is replaced in place by a compact version of the error block:

- 2px accent left rule, `padding-left:18px` (same device as the full-page error, half the scale)
- accent `.kick` — `Couldn't load · SERIES_GAP`
- 16px `.big` title — *"This chart is missing a month."*
- 13px / 1.55 body at `max-width:40ch` — names the cause and, critically, states
  *"Everything else on this page is accurate."*
- two 12px text actions: **Retry this section** (secondary, zero inline padding) and
  **Fix in Accounts →** (ghost) — the second points at where the user can actually correct it
- an 11px mono line with the machine detail: `series gap at 2026-03 · account Ally ·5678`

Rules: retry re-runs **only that section**. Never promote a section failure to a page-level error, and
never silently render an empty chart. If two or more sections on one screen fail, fall back to the
full-page error state.

### Import — unrecognised columns (new stage)

Designed. The import flow is now **pick → [map] → review → done**; the map stage appears only when
the header row doesn't match a known layout. Reach it in the prototype from the pick stage's
*"Simulate an unknown bank →"*.

Dialog at `min(820px,100%)`, `max-height:90vh; overflow:auto`, titled **Match the columns**. The
mapping grid itself is capped at `max-height:38vh` with its own scroller, so the heading block and the
action row stay on screen on a short laptop viewport. Every dialog in the flow carries the same
`max-height:90vh` cap. Structure top to bottom:

1. The same 2px accent left-rule block: `Unrecognised format · UNKNOWN_HEADERS` /
   *"We don't know this bank's export yet."* / body explaining it is a one-time step because Ikid keys
   the layout to the header row.
2. File summary line: `wisebank-export.csv · 7 columns · 132 rows · semicolon-delimited`, plus a live
   tag — `.tag-accent` **"1 required field missing"** → `.tag-outline` **"4 of 5 fields matched"**.
3. The mapping grid: `150px minmax(0,1fr) minmax(0,1fr)`, `gap:14px 24px`, column headers as
   `.kick` — **Ikid field / Column in your file / First row reads**. One row per field:
   Date\*, Description\*, Amount\* (required, accent asterisk, 700-weight label), then Merchant and
   Balance (neutral-700 label). Each row is a `.input` select of the file's actual column names and a
   **live preview of that column's first value** — the preview is what tells the user they picked
   right. An unmapped required field shows `not mapped` in accent instead of a sample.
4. Parsing options as an auto-fit `minmax(180px,1fr)` field row: **Date format**
   (DD.MM.YYYY / MM/DD/YYYY / YYYY-MM-DD), **Decimal separator** (comma / period), **Negative amounts**
   (minus sign / separate debit column / parentheses).
5. Checkbox, checked by default: *"Remember this layout for files with the same header row."*
6. While a required field is unmapped: an accent-tinted notice (`--color-accent-100` fill,
   `--color-accent-700` text) — *"Amount isn't mapped yet — without it there's nothing to import.
   Pick the column holding the transaction value."* — and **Continue to review** is `disabled`.
7. Actions: **Back** (secondary) / **Continue to review** (primary).

Implementation notes: sniff the delimiter and the three parsing options from the file and pre-fill
them — the user corrects, never configures from scratch. Pre-map any column whose header fuzzy-matches
a known field (the prototype shows Date, Description and Merchant pre-matched, Amount deliberately
not). Persist the accepted mapping keyed by a hash of the header row. After the map stage, the review
stage behaves exactly as documented above.

### Still not specified — decide before building

- **Offline / file-moved**: the database file is missing at launch (distinct from a read error).
- **Mid-import cancel**: closing the dialog at the review stage — discard silently, or confirm?
- **Long-list performance**: the transaction table is drawn at 10 rows; production hits thousands.
  Virtualise, and keep the sticky header + selection bar outside the virtualised region.

---

## Per-screen specs

Sample data in the mocks is illustrative. Layouts below are the contract.

### 1. Dashboard
Full-bleed `--panel` hero section (1px bottom rule): Month / Year-to-date tab pair, right-aligned
month select (140px), accent kicker `August 2026 · net position`, hero figure in `--pos`
(`clamp(38px,6.4vw,82px)`), a 15px 600-weight subline, then Income / Spending as a 36px-gap pair.
Below a 1px rule: auto-fit stat row (`minmax(148px,1fr)`, `gap:0 30px`, 20px vertical padding) —
Savings rate, Health score (`78 / 100` with the denominator at 15px neutral-500), Net worth, On track.
Then a `.wrap` 3-column section (`1.1fr 1fr 1fr`, gap 40) — Cash Flow, Where it went, Upcoming.
Closes with **Financial health — 78 / 100** as an auto-fit `minmax(230px,1fr)` grid of scored factors,
each an accent kicker + 13px explanation.

### 2. Transactions
Header: accent kicker `1,284 transactions on file · 12 unassigned`, `h1` Transactions, right-aligned
＋ Add transaction. Filter row: auto-fit `minmax(128px,1fr)`, `gap:18px 24px`, `align-items:end` —
Search (spans 2), Category, Account, Range, Amount. Table columns: checkbox, Date (sortable),
Description, Merchant, Category (color swatch + label), Account, Amount (right, tabular, `--pos` for
income), Note.
**Selection**: ticking any row swaps the count line for a selection bar — `--color-accent-100` fill,
2px accent left border, `{n} selected`, then bulk actions (Assign to account, Categorise, Delete,
Clear). Selection state is per-row, `toggleAll` in the header checkbox.
**Sort**: Date and Amount toggle asc/desc, arrow (`↑`/`↓`) rendered next to the active column only.
Pagination: text `← Previous` / `Next →` ghost buttons.

### 3. Accounts
Auto-fit stat row (Net on file, Unassigned transactions, Accounts, Last import). Then
**Where each account left off** — rows on `minmax(0,1.3fr) 128px 96px 116px minmax(0,1fr)`, gap 26,
`overflow-wrap:anywhere`: name + type tag, balance, txn count, last-import date, action. Footnote
about safe re-import.

### 4. Budgets
Month stepper (`← August 2026 →`, state `monthIdx`, base index 7 = Aug 2026) + ＋ Set a budget.
Stat row: Budgeted / Spent / Remaining / Forecast. Category rows on
`minmax(120px,1.2fr) minmax(0,1fr) 150px 130px 24px`, gap 26, 16px padding, 1px row rules:
name (17px `.big`), 10px track in the category color (`--neg` when ≥100%), `spent / limit`, forecast,
delete icon button. Footnote explains the forecast.

### 5. Goals
Header: `4 goals · $38,300 saved · $2,000/mo committed`. Rows on auto-fit `minmax(230px,1fr)`,
gap `20px 24px`, 24px padding, 1px bottom rules: goal name (24px display) + status tag
(`.tag-neutral` = % · `.tag-accent` = on track · `.tag-outline` = complete), progress, monthly
contribution, months left / needed-per-month. **Projection** section below.

### 6. Net Worth
`Updated Aug 12, 2026` kicker, ＋ Liability / ＋ Asset actions. Stat row: Net worth (accent),
Assets, Liabilities, 12-month change. Then the holdings table (Name, Type, Value, Change, Updated).

### 7. Planner
Narrow column (`max-width:860px`), centered content column but **left-aligned text**. Input row →
projection → disclaimer: *"Everything runs locally. Estimates for planning — not financial advice."*
Input-driven: no empty/error state.

### 8. Calculators
Four tabs — Loan, Compound, FIRE, Coast. Each: a wrapping input row
(`gap:18px 26px`, `align-items:flex-end`) + Save setup, an auto-fit `minmax(132px,1fr)` result row
with the headline result in accent, then a schedule table.

### 9. Retirement
`Federal tables · today's dollars · planning only`. Stat row (Lifetime federal tax, Ladder
conversions, …), a schedule table, and **What this plan says to do** as a 3-up numbered grid
(`01 · Ladder`, `02 · Bridge`, `03 · …`) — accent kicker on the first only.

### 10. Analytics
Four tabs — Trends, Breakdown, Recurring, Insights (`.atabs`, 26px gap, 1px bottom rule, active =
accent + 2px inset underline).
- *Trends*: 2-up charts (Income vs Expenses, Net savings), a savings stat row, and a **spending
  heatmap** — 30 weeks × 7 days of 12px cells, 3px gaps, fill
  `color-mix(in srgb, var(--color-accent) {intensity}%, var(--color-neutral-200))`, caption
  "Darker = more spent that day." (In the prototype this is built imperatively for cell count; build
  it as a normal component.)
- *Breakdown*: 2-up category analysis.
- *Recurring*: `Recurring Payments — ~$1,240/mo active` + table.
- *Insights*: 3-up cards, first with an accent `↑ Increase` kicker.

### 11. Reports
Month / YTD tabs, generated-report list, download actions.

### 12. Settings
`max-width:900px`. **Preferences** as a 2-up field grid (Currency, Date format, Week starts, Number
format). **Theme** as a 3-way text switch (Light / Dark / System — active accent + 2px underline).
**Categories & rules** as an auto-fit `minmax(132px,1fr)` grid of `name … {n} rules`. Then Database
(verify / export / import history), then Sign out as a ghost button.

### 13. Admin
Profile and data-management surface behind the avatar menu.

### Import dialog (4 stages, 5 with mapping)
`.dialog-backdrop` + `.dialog`, `--shadow-lg`, square corners, `--panel` fill.
1. **Pick** — file drop + account select.
2. **Review** — file summary line (`chase-2026-08.csv · 48 rows parsed · Chase ·1234`), a duplicate
   tag that flips between `3 duplicates skipped` / `3 duplicates · 3 kept`, and an editable table in
   a `max-height:46vh` scroller. Columns: Date (input), raw Description (12px neutral-600, truncated
   at 230px), Merchant (input), Amount (right, tabular; income in accent 700-weight), Category
   (select), Status. Statuses seen: `ok`, `ok · will learn`, a duplicate row with a keep checkbox, and
   an **invalid** row at `opacity:0.5` reading `invalid · no amount`. Footnote: correcting a category
   teaches the rule.
3. **Done** — `Imported 45 transactions, skipped 3 duplicates.` at 30px display + undo note.
4. Cancel/close returns to stage 1 next open.

The primary button label is live: `Import 48 transactions` / `Import 45 transactions` depending on the
duplicate toggle.

**Not designed — needs a decision:** column-mapping failure when a CSV's headers aren't recognised,
and the mid-import cancel path.

---

## Interactions & behavior

| Behavior | Spec |
| --- | --- |
| Navigation | Client-side; `window.scrollTo(0,0)` on screen change. Rail groups collapse independently. |
| Avatar menu | Opens on click, closes on navigation. 212px, `--shadow-lg`, 9px item padding, hover = `--color-neutral-100` + accent text. |
| Theme | Light / Dark / System; System reads `prefers-color-scheme`. Persist the choice. |
| Tabs | Analytics (4), Calculators (4), Dashboard (Month/YTD), Reports (Month/YTD). Tab state resets on screen change in the prototype — **persist per screen** in production. |
| Month stepper | Budgets; unbounded in the prototype — clamp to months with data. |
| Transitions | Buttons `background .15s ease, box-shadow .15s ease`; chevrons `transform .15s ease`; splash fade `.45s ease`. Nothing else animates. |
| Hover | Table rows `--color-neutral-100`; icon buttons ink@8%; nav items → full ink. |
| Retry | Error → loading → resolved. Never leaves the user on the error screen. |

## State management

Screen-level state in the prototype (name → purpose):

`screen` (active destination) · `atab` / `ctab` / `ptab` (per-screen tab) · `theme`
(`light|dark|system`) · `menuOpen` · `gMoney` / `gPlan` / `gInsight` (rail groups, default open) ·
`sel` (map of selected transaction rows) · `sortBy` + `sortDir` · `monthIdx` (budget month offset) ·
`importOpen` + `istage` (`pick|review|done`) + `dupKeep` · `ds` (data state — **prototype only**;
production derives this from the query's pending/empty/error status) · `frame` (**prototype only**).

Data the screens need from the local DB — confirm against the current schema before building:
monthly rollup (income, spending, net, savings rate, health score), transaction list with filters +
sort + pagination, account list with last-import cursor, budget limits + month-to-date spend +
forecast, goals with contribution and deadline, assets/liabilities with a monthly series, 12-month
category series, recurring-payment detection, report metadata.

## Accessibility — must be resolved during implementation

1. **Accent on ground is ~3:1.** Fine for the primary button fill, icons and large type. For
   paragraph-size accent text use `--color-accent-700` (`#8a1f0c`) — audit every 10–13px accent
   string, including all the `.kick` kickers currently set in accent.
2. **Never color-only.** Income/expense, over-budget and on-track states each need a label, sign or
   tag in addition to `--pos` / `--neg`.
3. **Focus**: 2px accent `:focus-visible` ring at `outline-offset: 2px` on every interactive element,
   including table checkboxes and the import dialog's inputs and selects.
4. **Import dialog**: trap focus, restore it to the ↑ Import button on close, `Esc` closes, first
   invalid row is announced.
5. **Skeletons**: `aria-busy="true"` on the region; errors `role="alert"`; don't announce skeletons.
6. **Heatmap** needs a text equivalent (a table or summary) — 210 unlabeled cells are not accessible.
7. The 10px uppercase `.kick` is at the floor of legibility — do not go smaller, and don't use it for
   anything a user must read to act.

## Assets

- **Font**: Archivo (400/600/700/800) — self-host or use the codebase's existing loader.
- **Logo**: inline SVG — a dotted accent arc from an ink dot to an accent dot, over `ıkıd` set in
  Archivo 800 at `letter-spacing:-3`. Full markup is in the rail and `.tabnav` blocks of
  `Ikid App.dc.html`. Also drawn animated in the splash (route draws in, then becomes dotted).
- **Icons**: Lucide.
- No raster images in the app; the landing page uses one grayscale photograph via the design system's
  `.grayscale` wrapper.

## Files in this bundle

Start with **`START_HERE.md`** (orientation + build order) and **`tokens.json`** (machine-readable
tokens). Then:

| File | What it is |
| --- | --- |
| `Ikid App.dc.html` | The desktop app — all 13 screens, import dialog, dark mode, the three data states and the tablet breakpoint |
| `Ikid Mobile.dc.html` | Mobile app pass (bottom tab bar) — the ≤700px target |
| `Ikid Landing.dc.html` | Marketing landing + sign-in / sign-up |
| `Dashboard Redesign.dc.html` | The two dashboard direction explorations (1a, 1b) that led here |
| `Ikid Design Analysis.dc.html` | Audit of the original UI and the rationale for this direction |
| `styles.css` | The Modernist design system stylesheet — the token source of truth |
| `_ds/modernist-…/` | The design system as the prototypes load it (stylesheet, bundle, manifest, its own readme) |
| `support.js`, `ios-frame.jsx` | Prototype runtime only — needed to render the HTML, never ported into the app |
| `github.md` | Repo, branch, subtree and the screen → source-file map |
| `Ikid Nav Options.dc.html`, `Ikid Logo Options.dc.html`, `Ikid Mobile Options.dc.html` | Rejected alternatives — context for *why*, not things to build |

Repo mapping (from `github.md`): the app screens correspond to `client/src/pages/Dashboard.tsx`,
`Transactions`, `Budgets`, `Goals`, `NetWorth`, `Planner`, `Analytics`, `Settings`,
`client/src/components/ImportDialog.tsx`, and the shell in `client/src/App.tsx`.

To open any prototype, serve the folder and open the file — they are plain HTML.
