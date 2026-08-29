# The hosted demo

**Live at [damare42.github.io/ikid/demo/](https://damare42.github.io/ikid/demo/)**

Nobody installs a personal finance app to evaluate it. The demo is the real
application, running on two years of invented data, entirely inside the
visitor's browser — no server, no account, no upload.

## The one idea

It is not a demo build of the UI. Every page, hook, component and chart is the
shipping one, unmodified. A single branch in `client/src/lib/api.ts` sends
requests to an in-browser router instead of `fetch`:

```
client/src/demo/
  store.ts     in-memory tables + the seeding pass
  router.ts    "METHOD /api/path" → handler
  data.ts      query helpers (what the repository layer does on the server)
  core.ts      transactions, categories, budgets, goals, settings, imports
  analytics.ts the dashboard, trends and breakdowns
  planning.ts  net worth, bills, reconcile, calculators, retirement, planner
  stubs.ts     what genuinely can't work offline, and why
```

A demo that forked the UI would stop being evidence that the app works, which
is the only reason to have one.

## Why it can't quietly drift from the product

Three deliberate choices, in order of how much they matter:

1. **The dataset is built by `loadDemoInto()`** — the same function the
   installed app uses for its own demo mode — against an object satisfying the
   same `DemoDb` interface it normally gets from Prisma. The generator and the
   demo are the same code.
2. **The engines are shared, not reimplemented.** `finmath`, `retirement`,
   `debtPayoff`, `goalMath`, `scenarios`, `billsCore` and `reconcileCore` are
   pure TypeScript and run unchanged in a browser, reached through the
   `@engine` alias. Calculators, bills and reconciliation compute with the
   server's arithmetic.
3. **`analyticsTypes.ts` owns the accounting conventions** — the four
   predicates deciding what counts as income, spending, a transfer and an
   investment. The demo imports them rather than restating them. A drifting
   copy of *those* is what would make the demo disagree with the product about
   the only thing it exists to demonstrate.

## What the demo refuses to fake

Backups explain there is no database file. Statement import explains the demo
comes pre-filled. The planner's local-AI panel explains that Ollama runs on
your own machine and a web page can't reach it — while the deterministic
scenario engine still answers, because it's pure. Never a fake success, never
a silent failure.

The JSON export *does* work, because "your data is yours" is the product's
central claim and a demo that couldn't demonstrate it would be arguing against
itself.

## Building and previewing it

```bash
npm run build:demo      # → site/demo/
npm run preview:demo    # → http://localhost:4173/ikid/demo/
```

**Opening `site/demo/index.html` directly will not work**, and neither will
serving `site/` at a web root. The bundle is built with `--base=/ikid/demo/`
because that is where it is deployed, so its asset URLs are absolute:
`/ikid/demo/assets/…`. `preview:demo` runs Vite's preview server with the same
base, which is the only local setup that matches production.

That delegates to the `client` workspace and then runs
`scripts/verify-demo-build.mjs`. **The working directory matters**: Tailwind
resolves its config file and its content globs from the process CWD, so
building from the repo root produces a stylesheet with no utility classes and
an app that renders as a column of unstyled text. That shipped once. The
config now uses absolute globs and the script runs in the right directory, and
the verifier fails the build if the stylesheet comes out empty anyway.

The verifier checks what a visitor actually receives:

- utility classes are present in the CSS
- the generated dataset is in the bundle
- no server database code leaked in
- asset URLs match the deploy base (`/ikid/demo/`)

It runs locally and in the Pages workflow, because "it compiled" and "it looks
right" are different questions.

## How it stays out of the installed app

By module resolution, not dead-code elimination. `@demo` points at the real
implementation only in a demo build (`--mode demo`) and at a throwing stub
otherwise. Relying on Vite folding away the branch was tried first and didn't
work — the dynamic import stayed reachable and the normal build failed trying
to bundle `node:crypto`. Resolution either works or fails loudly at build time.

Normal build: 687 modules. Demo build: 709.

`node:crypto` is aliased, demo-only, to a shim in `src/demo/node-crypto-shim.ts`
that is deliberately **not** SHA-256 and says so — it gives generated rows
distinct keys, and nothing security-relevant depends on it.

## Tests

`server/src/tests/demo-api.test.ts` drives the same handlers the browser calls,
across every endpoint the client is known to request — a blank screen in a
marketing demo is worse than no demo. It also pins that the generated world
obeys the app's accounting invariants (net savings is exactly income minus
spending, the savings rate is plausible), that reconciliation's core identity
holds, and that the refusals above explain themselves.
