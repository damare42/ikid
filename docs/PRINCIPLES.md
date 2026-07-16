# ikid Principles

ikid exists to answer one question: **"Can I afford this, and what happens if
I do?"** — using only the user's own data, on the user's own machine. Every
feature either serves that question or doesn't belong. This document is the
test we hold every change against, so the project can grow without becoming
the thing it was built to escape.

## The three rules

**1. No network calls to third parties.**
The app makes zero requests beyond the user's machine (localhost, and the
user's own LAN/server in self-hosted mode). No cloud accounts, no telemetry,
no "anonymous" analytics, no CDN-loaded code at runtime, no phoning home for
updates. The only sanctioned external process is Ollama, which the user
installs themselves and which also runs entirely locally. Privacy here is
architectural, not a policy promise — there is nothing to leak because
nothing leaves.

**2. Numbers come from deterministic, tested code.**
Every figure ikid shows — a savings rate, a mortgage payment, a goal date —
is produced by a pure function with unit tests. The local AI may *narrate*
results and translate questions into scenarios; it never calculates. Same
inputs, same answer, every time. If a number can't be computed
deterministically, we show nothing rather than a guess.

**3. Every number is auditable.**
Any total, chart, or insight must be traceable to the transactions behind it,
ideally in one click. Learned categorization rules are visible and deletable
in Settings, never hidden model weights. The user should always be able to
answer "where did this number come from?" without trusting us.

## The feature test

Before building anything, it must pass all of:

1. Does it work with **zero third-party network calls**? (Rule 1)
2. Are its numbers **deterministic and testable**? (Rule 2)
3. Can the user **audit** its output down to source data? (Rule 3)
4. Does it help someone **make a decision**, not just admire their data?
5. Can a household user understand it **without reading docs**?

A feature that fails 1–3 is rejected or redesigned. A feature that fails 4–5
goes to the back of the queue.

## What we build freely (deepens the core)

Local data in, local math out, better decisions:

- Net worth: assets, liabilities, balance history
- Loan payoff, mortgage amortization, and retirement projections in the Planner
- Import profiles (remember each bank's format), more formats (OFX/QIF),
  local OCR for scanned PDFs
- Rules engine improvements (amount ranges, account scoping, regex)
- Smarter recurring/subscription detection, merchant normalization
- Better reports, exports, and accessibility

## What we build carefully (needs guardrails)

- **Multi-device access.** The answer is the self-hosted install, a
  mobile-friendly UI, and *encrypted export/import* the user moves through
  their own channels. Never an ikid-operated sync service.
- **Investment prices.** Holdings are local data; live quotes are a network
  call. Manual price entry is the default. If fetching is ever added, it is
  off by default, opt-in per user, names the exact endpoint it calls, and is
  trivially auditable.
- **Anything involving the AI.** New AI features narrate and route; the
  engine computes. The AI receives summaries, never raw transaction dumps,
  and works identically when absent.

## What we will never build

- Bank credential aggregation (Plaid and friends) — users export statements
  themselves; no credentials are ever shared with anyone, including us
- Cloud accounts or an ikid-hosted backend of any kind
- Telemetry, crash reporting to third parties, or usage analytics
- Ads, affiliate placements, or "offers"
- Hosted/remote AI
- Selling, sharing, or monetizing user data — structurally impossible anyway,
  since we never have it

If ikid someday needs money to sustain development, the acceptable models are
ones that preserve the architecture: paid support, signed binaries, or
donations. Never the data.

## Engineering guardrails

- Business logic lives in `server/src/services/` as pure functions;
  **new logic ships with unit tests** — that's the price of admission.
- Routes stay thin (validation + wiring). Repositories are the only database
  access. Shared DTOs in `shared/types.ts` keep client and server honest.
- Accounting invariants are sacred: transfers are never income or spending;
  investments are contributions, not consumption; amounts are signed
  (negative = money out); duplicate imports are idempotent.
- Data safety: every schema change is preceded by an automatic backup of
  every profile database. Migrations must be tested against a seeded copy.
- Performance budget: 100k+ transactions must stay responsive; imports finish
  in seconds.
- Dependencies are a liability. Prefer the standard library; every new
  package needs a reason.

## How to use this document

PR reviews cite it ("fails rule 1", "needs an audit path"). Feature requests
get triaged into the three buckets above. And when a change would require
editing *this file* — that's the signal it's not a feature decision anymore,
it's a fork in the project's identity, and it deserves a proper discussion
first.
