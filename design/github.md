repo: damare42/ikid
branch: main
path: client/src

## Last sync
date: 2026-08-14T00:00:00Z
_(commit unknown — imported by tree read, not a resolved commit)_

### Updated in this project
- Full UI redesign onto Modernist (flat, red-on-white, Archivo, 2px rules, zero radius), Broadsheet (top-nav editorial) direction chosen.
- Desktop app: Dashboard, Transactions, Budgets, Goals, Net Worth, Planner, Analytics (4 tabs), Settings, Import dialog, dark-mode toggle.
- New landing + sign-in/sign-up with the reworked "journey" route motif; mobile app with bottom tab bar + dark mode.
- Added loading/empty/error states for all eight data-backed screens, plus a 701–1100px tablet breakpoint (container-query driven).
- Added design_handoff_ikid_redesign/ — README with token mappings, per-screen specs, state copy tables and an a11y punch list.

## Screen map
| Project screen | Repo source |
| --- | --- |
| Dashboard Redesign.dc.html (1a, 1b) | client/src/pages/Dashboard.tsx, client/src/App.tsx |
| Ikid App.dc.html | client/src/App.tsx, pages/Dashboard, Transactions, Budgets, Goals, NetWorth, Planner, Analytics, Settings, components/ImportDialog.tsx |
| Ikid Landing.dc.html | client/src/pages/Landing.tsx, components/LoginScreen.tsx, SignupScreen.tsx |
| Ikid Mobile.dc.html | client/src/App.tsx (nav), pages/Dashboard, Transactions, Budgets, Goals |
