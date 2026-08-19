/**
 * Multi-debt payoff strategies — snowball vs avalanche.
 *
 * The question this answers: "I have several cards and loans and some spare
 * money each month. Which do I attack first, when am I free, and what does the
 * choice cost me?"
 *
 * Both strategies pay every debt's minimum, then throw all remaining money at
 * ONE target debt. When that debt clears, its whole payment rolls into the next
 * target — the "snowball" effect that makes the last debts fall fast.
 *
 *   - avalanche: target the highest interest rate first  → mathematically optimal
 *   - snowball:  target the smallest balance first       → fastest first win
 *
 * Pure and deterministic (PRINCIPLES rule 2): same inputs, same answer, and
 * every figure here is reproducible from the schedule it returns. Money maths
 * goes through services/money.ts so totals don't drift.
 */
import { addMoney, mulMoney, round2, subMoney, sumBy, toCents } from "./money.js";

export type Strategy = "avalanche" | "snowball";

export interface Debt {
  /** Display name, e.g. "Capital One". */
  name: string;
  /** Amount owed, positive. */
  balance: number;
  /** Annual interest rate, percent (0 for an interest-free debt). */
  ratePct: number;
  /** Required monthly payment. */
  minPayment: number;
}

export interface DebtResult {
  name: string;
  /** 1-based order this debt was cleared in. */
  order: number;
  monthsToPayoff: number;
  payoffDate: string; // YYYY-MM
  interestPaid: number;
  totalPaid: number;
}

export interface PayoffMonth {
  month: number; // 1-based
  /** Total still owed across all debts at the end of this month. */
  remaining: number;
  interest: number;
  principal: number;
}

export interface PayoffPlan {
  strategy: Strategy;
  feasible: boolean;
  /** Set when the plan can't work — e.g. payments don't cover interest. */
  problem?: string;
  months: number;
  payoffDate: string;
  totalInterest: number;
  totalPaid: number;
  /**
   * The order to ATTACK debts — where spare money goes, highest priority first.
   * This is the actionable list. It differs from the order debts actually
   * clear, because a small debt can finish on its own minimum payment while a
   * bigger one is being targeted.
   */
  focusOrder: string[];
  /** Order debts are cleared chronologically, with each one's cost. */
  debts: DebtResult[];
  /** Balance curve, for charting. */
  schedule: PayoffMonth[];
  /** Monthly payment this plan assumes (all minimums + extra). */
  monthlyOutlay: number;
}

export interface Comparison {
  avalanche: PayoffPlan;
  snowball: PayoffPlan;
  /** Which strategy costs less interest (ties → avalanche). */
  cheaper: Strategy;
  /** Interest saved by choosing the cheaper one. */
  interestSaved: number;
  /** Months saved by the faster plan (0 when equal). */
  monthsSaved: number;
  /** Plain-language guidance, honest about the trade-off. */
  advice: string[];
}

const HARD_CAP_MONTHS = 100 * 12;

