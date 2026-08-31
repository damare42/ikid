# Changelog

## Unreleased

**Pie charts were drawn on top of the lists beside them**

Four cards put a chart and its category list side by side in a flex row, with
the chart in a `ResponsiveContainer width="55%"` (or 50%, or 60%). That is
under-defined: the percentage resolves against the flex container, but the
item's basis is its content and it is still allowed to shrink, so the width
Recharts measured and the width the item ends up with disagree — and Recharts
positions its `<svg>` absolutely, so the overflow doesn't clip. It lands on the
list, and neither is readable.

Chart above, list below, in two columns at `text-xs`. Six categories take three
lines rather than six, so the list costs roughly the height the pie gave back.
Dashboard's Largest Categories and Conscious Spending Plan, Analytics' Category
Breakdown, and the Reports page.

The Reports card is also what **Save as PDF** prints, where the mismatch is
worse and unfixable by the reader: the print viewport is the paper, not the
window, so the container narrows while the svg keeps its screen width. The
print stylesheet now holds charts to their own box, keeps colour (browsers drop
backgrounds by default, which printed every category chip as an empty outline),
and stops a heading being split from the chart it names.


**32 measured contrast failures, from three causes**

Walked the live demo in both themes and computed the rendered contrast of every
visible text node against its actual background — 22 failures in light, 10 in
dark.

*Category chips painted their label in the category's colour.* The shipped
defaults are stock Tailwind hues, so Transportation rendered at **2.15:1**,
Groceries 2.28, Utilities 2.77, Dining 2.80. The app rebuilt its own ramps
precisely because stock hues fail as text, then handed the category defaults a
way around it. `Badge` now puts the colour in the dot and leaves the label in
body text — and that is not just a workaround, because the colour is
user-editable: no palette can guarantee a colour someone else picked is legible.

*The default palette wasn't accessible either.* The test written for the above
caught the follow-on: Utilities' dot was only 2.42:1 against its own chip.
Every default has been nudged in lightness — **hue preserved exactly**, 15 of 23
changed — until each clears 3:1 on white, on the dark panel, and as a dot on its
own tint over both.

*Chart legends inherited the series colour.* Recharts paints legend labels in
the fill colour, which quietly moves a value chosen for the 3:1 graphical rule
into the 4.5:1 text rule. The dark-mode money-out crimson measured 3.56:1 as a
legend label — a colour this project chose, used somewhere it didn't intend.
Legend labels are body text now; the swatch carries the colour.

Also: `text-rose-500` and `text-emerald-600` appeared as money and status text
with no dark-mode variant (2.80 and 3.34 on the dark panel) across twelve files,
and the 12px section kicker used `slate-400`, a token documented for icons at
the 3:1 floor, as small text at 3.16:1.


**Recurring payments were 85% of spending, because groceries counted**

The detector asked for amount similarity: three charges within 15% of the
median. On two years of data that is the wrong signal in both directions.

A shop visited twice a month for two years is 46 charges, and three landing
near the median is arithmetic rather than evidence — so groceries, fuel, dining
and transit were all reported as subscriptions, and "you spend $4,071/month on
recurring payments" appeared against $4,790/month of total spending. Meanwhile
an electricity bill (38% of charges near its median) and a streaming service
that had raised its price (58%) were excluded, though both plainly recur.

The signal is *when*, not *how much*:

| | gap between charges | variation |
|---|---|---|
| real billing | ~30.4 days | **0.03** |
| groceries, fuel, dining | 6–65 days | 0.60–1.16 |

`recurringCore.ts` tests cadence regularity instead, shared by server and demo.
The demo now finds **13 payments totalling $2,840/month** — mortgage, car
finance, insurance, utilities, fibre, gym, mobile, three streaming services —
and no groceries. The estimate is also derived from the observed interval
rather than `median × min(perMonth, 1.5)`, which inflated anything arriving
more often than monthly and under-reported anything weekly.

**The app judged months that hadn't finished**

The Conscious Spending Plan compares each bucket to a share of a whole month's
income and colours the result green or red. On the 3rd, rent has landed and
fixed costs read as nearly everything while guilt-free reads as nothing — so
the demo's dashboard showed "21.9%" against a "target 50–60%" in amber, an
alarming verdict about an accounting period three days old. The breakdown now
reports whether the period has closed, and the dashboard withholds the verdict
and says "month in progress" until it has.

**The last duplicated definitions**

`cspCore.ts` holds the fixed-cost category list and the target bands, which the
demo had been keeping a second copy of. They agreed — so had the health score,
right up until it didn't.


**The demo's Insights page was a quieter, slightly wrong version of the product**

