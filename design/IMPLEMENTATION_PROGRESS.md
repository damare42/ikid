# Redesign implementation progress

Tracking the port of the Modernist design (this folder) into the app, on the
`redesign` branch. Build order follows `START_HERE.md`.

## Done — foundation (theme layer)

The whole app now inherits the new look via two remapped Tailwind palettes,
so existing `slate-*` / `brand-*` classes adopt the tokens without touching
every component:

- **Accent** — `brand` repointed to the brick-red accent (`brand-600` = `#c62f14`);
  primary buttons, links, and active nav are now accent, not the old green.
- **Warm neutrals** — `slate` repointed to the Modernist neutral ramp; light
  surfaces, borders, and text, plus dark `bg`/`panel`, land on the tokens in
  both modes.
- **Type** — Archivo loaded and set as the base/sans + heading font; headings
  are extra-bold with tight tracking.
- **Radius rule** — structure is square (`.card`, `.input` → radius 0); only
  interactive chrome keeps 9px (`.btn*` → `rounded-chrome`). Semantic
  `pos` / `neg` / `warn` colors added from tokens.
- Favicon recolored to the accent.

Files: `client/tailwind.config.js`, `client/src/index.css`, `client/index.html`.

## Done — Shell (rail, header, avatar menu)

- **Rail** rebuilt to 222px, panel bg, square structure, Archivo nav. Flat nav
  replaced by the three collapsible groups — **Money** (Dashboard, Transactions,
  Accounts, Budgets, Goals), **Plan** (Net Worth, Planner, Calculators,
  Retirement), **Insight** (Analytics, Reports). Group open/closed persists in
  localStorage; active item = accent text (no filled pill), per spec.
- **Settings, Admin, Sign out, and profile switching moved into a 34px avatar
  menu** in the header (was: rail select + footer sign-out button). Open-mode
  profile list + New profile live there too.
- **Header** is now 64px with a section kicker (left), centered search, primary
  ↑ Import, theme toggle, and the avatar. Main content constrained to the
  1200px wrap.
- Rail hides below `md` (tablet/mobile) — a proper top-nav bar for that
  breakpoint is still to come (see mobile pass).

## Done — app-wide colour + primitives

- **Chart / semantic recolour** across every page: old brand-green `#1cb474`
  → token `pos` `#1a7f5a` (income/positive), expense rose `#f43f5e` → `neg`
  `#c62f14`. Charts read in the token palette everywhere now.
- **Logo** recoloured to the accent (brick red) — wordmark + mark.
- **UI primitives** (`components/ui.tsx`): kicker stat labels, heavy Archivo
  stat figures, `bad` tone → accent, square category badges, and the error
  device is now a 2px accent left-rule block.

The whole app now reads in the new design system — warm neutrals, brick-red
accent, Archivo, square cards/inputs/tables, token chart colours — on **every**
screen, via the theme + shell + primitives, without a per-screen rewrite.

## Done — app-wide coherence pass

- **Transactions** rebuilt to the new look with every function intact (search,
  all filters incl. Unassigned, sort, pagination, row-select + bulk assign,
  edit dialog, add dialog, drill-down back) plus a header kicker, a pulsing
  table **loading skeleton** (`aria-busy`), and a filter-aware **empty state**.
- **Page titles** across all 12 screens → heavy Archivo (`text-2xl`
  extra-bold, tight tracking) with the kicker treatment.
- **Badges/pills** recoloured from indigo → accent; role/admin chips match.
- **Square structure** applied to structural `rounded-xl` panels app-wide;
  chat bubbles kept at the 14px bubble radius; inputs/cards already square.
- **Fix**: removed the fragile `@apply font-heading` (raw font-family) that
  broke the dev server on config reload.

Verified each step: client typecheck + eslint + production build, and the full
server test suite (116 passing). Server code was untouched by the redesign.

## Done — accessibility hardening (measured)

Contrast computed with the WCAG relative-luminance formula; AA needs 4.5:1 for
normal text. The old green palette failed badly (`#1cb474` on white = **2.68**,
green button = **3.97**), which is a large part of why the new direction was
adopted.

| Token | Ratio | |
| --- | --- | --- |
| accent `#c62f14` on white (actions) | 5.50 | AA ✓ |
| **neg `#a4123a`** on white (money out) | 7.70 | AA ✓ |
| neg dark `#ffa2b8` on panel | 8.79 | AA ✓ |
| pos `#1a7f5a` on white | 4.97 | AA ✓ |
| active nav `#a82710` on panel | 7.09 | AA ✓ |
| active nav dark `#df5f42` on panel | 4.63 | AA ✓ |

Three fixes applied:

1. **Negative is no longer the brand colour.** `neg` moved from the brick-red
   accent to a distinct crimson `#a4123a` (dark: `#ffa2b8`), so "primary
   action" and "money out" never read as the same colour. All expense /
   liability / interest / tax chart series and the over-budget bar use it; the
   logo and buttons keep the accent.
2. **Kicker floor raised 10px → 12px** across every page and the shell —
   small-caps labels were below the usual legibility floor.
3. **Active nav no longer signalled by colour alone** (WCAG 1.4.1): accent text
   **plus** a 2px left rule and heavier weight. `NavLink` still emits
   `aria-current="page"` for screen readers.

Still an inherent risk, by design: income/expense remain green/red, so charts
**must** keep pairing colour with a text label — never colour alone.

## Remaining — per-screen detail (larger, bespoke work)

Do these screen by screen, build/lint/verify per step:

1. **Loading skeletons** — per-screen shapes (cards / table / bars / chart)
   replacing the single spinner, `aria-busy` + 150ms delay.
2. **Empty / error / partial copy** — verbatim from `README.md`, incl. the
   Dashboard partial-failure section pattern.
3. **Transactions table** — exact `96px 1fr …` grid, sticky header + selection
   bar, row-hover rule, virtualisation for large lists.
4. **Import column-mapping stage** — the 3-column mapping grid + "remember this
   layout" (not built yet).
5. **Structural radius** on secondary inline panels/chips (square structure;
   keep 9px chrome and 14px chat bubbles).
6. **Mobile / tablet** — the ≤1100px top-nav bar replacing the rail, and the
   4-tab phone layout (`Ikid Mobile.dc.html`).
7. **Landing** — full marketing redesign to `Ikid Landing.dc.html` (its mock
   colours were swept to token green as a stopgap; hero/brand should move to
   the accent + Archivo).
8. **Lucide icons** — replace emoji nav/labels with the Lucide set (18–20px,
   stroke 2).
