# What we can learn from CashFlux

Notes from studying [monstercameron/CashFlux](https://github.com/monstercameron/CashFlux) —
a local-first budgeting app with goals close to ikid's. Different stack (Go compiled
to WebAssembly, SQLite running *in the browser tab*, no server), same convictions:
local-first, deterministic, explainable, no lock-in.

This is a prioritised list of what's worth taking, what isn't, and why — not a
feature wishlist. Each item is scored by **value to an ikid user ÷ effort**.

---

## 🔴 The one real correctness issue: money stored as float

CashFlux states it as a principle:

> **Money is never a float.** Amounts are integer minor units (cents) with an
> explicit currency; rounding is intentional, not an accident of IEEE-754.

**ikid stores money as `Float`** (`Transaction.amount`, `balance`, `Budget.monthlyLimit`,
`Goal.targetAmount`, `AssetSnapshot.value`, …). That is a genuine latent bug in a
finance app.

**Measured on the real 1,211-transaction database:**

| | |
| --- | --- |
| Float sum (what ikid computes) | `22220.499999999956` |
| Exact sum (integer cents) | `22220.5` |
| Error | `4.4e-11` |

**Honest severity: low today, structural long-term.** Every displayed figure is
rounded by `fmtMoney`, so *you have never seen a wrong number*. The error is
invisible at this scale. But it is real, it grows with transaction count and with
chained arithmetic, and it makes exact comparisons (`total === 0`,
`spent === limit`) unreliable — the classic `0.1 + 0.2 !== 0.3`.

**Recommendation:** don't panic-migrate. A full move to integer cents touches the
schema, every service, every DTO, and the import pipeline — a large, risky change
for a benefit users can't currently see. Instead:

1. **Now (cheap):** add a `money.ts` helper with `addMoney`/`sumMoney` that round
   to cents at each accumulation step, and use it in the aggregation paths
   (analytics totals, account balances, budget spend). Kills the drift without a
   migration.
2. **Later (0.7+):** if ikid ever handles multiple currencies or higher volumes,
   migrate to integer cents properly, with a data migration and the same
   transparent-upgrade discipline used for password hashes.

---

## 🟢 High value, low effort — do these next

### 1. A live demo with sample data
CashFlux's single biggest adoption advantage: **[a GitHub Pages demo](https://monstercameron.github.io/CashFlux/)**
with a *Load sample* button. Nobody installs a finance app to evaluate it.

ikid deliberately removed sample data (you asked for it early on — correct for
*your* database). But a **demo mode** is different: a seeded, obviously-fake
dataset behind a flag, so the marketing site can link to something people can
touch. ikid needs a server, so it can't be pure-static like CashFlux — but a
hosted read-only demo instance, or a "Load demo data / Reset demo" button in a
throwaway profile, gets 90% of the benefit.

### 2. Lossless JSON export ("no lock-in")
CashFlux: *"Everything round-trips to plain JSON/CSV. Leave any time."* ikid has
CSV export and DB backup, but no single human-readable export of everything.
Cheap to add, and it makes the local-first promise concrete: the export **is**
the thing that proves you're not locked in.

### 3. Debt payoff strategies: snowball vs avalanche
ikid already has the amortisation and payoff maths (`finmath.ts`). What's missing
is the **multi-debt comparison** — order by smallest balance (snowball) vs highest
rate (avalanche), show total interest and payoff date for each. It's the most-loved
feature in this category and it's mostly a sort plus a loop over maths we already
have and already test.

### 4. Reconciliation (cleared vs uncleared)
A `cleared` flag per transaction plus a "reconcile to statement balance" screen.
This is what turns "I imported some rows" into "my books match the bank." Small
schema change, genuine accounting value — and it pairs naturally with ikid's
existing per-account "where did I leave off" tracking.

---

## 🟡 Worth doing, more effort

- **Bills & renewal calendar** — ikid detects recurring payments in Analytics but
  doesn't project them forward into "what's due in the next 30 days."
  Subscription **price-change alerts** ("Netflix went from $15.49 → $17.99") are a
  genuinely delightful touch on top of detection we already do.
- **Zero-based / envelope budgeting** — ikid does simple per-category limits.
  Zero-based ("give every dollar a job", with a to-assign banner) is YNAB's core
  method and has a devoted following. A budgeting-method setting rather than a
  rewrite.
- **PWA / installable** — ikid ships a desktop app, but an installable, offline-
  tolerant web client would serve self-hosted users well.
- **Multi-currency with an FX table** — ikid has a currency *setting* but assumes
  one currency everywhere. Only worth it if you actually hold multi-currency
  accounts; note this is the change that most wants integer-cents money first.

---

## ⚪️ Deliberately not copying

- **Bento dashboard** (drag-to-reorder, resizable tiles) — lovely, but high effort
  and it fights the redesign's editorial, opinionated layout. A designed dashboard
  that's right beats a configurable one that's fiddly.
- **Formula engine, custom fields, custom pages** — real power-user depth, but it
  is exactly the "loosening types into untyped soup" that ikid's principles warn
  about, and a large surface to secure and test.
- **Workflows / automation engine** — same reasoning; revisit only if users ask.
- **Go/WASM architecture** — CashFlux's genuinely clever bit (whole app + SQLite
  in the tab, no server). Not a migration path for ikid; noted with admiration.
- **AI receipt scanning via OpenAI** — CashFlux is careful about it (your key,
  your click). It still breaks ikid's rule 1 (no third-party network calls). Local
  OCR would be the ikid-compatible version.

---

## ✅ Where ikid is already ahead

Worth stating, because it shapes what to protect:

- **Retirement depth.** ikid's account-type-aware drawdown — Roth conversion
  ladders with 5-year seasoning, RMDs on the Uniform Lifetime Table, the 59½
  bridge, IRMAA thresholds, real 2026 federal brackets — is well beyond
  CashFlux's payoff/forecast tools. This is ikid's genuine differentiator.
- **Statement import.** CSV *and* PDF, with column auto-detection, learned
  categorisation rules, merchant normalisation, and a review step.
- **Security posture.** scrypt at OWASP-equivalent cost with transparent upgrade,
  a tested error-handler contract, isolation verified against the policy,
  Dependabot + CodeQL + CI gates.
- **Accessibility.** 25 contrast regression tests pinning every text token.
  (CashFlux validates theme tokens for WCAG AA too — good independent
  confirmation that this was the right investment.)

## 🤝 Convergent conclusions (reassuring)

Two independently-built local-first finance apps landed on the same rules:
deterministic and explainable maths, every figure traceable to its transactions,
pure logic separated from UI and table-tested, WCAG-validated design tokens, and
no lock-in. Where ikid's `PRINCIPLES.md` and CashFlux's principles agree, that's
about as much validation as an architecture decision gets.

**Their honesty is worth emulating too** — the README states the WASM bundle-size
trade-off plainly instead of hiding it. ikid's "what ikid is not" section on the
marketing site is the same instinct; keep it.