Third instance of the same drift, found by auditing for it rather than
stumbling into it. `generateInsights` was pure below its fetches, so the demo
had written a short version of its own — and it disagreed:

- it required a **$40 and 25%** movement where the product asks $25 and 10%
- it compared the **running** month against the previous complete one, so on
  any day but the last of the month every category read as "down"
- it produced category movements only: no merchant movement, no unused
  subscription warnings, no recurring total, no dining opportunity

`insightsCore.ts` holds the heuristics; the service is now only the fetching,
and the demo calls the same function over its own data. The demo's Insights
page goes from a handful of category rows to 15 insights across five kinds.
Pinned by `insights.test.ts`, including the boundaries each rule was written
for and that the running month is never treated as complete.

**Search existed only above 640px**

The header search box is `hidden sm:block`, with nothing in its place — so on a
phone the app had no way to search transactions at all. Same shape as the
missing navigation, one control smaller. It's in the drawer now.

**Seven more unbounded grids**

The `/analytics` fix found twelve; a stricter check found seven the first
pattern missed, including Transactions' filter bar and the Landing page.


**The demo banner's ⓘ flickered on hover**

Opening the panel inline made the banner taller, which moved the button out
from under the cursor, which fired `mouseleave`, which closed it, which moved
the button back under the cursor. A hover that reflows the layout containing
the hovered element is a feedback loop and oscillates at frame rate. The panel
is positioned against the banner now, so it takes no space and the button never
moves; a 120ms close delay keeps it reachable with the pointer.


**Two more sideways-scrolling pages, and the cause behind twelve latent ones**

`/analytics` was 201px over. The container was `grid gap-4 lg:grid-cols-2` —
no base column count, so on a phone the grid has no explicit track, the
implicit one sizes to `auto` (max-content), and a card holding a chart and a
long unwrapping title computed a **556px track inside a 335px parent**. Adding
`grid-cols-1` makes the track `1fr` and bounds it to the container. Twelve
grids in the app had the same shape; all twelve are fixed, not just the two
that happened to hold content wide enough to show it.

`/settings` was 7px over: an `<input>` carries an intrinsic minimum width from
its `size` attribute, so `flex-1` does not let it shrink below ~170px. Beside a
`<select>` and a button that is enough to push past 375px. Six inputs given
`min-w-0`.


**The demo banner is one line now**

It sat on every screen and repeated five lines of explanation on each one,
which on a phone meant the whole first viewport was a disclaimer. The sentence
that must land — "None of these numbers are real." — stays visible; the rest
moved behind an ⓘ that opens on hover *and* on tap, since a phone has no hover
and the phone is where the space was being wasted.

**Four pages scrolled sideways on a phone**

Measured on the live demo at 375px rather than guessed:

| route | overflow | cause |
|---|---|---|
| `/` | 212px | two unwrapped tables |
| `/settings` | 52px | button rows that wouldn't wrap |
| `/retirement` | 39px | a 288px tooltip centred on an icon near the edge |
| `/planner` | 36px | the conversation toolbar |

The `/retirement` one is the interesting one: the popover was still
`invisible`, and visibility doesn't remove an element from layout, so the page
scrolled 39px with nothing on screen to explain why. It's pinned between the
screen edges on a phone and anchored to its icon from `sm` up.

The `/` tables were missed by the earlier static pass because it grepped
per-file, and `Dashboard.tsx` already contained "overflow-x-auto" for the stat
strip — so a file-level check called it handled while its two tables hung 212px
off the side. Six more tables found the same way.


**The demo hadn't been deploying**

The Pages workflow was filtered to `paths: ["site/**"]`, but the demo bundle is
built by that workflow from `client/`, `shared/` and the pure engines in
`server/src/services/` — `site/demo/` is gitignored so a stale build can't be
committed. So the filter watched the one directory the demo is *not* built
from. The last commit to touch `site/` was `fccefd9`; everything since — the
Planner fix, the chart palette, the mobile navigation — landed on main without
ever publishing.

The filter is gone. A hand-maintained list of "what the demo depends on" is a
second source of truth, and this one was already wrong. A redundant deploy
costs a minute; a stale demo costs the visitor's only impression of the app.

**Usable on a phone**

Below 768px the sidebar was `hidden md:flex` with nothing behind it, so a
visitor on a phone could reach the Dashboard and none of the other twelve
screens. Roughly half the people who open a demo link are on a phone.

- A slide-over navigation covering every destination, sharing its link markup
  with the desktop rail so the two can't drift. Closes on tap, scrim and Escape
- The demo banner rendered in a ~40px column on a phone — one word per line,
  filling the entire first screen. `flex-1` let it shrink instead of wrap; it
  now takes a full-width basis until `sm`
- Six tables that would have dragged the whole page into horizontal scrolling
  now scroll within their own card