function ymFrom(offsetMonths: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() + offsetMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Order debts by the strategy's rule; ties broken deterministically by name. */
export function prioritise(debts: readonly Debt[], strategy: Strategy): Debt[] {
  return [...debts].sort((a, b) => {
    const primary =
      strategy === "avalanche" ? b.ratePct - a.ratePct : a.balance - b.balance;
    if (Math.abs(primary) > 1e-9) return primary;
    // Stable, explainable tie-break so the plan never depends on input order.
    return a.name.localeCompare(b.name);
  });
}

/**
 * Simulate one strategy to payoff.
 *
 * Model: interest accrues monthly on each balance, minimums are paid on every
 * debt, and all remaining money goes to the current target. A debt's minimum
 * is never wasted — once it clears, that money joins the pot.
 */
export function simulatePayoff(
  debts: readonly Debt[],
  extraMonthly: number,
  strategy: Strategy,
): PayoffPlan {
  const active = debts
    .filter((d) => toCents(d.balance) > 0)
    .map((d) => ({ ...d, balance: round2(d.balance), interestPaid: 0, paid: 0 }));

  const totalMinimums = sumBy(active, (d) => d.minPayment);
  const monthlyOutlay = addMoney(totalMinimums, Math.max(0, extraMonthly));

  const empty: PayoffPlan = {
    strategy,
    feasible: true,
    months: 0,
    payoffDate: ymFrom(0),
    totalInterest: 0,
    totalPaid: 0,
    focusOrder: [],
    debts: [],
    schedule: [],
    monthlyOutlay,
  };
  if (active.length === 0) return empty;

  // Feasibility: the first month's total interest must be less than what we
  // pay, or the balance can only grow.
  const firstMonthInterest = sumBy(active, (d) => mulMoney(d.balance, d.ratePct / 100 / 12));
  if (toCents(monthlyOutlay) <= toCents(firstMonthInterest)) {
    return {
      ...empty,
      feasible: false,
      problem:
        `Payments of ${fmt(monthlyOutlay)}/mo don't cover ${fmt(firstMonthInterest)}/mo of interest — ` +
        `the balance would grow forever. Increase the monthly amount by at least ` +
        `${fmt(Math.max(1, subMoney(firstMonthInterest, monthlyOutlay) + 1))}.`,
    };
  }

  const order = prioritise(active, strategy).map((d) => d.name);
  const results: DebtResult[] = [];
  const schedule: PayoffMonth[] = [];
  let month = 0;
  let cleared = 0;

  while (active.some((d) => toCents(d.balance) > 0) && month < HARD_CAP_MONTHS) {
    month++;
    let monthInterest = 0;
    let monthPrincipal = 0;

    // 1. Interest accrues on every outstanding balance.
    for (const d of active) {
      if (toCents(d.balance) <= 0) continue;
      const interest = mulMoney(d.balance, d.ratePct / 100 / 12);
      d.balance = addMoney(d.balance, interest);
      d.interestPaid = addMoney(d.interestPaid, interest);
      monthInterest = addMoney(monthInterest, interest);
    }

    // 2. Everything available this month, including freed-up minimums.
    let pot = monthlyOutlay;

    // 3. Pay minimums on every debt except the target (the target gets the
    //    remainder, which already includes its minimum).
    const target = order.map((n) => active.find((d) => d.name === n)!)
      .find((d) => toCents(d.balance) > 0);

    for (const d of active) {
      if (toCents(d.balance) <= 0 || d === target) continue;
      const pay = Math.min(d.minPayment, d.balance, pot);
      if (toCents(pay) <= 0) continue;
      d.balance = subMoney(d.balance, pay);
      d.paid = addMoney(d.paid, pay);
      pot = subMoney(pot, pay);
      monthPrincipal = addMoney(monthPrincipal, pay);
      // A debt can clear on its minimum alone — it still counts as paid off.
      if (toCents(d.balance) <= 0 && !results.some((r) => r.name === d.name)) {
        results.push({
          name: d.name,
          order: ++cleared,
          monthsToPayoff: month,
          payoffDate: ymFrom(month),
          interestPaid: round2(d.interestPaid),
          totalPaid: round2(d.paid),
        });
      }
    }

    // 4. Everything left attacks the target; overflow rolls to the next debt.
    let guard = active.length + 1;
    while (toCents(pot) > 0 && guard-- > 0) {
      const t = order.map((n) => active.find((d) => d.name === n)!)
        .find((d) => toCents(d.balance) > 0);
      if (!t) break;
      const pay = Math.min(t.balance, pot);
      t.balance = subMoney(t.balance, pay);
      t.paid = addMoney(t.paid, pay);
      pot = subMoney(pot, pay);
      monthPrincipal = addMoney(monthPrincipal, pay);

      if (toCents(t.balance) <= 0 && !results.some((r) => r.name === t.name)) {
        results.push({
          name: t.name,
          order: ++cleared,
          monthsToPayoff: month,
          payoffDate: ymFrom(month),
          interestPaid: round2(t.interestPaid),
          totalPaid: round2(t.paid),
        });
      }
    }

    schedule.push({
      month,
      remaining: round2(Math.max(0, sumBy(active, (d) => Math.max(0, d.balance)))),
      interest: round2(monthInterest),
      principal: round2(monthPrincipal),
    });
  }

  const totalInterest = round2(sumBy(active, (d) => d.interestPaid));
  return {
    strategy,
    feasible: true,
    months: month,
    payoffDate: ymFrom(month),
    totalInterest,
    totalPaid: round2(sumBy(active, (d) => d.paid)),
    focusOrder: order,
    debts: results,
    schedule,
    monthlyOutlay,
  };
}

/** Run both strategies and explain the trade-off. */
export function comparePayoff(debts: readonly Debt[], extraMonthly: number): Comparison {
  const avalanche = simulatePayoff(debts, extraMonthly, "avalanche");
  const snowball = simulatePayoff(debts, extraMonthly, "snowball");

  const cheaper: Strategy =
    toCents(snowball.totalInterest) < toCents(avalanche.totalInterest) ? "snowball" : "avalanche";
  const interestSaved = round2(
    Math.abs(subMoney(avalanche.totalInterest, snowball.totalInterest)),
  );
  const monthsSaved = Math.abs(avalanche.months - snowball.months);

  const advice: string[] = [];
  if (!avalanche.feasible) {
    advice.push(avalanche.problem!);
    return { avalanche, snowball, cheaper, interestSaved, monthsSaved, advice };
  }

  if (toCents(interestSaved) === 0 && monthsSaved === 0) {
    advice.push(
      "Both strategies finish at the same time and cost the same here — with this mix of " +
      "balances and rates the order doesn't matter. Pick whichever you'll stick to.",
    );
  } else {
    advice.push(
      `Avalanche (highest rate first) costs ${fmt(avalanche.totalInterest)} in interest and finishes ` +
      `${avalanche.payoffDate}. Snowball (smallest balance first) costs ${fmt(snowball.totalInterest)} ` +
      `and finishes ${snowball.payoffDate}.`,
    );
    if (cheaper === "avalanche" && toCents(interestSaved) > 0) {
      advice.push(
        `Avalanche saves ${fmt(interestSaved)}${monthsSaved ? ` and ${monthsSaved} month${monthsSaved === 1 ? "" : "s"}` : ""}. ` +
        `Snowball's advantage is motivational: you clear "${snowball.debts[0]?.name ?? "the first debt"}" ` +
        `by ${snowball.debts[0]?.payoffDate ?? "sooner"}, which some people need to keep going. ` +
        `If the gap is small, the plan you'll actually finish is the better plan.`,
      );
    }
  }

  // Name the debt to ATTACK under the recommended strategy — not the first one
  // that happens to clear, which can be a small debt finishing on its own
  // minimum while a bigger one is being targeted.
  const plan = cheaper === "avalanche" ? avalanche : snowball;
  const target = plan.focusOrder[0];
  if (target) {
    const other = cheaper === "avalanche" ? snowball : avalanche;
    const sameTarget = other.focusOrder[0] === target;
    advice.push(
      sameTarget
        ? `Either way, put every spare dollar on "${target}" first and keep paying the minimums on the rest.`
        : `Going with ${cheaper}: put every spare dollar on "${target}" first (${
            cheaper === "avalanche" ? "the highest rate" : "the smallest balance"
          }) and keep paying the minimums on the rest. The other strategy would start with "${other.focusOrder[0]}".`,
    );
  }
  if (extraMonthly <= 0) {
    advice.push(
      "This assumes minimum payments only. Even a small extra amount each month compounds — " +
      "try adding $50 and watch the payoff date move.",
    );
  }
  return { avalanche, snowball, cheaper, interestSaved, monthsSaved, advice };
}
