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