- Form rows of three number inputs go two-across on a phone

**The health score stopped contradicting itself**

The demo scored `savingsRate * 250` clamped to 100, so its dashboard read
**100/100 directly above "3 budgets over limit"** — using a formula the
installed app has never used. Same class of drift as the Planner bug.

- `healthCore.ts` holds the product's real formula; server and demo both call
  it. The demo's dashboard now reads 65/100 with three notes that add up
- Pinned by `health-score.test.ts`, including that a perfect score is
  impossible while a budget is over

**Import explains itself before you drop a file**

The app's most prominent button opened a dropzone reading "Drop a CSV or PDF
statement here", and only objected after a file was chosen. For an app whose
claim is that your data never leaves your machine, inviting a stranger to drag
a real bank statement into a page on github.io and explaining afterwards is the
wrong order. In demo builds it now says up front why it's off, and what the
feature does when you run it yourself.

**The demo's Planner works**

It rendered blank. `/api/planner/status` returned `{ profile: "demo" }` where
the page expected a numbers object, so `fmtMoney(undefined)` threw during
render and React unmounted the route. The chat handler had the same problem one
layer down: it parsed the question and then dropped the result, so no scenario
ever ran.

- The demo builds a real profile from its own transactions and runs the actual
  scenario engine — "buy a house for $450k with 20% down" now answers with
  $103,500 upfront and a 24-month projection, same as the installed app
- `runScenario`, `statsFromSeries`, `profileAverages` and `fallbackReply` moved
  from `plannerService` (which imports Prisma) into the pure `scenarios` engine
  so both the server and the browser run one copy
- Saved conversations save, list, load, update and delete in the demo
- `ParsedIntent` is a discriminated union instead of
  `Record<string, number | string>`, removing the `as any` casts from the one
  function that decides which arithmetic runs
- `asDate` no longer returns an invalid Date, which was one missing timestamp
  away from blanking a page the same way

**Chart colour means one thing again**

Green and crimson had drifted from "money in / money out" to "good / bad", and
once that happens the income chart can't be trusted either. The amortization
chart showed it plainly: principal in green, interest in crimson, when both are
cash leaving your account on the same day.

- New `client/src/lib/chartPalette.ts` splits semantic colour (`in`, `out`)
  from categorical colour (`series[0..3]`, `muted`, `reference`). Green and
  crimson are now reserved for the direction money moved
- Principal vs interest, Roth vs brokerage, scenario vs baseline, goal
  progress, budget bars under 100% and the FIRE target line all moved off the
  verdict colours
- The palette is mode-aware (`useChartColors()`): no crimson clears 3:1 on both
  white and the dark panel while still looking like crimson
- `server/src/tests/chart-palette.test.ts` pins contrast and colour-blind
  separability per chart. It caught the money-out crimson sitting at 2.2:1 in
  dark mode, and that the money pair is carried almost entirely by lightness —
  `in` moved to emerald-500 to widen that gap

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

- **Rate limiting on the API** (`server/src/lib/rateLimit.ts`). Running on
  localhost this never fires — the ceiling is 300 requests/minute and a
  dashboard load is about a dozen. It exists for the hosted mode, where the
  server is reachable from the internet: an unauthenticated endpoint answering
  as fast as it can be asked is a free denial-of-service. `/api/auth` is much
  tighter (30 per 5 minutes) because that's where passwords get guessed —
  `authService` already locks a *profile* after repeated failures, but this
  limits an *address*, which is what stops one guess being sprayed across many
  usernames. `/api/health` is deliberately exempt: Docker and the desktop shell
  poll it, and a limiter that can fail a healthcheck is worse than none.
  Written in-house rather than adding `express-rate-limit` — it's forty lines
  of arithmetic, it's unit-tested directly (9 tests, including the exactly-at-
  the-limit boundary and that expired windows get pruned so the limiter can't
  become the memory leak it was added to prevent), and it keeps a dependency
  off the request path of a finance app. Overridable with
  `IKID_RATE_LIMIT_MAX` / `IKID_AUTH_RATE_LIMIT_MAX`
- **Logger no longer treats messages as format strings.** `console.log(line,
  meta)` makes `line` a format string, so a `%s` anywhere in a logged message —
  a filename, a merchant name, an error from a parsed statement — would swallow
  the metadata and print a line describing something that never happened. Now
  always a single argument, so there's nothing to substitute into
- CodeQL scope narrowed again: `.github/skills` and `.github/hooks` hold 44,168
  lines of vendored developer tooling — more than twice the app itself — and
  were the source of most remaining alerts (HTML-filtering regexes, insecure
  randomness, in a browser-automation tool). Not shipped, not ours to fix
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
