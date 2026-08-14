# START HERE — Ikid redesign implementation

You are picking up a completed design package and implementing it in the Ikid codebase.

## Read in this order

1. **`README.md`** — the specification. Tokens, per-screen layouts, all state copy, interactions,
   responsive rules, accessibility punch list. This is the source of truth; read it fully before
   writing code.
2. **`tokens.json`** — the same design tokens, machine-readable, light + dark. Generate your
   CSS variables / theme config from this rather than retyping hex values.
3. **`github.md`** — which repo and subtree this was designed against, and the screen → source-file map.
4. **The prototypes** — open them in a browser to see behavior the prose can't carry.

## What's in here

| File | Role |
| --- | --- |
| `README.md` | The specification — read first |
| `tokens.json` | Design tokens, light + dark, machine-readable |
| `github.md` | Repo, branch, subtree, screen → source-file map |
| `Ikid App.dc.html` | **The primary artifact.** Desktop app: 13 screens, import flow (5 stages incl. column mapping), dark mode, loading/empty/error/partial states, tablet breakpoint |
| `Ikid Mobile.dc.html` | Mobile app: 4 tabs, the same 3 states per tab, dark mode |
| `Ikid Landing.dc.html` | Marketing landing + sign-in / sign-up |
| `Dashboard Redesign.dc.html` | The two dashboard directions explored before this one (`1a`, `1b`) |
| `Ikid Design Analysis.dc.html` | Audit of the original UI and why this direction was chosen |
| `Ikid Nav Options.dc.html`, `Ikid Logo Options.dc.html`, `Ikid Mobile Options.dc.html` | Rejected alternatives — context for *why*, not things to build |
| `styles.css` | The Modernist design system stylesheet — the token source |
| `_ds/modernist-.../` | The design system as the prototypes load it (stylesheet, bundle, its own readme) |
| `support.js`, `ios-frame.jsx` | Runtime the prototype HTML needs to render. **Not** app code — do not port |

## How to open a prototype

They are plain HTML with relative asset paths. Serve the folder, don't open via `file://`:

```
cd design_handoff_ikid_redesign && python3 -m http.server 8000
# then http://localhost:8000/Ikid%20App.dc.html
```

In `Ikid App.dc.html`, the dashed bar at the top switches **Prototype states**
(Data / Loading / Empty / Error / Partial) and **Frame** (Desktop / Tablet 900). Use it to see every
state without editing anything. `Ikid Mobile.dc.html` has the same switch beside the first phone.

## Rules for the implementation

1. **These HTML files are design references, not code to port.** Rebuild the screens in the repo's
   existing React environment with its own components and patterns. Take exact values from
   `README.md` / `tokens.json`.
2. **Do not build the prototype-only chrome**: the dashed states/frame bar, and the 2.4s splash
   animation on first mount. The splash stands in for app boot — ship the skeleton states instead.
3. **`support.js` and `ios-frame.jsx` are prototype runtime.** Never import them into the app.
4. **Radius rule is deliberate and easy to get wrong**: `0` on all structure (sections, rules, tables,
   dialogs, tags, inputs), `9px` only on interactive chrome (buttons, icon buttons, avatar, menu).
5. **The app overrides some design-system tokens on purpose** (accent `#c62f14`, not the stock
   `#ec3013`; a white `--panel` above the ground). Use the overrides in `tokens.json`, not the raw
   design-system values.
6. **Sample data is illustrative.** Every number in the mocks is invented. Never ship a hard-coded one.
7. **State copy is final** — implement the empty/error strings verbatim from the README's tables.
8. Work screen by screen and build each screen's three states with the screen, not as a later pass.

## Suggested build order

1. Shell — rail, header, avatar menu, dark-mode token layer, tablet nav swap.
2. **Transactions** — hardest layout; exercises the table, selection bar, sort, filters and all three
   states. Establish the state pattern here.
3. Dashboard (incl. the partial-failure section pattern).
4. Budgets, Goals, Accounts, Net Worth.
5. Analytics, Reports.
6. Import flow, including the column-mapping stage.
7. Planner, Calculators, Retirement, Settings, Admin.
8. Mobile.

## Known open questions — ask before inventing an answer

- Database file missing / moved at launch (distinct from a read error) — not designed.
- Mid-import cancel at the review stage: discard silently or confirm? — not designed.
- Transaction list virtualisation strategy — flagged, not designed.
- Whether tablet (701–1100px) keeps the desktop layout or switches to the mobile app shell in the
  real product. The design assumes desktop-layout-with-top-nav; ≤700px uses the mobile design.
