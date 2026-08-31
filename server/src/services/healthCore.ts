/**
 * The financial health score, and the sentences that explain it.
 *
 * Pure, and separate from analyticsService, for the reason every `*Core` file
 * in this directory exists: the hosted demo runs in a browser and cannot import
 * Prisma, so anything it needs has to be reachable without a database. When
 * that isn't true, the demo writes its own version — and then the demo and the
 * product quietly disagree about the product's own numbers.
 *
 * That had already happened here. The demo scored `savingsRate * 250 + 25`,
 * clamped to 100, and rendered **100/100 directly above "3 budgets over
 * limit"** — a perfect score sitting on top of its own contradiction, with a
 * formula the installed app has never used. A visitor's first impression of the
 * app's judgement was a number that disagreed with the line beneath it.
 *
 * ---------------------------------------------------------------------------
 * The score
 *
 * Three components, 100 points, and every one of them is explained in the notes
 * rather than left as a mystery — a score nobody can take apart is worse than
 * no score, because it invites trust it hasn't earned.
 *
 *   Savings rate      40   20% saved = full marks
 *   Budget discipline 30   proportional to how many budgets are on track
 *   Discretionary     30   0% of spending = 30, 50% = 0
 *
 * The weights are a judgement, not a fact, and the notes say what each one
 * contributed so a reader can disagree with the judgement and still use the
 * parts.
 */

export interface HealthInputs {
  /** Net savings ÷ income for the period, as a fraction. Negative is allowed. */
  savingsRate: number;
  /** Total spending for the period, used to size the discretionary share. */
  spending: number;
  /** One entry per budget in the period. */
  budgets: { overBudget: boolean }[];
  /** Spending by category name, for the discretionary test. */
  categoryTotals: { name: string; total: number }[];
}

export interface HealthResult {
  score: number;
  notes: string[];
}

/** Categories treated as discretionary — the ones a month can do without. */
export const DISCRETIONARY = [
  "Dining", "Coffee", "Entertainment", "Shopping", "Subscriptions", "Travel",
] as const;

export function financialHealth(input: HealthInputs): HealthResult {
  const notes: string[] = [];

  // 1. Savings rate, capped so that saving 60% doesn't paper over everything
  //    else. This cap is why the old demo formula misled: uncapped, a 66%
  //    savings rate alone ran the total past 100 and hid three blown budgets.
  const savingsPts = Math.max(0, Math.min(40, input.savingsRate * 200));
  notes.push(`Savings rate ${(input.savingsRate * 100).toFixed(0)}% → ${savingsPts.toFixed(0)}/40`);

  // 2. Budget discipline. No budgets set is treated as full marks rather than
  //    zero: someone who hasn't made a budget hasn't failed one.
  const onTrack = input.budgets.length
    ? input.budgets.filter((b) => !b.overBudget).length / input.budgets.length
    : 1;
  const budgetPts = onTrack * 30;
  notes.push(
    input.budgets.length
      ? `${Math.round(onTrack * 100)}% of budgets on track → ${budgetPts.toFixed(0)}/30`
      : "No budgets set → 30/30 (nothing to be over)",
  );

  // 3. Discretionary share of spending.
  const discSpend = input.categoryTotals
    .filter((c) => (DISCRETIONARY as readonly string[]).includes(c.name))
    .reduce((s, c) => s + c.total, 0);
  const discShare = input.spending > 0 ? discSpend / input.spending : 0;
  const discPts = Math.max(0, 30 - discShare * 60);
  notes.push(`Discretionary spending ${(discShare * 100).toFixed(0)}% of total → ${discPts.toFixed(0)}/30`);

  return {
    score: Math.round(Math.max(0, Math.min(100, savingsPts + budgetPts + discPts))),
    notes,
  };
}
