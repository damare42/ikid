/**
 * The insight heuristics.
 *
 * Pure, and separate from insightsService, for the reason every `*Core` file in
 * this directory exists: the hosted demo runs in a browser and cannot import
 * Prisma. `generateInsights` was already pure below its four `await`s — it
 * fetched six collections and then did nothing but arithmetic over them — so
 * the demo had written a short version of its own.
 *
 * The two had drifted, and in the direction that flatters nobody: the demo
 * required a movement of $40 **and** 25% before it would mention a category,
 * where the product asks for $25 and 10%. It also had none of the merchant,
 * subscription, recurring-total or dining insights at all. A visitor deciding
 * whether this app notices anything useful about their spending was shown a
 * deliberately quieter version of the product, which is the opposite of what a
 * demo is for.
 *
 * The thresholds are judgements, and they live here once so that changing one
 * changes it everywhere.
 */
import type { InsightDTO } from "../../../shared/types.js";

/** Everything the heuristics read. Both callers assemble this their own way. */
export interface InsightInputs {
  /** Category totals for the last complete month, biggest first. */
  currentCategories: { name: string; total: number; count: number }[];
  /** The month before that. */
  previousCategories: { name: string; total: number }[];
  currentMerchants: { name: string; total: number; count: number }[];
  previousMerchants: { name: string; total: number }[];
  /** Monthly income/expense series, oldest first; the last entry is partial. */
  series: { month: string; expenses: number }[];
  recurring: { merchant: string; avgAmount: number; lastDate: string; active: boolean; monthlyEstimate: number }[];
}

/**
 * A movement is worth mentioning only if it is both large enough to notice and
 * large enough to be real. A 60% jump on a $12 category is noise; a $30 rise on
 * a $2,000 one is rounding.
 */
export const THRESHOLDS = {
  /** Ignore categories that were smaller than this last month. */
  minPreviousCategory: 25,
  /** Both must be cleared for a category movement to be reported. */
  minCategoryDelta: 25,
  minCategoryPct: 10,
  /** Merchant movements are noisier, so they ask for more. */
  minPreviousMerchant: 20,
  minMerchantDelta: 30,
  /** Below this, "you could eat out less" is not advice. */
  minDiningTotal: 150,
} as const;

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function buildInsights(input: InsightInputs): InsightDTO[] {
  const insights: InsightDTO[] = [];
  const prevCatMap = new Map(input.previousCategories.map((c) => [c.name, c.total]));

  // Category movements
  for (const c of input.currentCategories.slice(0, 10)) {
    const prev = prevCatMap.get(c.name);
    if (!prev || prev < THRESHOLDS.minPreviousCategory) continue;
    const pct = ((c.total - prev) / prev) * 100;
    if (Math.abs(pct) < THRESHOLDS.minCategoryPct) continue;
    if (Math.abs(c.total - prev) < THRESHOLDS.minCategoryDelta) continue;
    insights.push({
      id: `cat-${c.name}`,
      kind: pct > 0 ? "increase" : "decrease",
      title: `${c.name} ${pct > 0 ? "increased" : "decreased"} ${Math.abs(pct).toFixed(0)}%`,
      detail: `${fmt(prev)} → ${fmt(c.total)} month over month.`,
      amount: c.total - prev,
    });
  }

  // The single largest merchant movement
  const prevMerchMap = new Map(input.previousMerchants.map((m) => [m.name, m.total]));
  const merchMoves = input.currentMerchants
    .map((m) => ({ name: m.name, cur: m.total, prev: prevMerchMap.get(m.name) ?? 0 }))
    .filter((m) => m.prev >= THRESHOLDS.minPreviousMerchant
      && Math.abs(m.cur - m.prev) >= THRESHOLDS.minMerchantDelta)
    .sort((a, b) => Math.abs(b.cur - b.prev) - Math.abs(a.cur - a.prev));
  if (merchMoves[0]) {
    const mv = merchMoves[0];
    const pct = ((mv.cur - mv.prev) / mv.prev) * 100;
    insights.push({
      id: `merch-${mv.name}`,
      kind: pct > 0 ? "increase" : "decrease",
      title: `${mv.name} purchases ${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(0)}%`,
      detail: `${fmt(mv.prev)} → ${fmt(mv.cur)} month over month.`,
    });
  }

  if (input.currentMerchants[0]) {
    insights.push({
      id: "largest-merchant",
      kind: "info",
      title: `Largest merchant: ${input.currentMerchants[0].name}`,
      detail: `${fmt(input.currentMerchants[0].total)} across ${input.currentMerchants[0].count} transactions last month.`,
    });
  }

  // The running month is partial, so it can't be the "highest" one.
  const complete = input.series.slice(0, -1);
  if (complete.length > 1) {
    const highest = complete.reduce((a, b) => (b.expenses > a.expenses ? b : a));
    insights.push({
      id: "highest-month",
      kind: "info",
      title: `Highest spending month: ${highest.month}`,
      detail: `${fmt(highest.expenses)} in total expenses.`,
    });
    const avgSpend = complete.reduce((s, p) => s + p.expenses, 0) / complete.length;
    insights.push({
      id: "yearly-estimate",
      kind: "info",
      title: `Estimated yearly spending: ${fmt(avgSpend * 12)}`,
      detail: `Based on your ${fmt(avgSpend)} average over the last ${complete.length} months.`,
    });
  }

  const groceries = input.currentCategories.find((c) => c.name === "Groceries");
  if (groceries && groceries.count > 0) {
    insights.push({
      id: "avg-grocery",
      kind: "info",
      title: `Average grocery trip: ${fmt(groceries.total / groceries.count)}`,
      detail: `${groceries.count} grocery transactions totaling ${fmt(groceries.total)} last month.`,
    });
  }

  // A subscription still charging after the usage stopped.
  for (const s of input.recurring.filter((r) => !r.active).slice(0, 3)) {
    insights.push({
      id: `stale-${s.merchant}`,
      kind: "warning",
      title: `Possibly unused: ${s.merchant}`,
      detail: `Recurring ~${fmt(s.avgAmount)} payment, but nothing since ${s.lastDate}. Cancelled — or forgotten?`,
    });
  }

  const activeRecurring = input.recurring.filter((r) => r.active);
  const recTotal = activeRecurring.reduce((s, r) => s + r.monthlyEstimate, 0);
  if (recTotal > 0) {
    insights.push({
      id: "recurring-total",
      kind: "opportunity",
      title: `${fmt(recTotal)}/month in recurring payments`,
      detail: `${activeRecurring.length} active recurring payments ≈ ${fmt(recTotal * 12)}/year. Trimming 20% would save ${fmt(recTotal * 0.2 * 12)}/year.`,
    });
  }

  const diningTotal = input.currentCategories
    .filter((c) => ["Dining", "Coffee"].includes(c.name))
    .reduce((s, c) => s + c.total, 0);
  if (diningTotal > THRESHOLDS.minDiningTotal) {
    insights.push({
      id: "dining-opportunity",
      kind: "opportunity",
      title: `Dining + coffee: ${fmt(diningTotal)} last month`,
      detail: `Cutting this by a quarter frees up ${fmt(diningTotal * 0.25 * 12)}/year toward your goals.`,
    });
  }

  return insights;
}
