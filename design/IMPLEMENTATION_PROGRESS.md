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

## Next — screen by screen (per START_HERE build order)

1. **Shell** — rail width (222px), header, avatar menu, dark-mode polish, tablet nav swap.
2. **Transactions** — table, selection bar, sort/filters, and the 3 states (loading/empty/error).
3. Dashboard (incl. partial-failure section pattern).
4. Budgets, Goals, Accounts, Net Worth.
5. Analytics, Reports.
6. Import flow (+ column-mapping stage).
7. Planner, Calculators, Retirement, Settings, Admin.
8. Mobile.

## Notes / not yet touched

- Landing page and `Logo` component still use the old green + Fraunces/Space
  Grotesk; they carry inline hex and need a dedicated pass (see `Ikid Landing.dc.html`).
- Recharts series colors are still inline greens/roses in each page; migrate to
  the `category` tokens per chart during each screen's pass.
- Per-screen state copy (empty/error strings) to be taken verbatim from `README.md`.
