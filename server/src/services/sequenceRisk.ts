/**
 * Test a withdrawal plan against every start year in the record.
 *
 * The question a single smooth projection answers is "does this work on
 * average". The question people actually have is "does this work if I am
 * unlucky", and those have very different answers once money is coming out.
 *
 * Withdrawing a fixed real amount from a falling portfolio sells more shares to
 * raise the same income, and those shares are not there for the recovery. Two
 * retirees with identical thirty-year *average* returns finish in wildly
 * different places depending on the order the returns arrived. That asymmetry —
 * sequence-of-returns risk — is why Bengen's 1994 paper landed on 4% rather
 * than the ~7% a long-run average would imply: he found the worst starting year
 * and asked what survived it.
 *
 * ---------------------------------------------------------------------------
 * What "success" means here, precisely
 *
 * A cohort succeeds if the portfolio is above zero at the end of the horizon.
 * That is the Trinity study's definition and it is a low bar: ending with
 * $1 counts, and so does spending the last decade watching the balance fall.
 * `finalBalances` and `worst` are reported alongside the rate so the bar is
 * visible rather than implied.
 *
 * Everything is computed in real terms — withdrawals rise with each year's
 * actual CPI, returns are deflated by it — so a result is in today's money and
 * the 1970s cost what they actually cost.
 */
import {
  type MarketYear, blendedReturn, realReturn, startYears, window,
} from "./marketHistory.js";

export interface SequencePlan {
  /** Portfolio at retirement, in today's dollars. */
  initialBalance: number;
  /** First-year withdrawal, in today's dollars. Rises with realised inflation. */
  annualWithdrawal: number;
  /** Years the money must last. */
  years: number;
  /** 0–100. The rest is bonds. */
  equityPct: number;
  /**
   * Annual fee drag: fund expense ratios plus any advisory fee, in percent.
   * Default 0.1 — roughly a broad index fund. It is small and it compounds:
   * 1% a year over 30 years takes about a quarter of the ending balance, which
   * is why it is an explicit input rather than an omission.
   */
  feePct?: number;
}

export interface CohortResult {
  startYear: number;
  survived: boolean;
  /** Real ending balance, today's dollars. Zero if it ran out. */
  finalBalance: number;
  /** Year the money ran out, or null. */
  depletedIn: number | null;
  /** Lowest real balance reached — how close it came. */
  lowestBalance: number;
}

export interface SequenceResult {
  cohorts: CohortResult[];
  /** Share of start years that finished above zero, 0–1. */
  successRate: number;
  /** The cohort that did worst. The number that actually matters. */
  worst: CohortResult;
  median: CohortResult;
  best: CohortResult;
  /** First-year withdrawal ÷ initial balance, as a percentage. */
  withdrawalRatePct: number;
  /** How many start years were tested, and over what span. */
  cohortCount: number;
  firstStart: number;
  lastStart: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** One cohort: retire on 1 January of `startYear` and live through the window. */
export function runCohort(plan: SequencePlan, years: MarketYear[]): CohortResult {
  const fee = plan.feePct ?? 0.1;
  let balance = plan.initialBalance;
  // Withdrawals are specified in today's dollars and tracked in the same terms,
  // so inflation enters through the *return*, not by inflating the withdrawal.
  // Deflating both would double-count it.
  const withdrawal = plan.annualWithdrawal;
  let lowest = balance;
  let depletedIn: number | null = null;

  for (const y of years) {
    // Withdraw at the start of the year — the pessimistic and realistic choice.
    // You spend in January; you don't get a year's growth on money you spent.
    balance -= withdrawal;
    if (balance <= 0) {
      depletedIn = y.year;
      balance = 0;
      lowest = 0;
      break;
    }
    const grossNominal = blendedReturn(y, plan.equityPct) - fee;
    balance *= 1 + realReturn(grossNominal, y.inflation) / 100;
    if (balance < lowest) lowest = balance;
  }

  return {
    startYear: years[0].year,
    survived: depletedIn === null,
    finalBalance: r2(Math.max(0, balance)),
    depletedIn,
    lowestBalance: r2(Math.max(0, lowest)),
  };
}

/** Every start year with a full window of history after it. */
export function testSequences(plan: SequencePlan): SequenceResult {
  if (plan.years < 1) throw new Error("A plan needs at least one year.");
  if (plan.initialBalance <= 0) throw new Error("A plan needs a starting balance.");

  const starts = startYears(plan.years);
  if (starts.length === 0) {
    throw new Error(`No ${plan.years}-year window fits in the historical record.`);
  }

  const cohorts = starts.map((s) => runCohort(plan, window(s, plan.years)));
  const survivors = cohorts.filter((c) => c.survived).length;
  const byBalance = [...cohorts].sort((a, b) => a.finalBalance - b.finalBalance);

  return {
    cohorts,
    successRate: survivors / cohorts.length,
    // Worst by ending balance, but a cohort that ran out early is worse than
    // one that ran out late even though both end at zero.
    worst: [...cohorts].sort(
      (a, b) => a.finalBalance - b.finalBalance || (a.depletedIn ?? 9999) - (b.depletedIn ?? 9999),
    )[0],
    median: byBalance[Math.floor(byBalance.length / 2)],
    best: byBalance[byBalance.length - 1],
    withdrawalRatePct: r2((plan.annualWithdrawal / plan.initialBalance) * 100),
    cohortCount: cohorts.length,
    firstStart: starts[0],
    lastStart: starts[starts.length - 1],
  };
}

/**
 * The highest withdrawal rate where every historical cohort survived.
 *
 * This is Bengen's method, run against the caller's own horizon and allocation
 * rather than his 30 years and 50/50. Binary search to 0.01% — finer than the
 * data justifies, but the bisection is exact and rounding is the caller's job.
 */
export function maxSafeWithdrawalPct(
  balance: number,
  years: number,
  equityPct: number,
  feePct = 0.1,
): number {
  let lo = 0;
  let hi = 20;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const ok = testSequences({
      initialBalance: balance,
      annualWithdrawal: balance * (mid / 100),
      years, equityPct, feePct,
    }).successRate === 1;
    if (ok) lo = mid; else hi = mid;
  }
  return Math.floor(lo * 100) / 100;
}

/**
 * What the record supports for a given horizon, at a sensible allocation.
 *
 * The reason this exists as its own function: 4% is a *30-year* number, and the
 * app happily offers it to a 45-year-old whose money has to last fifty. The
 * literature that extends Bengen to longer horizons (Kitces, and the "perpetual
 * withdrawal" work) lands near 3.25–3.5% for 50+ years, and this reproduces
 * that from the same data rather than asserting it.
 */
export function safeRateForHorizon(years: number, equityPct = 75): {
  years: number;
  equityPct: number;
  maxSafePct: number;
  /** The cohort that set the limit — the year that makes this the answer. */
  bindingYear: number;
} {
  const balance = 1_000_000; // scale-free; the rate is a ratio
  const maxSafePct = maxSafeWithdrawalPct(balance, years, equityPct);
  // Re-run a hair above the safe rate to find which start year fails first.
  const justOver = testSequences({
    initialBalance: balance,
    annualWithdrawal: balance * ((maxSafePct + 0.05) / 100),
    years, equityPct,
  });
  const failed = justOver.cohorts.filter((c) => !c.survived);
  return {
    years,
    equityPct,
    maxSafePct,
    bindingYear: failed.length > 0 ? failed[0].startYear : justOver.worst.startYear,
  };
}
