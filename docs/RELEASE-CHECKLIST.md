# Release checklist

What to run before tagging, and what "green" looks like. Everything below was
verified for **0.6.0** from a clean checkout (fresh `npm install`, no cached
build artifacts).

## Automated gates

```bash
npm install            # clean install
npm run db:setup       # generate client + push schema + seed
npm test               # server suite
npm run lint           # eslint, client + server
npm run build          # generate -> server typecheck -> client production build
```

| Gate | 0.6.0 result |
| --- | --- |
| `npm test` | **147 passing**, 14 files |
| server typecheck | clean |
| client typecheck | clean |
| `npm run lint` | 0 errors |
| `npm run build` | client bundle built, 674 modules |

If `prisma generate` fails with a **403 fetching a checksum**, you're offline or
behind a proxy — set `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`. That's an
environment problem, not a code failure.

## Manual smoke (5 minutes, real browser)

Run `npm run dev`, then walk:

1. **Dashboard** loads; month and YTD toggle; click a pie slice → drills into
   Transactions filtered, back arrow returns to the same month.
2. **Transactions** — search, each filter (incl. ⚠ Unassigned), sort by date and
   amount, pagination, select rows → bulk assign to an account, edit a
   transaction (category / account / merchant / tags), add one manually.
3. **Import** — drop a CSV, review screen shows duplicates, tick "import anyway"
   on one, commit; Settings → Import History shows it and can rename it.
4. **Accounts** — balances and freshness badges look right; "Upload →" opens the
   importer preselected.
5. **Net Worth / Budgets / Goals** — add, edit, delete one of each.
6. **Planner** — ask a scenario question; **Calculators** — each tab computes and
   saves; **Retirement** — simulation runs, bridge plan renders.
7. **Settings** — change theme (light/dark/system), currency; backup runs.
8. **Admin** (admin account only) — user list, toggle sign-ups.
9. Sign out → sign back in.

## Accessibility gates

- `npm test` includes **25 contrast tests** covering every text token in light
  and dark. They fail the build if a palette change drops text below WCAG AA.
- Manual: tab through the app — focus is always visible; the active nav item is
  identifiable without relying on colour (it has a left rule and bolder weight).

## Data safety

- Confirm no real data is committed: `git ls-files database/ | grep -v .gitkeep`
  must print **nothing**.
- Schema changes auto-backup each profile to `database/backups/pre-<version>/`
  on first start.

## Tagging

```bash
git tag v0.6.0
git push origin v0.6.0     # release workflow builds desktop installers
```

Desktop installers are unsigned — first launch needs right-click → Open on
macOS (see `docs/DESKTOP.md`).
