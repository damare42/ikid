# Contributing to Ikid

Thanks for your interest! Ikid is a local-first personal finance app — the two
non-negotiable design rules are:

1. **No network calls to third parties.** Everything runs on the user's machine.
2. **Numbers come from deterministic, tested code.** The optional local AI only
   narrates; it never calculates.

## Getting started

```bash
nvm use            # Node 22 (>=20 works)
npm install        # installs root + server + client
npm run dev        # SQLite setup/seed + API :3001 + Vite :5173
```

## Project layout

- `server/` — Express + TypeScript. Routes are thin and zod-validated,
  services hold all business logic, repositories are the only DB access.
- `client/` — React 18 + Vite + Tailwind + Recharts.
- `shared/types.ts` — DTOs shared across the wire.
- `database/` — one SQLite file per profile (never committed).

## Before opening a PR

```bash
npm test           # vitest — pure logic must stay covered
npm run build      # typechecks server + builds client
npm run lint
```

Add or update unit tests for anything in `server/src/services/` — parsers,
categorization, dedupe, scenario math, and merchant normalization are all
pure functions with existing test files to extend.

## Reporting bugs

Include your OS, Node version, and (if an import issue) a few *redacted* CSV
rows that reproduce it — never post real transactions.
