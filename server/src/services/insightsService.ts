/**
 * Smart insights: month-over-month category/merchant movements, subscription
 * audit, savings opportunities. Pure heuristics over local data.
 */
import { categoryBreakdown, merchantBreakdown, monthlySeries, recurringPayments } from "./analyticsService.js";
import type { InsightDTO } from "../../../shared/types.js";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export async function generateInsights(): Promise<InsightDTO[]> {
  const now = new Date();
  const curFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1); // last full month
  const curTo = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const prevFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const prevTo = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59);

  const [curCats, prevCats, curMerch, prevMerch, series, recurring] = await Promise.all([
    categoryBreakdown(curFrom, curTo),
    categoryBreakdown(prevFrom, prevTo),
    merchantBreakdown(curFrom, curTo, 50),
    merchantBreakdown(prevFrom, prevTo, 50),
    monthlySeries(12),
    recurringPayments(),
  ]);

  const insights: InsightDTO[] = [];
  const prevCatMap = new Map(prevCats.map((c) => [c.name, c.total]));

  // Category movements (min $25 and 10% change)
  for (const c of curCats.slice(0, 10)) {
    const prev = prevCatMap.get(c.name);
    if (!prev || prev < 25) continue;
    const pct = ((c.total - prev) / prev) * 100;
    if (Math.abs(pct) < 10 || Math.abs(c.total - prev) < 25) continue;
    insights.push({
      id: `cat-${c.name}`,
      kind: pct > 0 ? "increase" : "decrease",
      title: `${c.name} ${pct > 0 ? "increased" : "decreased"} ${Math.abs(pct).toFixed(0)}%`,
      detail: `${fmt(prev)} → ${fmt(c.total)} month over month.`,
      amount: c.total - prev,
    });
  }

  // Merchant movement (largest absolute change)
  const prevMerchMap = new Map(prevMerch.map((m) => [m.name, m.total]));
  const merchMoves = curMerch
    .map((m) => ({ name: m.name, cur: m.total, prev: prevMerchMap.get(m.name) ?? 0 }))
    .filter((m) => m.prev >= 20 && Math.abs(m.cur - m.prev) >= 30)
    .sort((a, b) => Math.abs(b.cur - a.prev) - Math.abs(a.cur - a.prev));
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

  // Largest merchant overall (last full month)
  if (curMerch[0]) {
    insights.push({
      id: "largest-merchant",
      kind: "info",
      title: `Largest merchant: ${curMerch[0].name}`,
      detail: `${fmt(curMerch[0].total)} across ${curMerch[0].count} transactions last month.`,
    });
  }

  // Highest spending month
  const complete = series.slice(0, -1);
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

  // Average grocery bill
  const groceries = curCats.find((c) => c.name === "Groceries");
  if (groceries && groceries.count > 0) {
    insights.push({
      id: "avg-grocery",
      kind: "info",
      title: `Average grocery trip: ${fmt(groceries.total / groceries.count)}`,
      detail: `${groceries.count} grocery transactions totaling ${fmt(groceries.total)} last month.`,
    });
  }

  // Possibly-unused subscriptions
  const stale = recurring.filter((r) => !r.active);
  for (const s of stale.slice(0, 3)) {
    insights.push({
      id: `stale-${s.merchant}`,
      kind: "warning",
      title: `Possibly unused: ${s.merchant}`,
      detail: `Recurring ~${fmt(s.avgAmount)} payment, but nothing since ${s.lastDate}. Cancelled — or forgotten?`,
    });
  }

  // Savings opportunity: total active recurring spend
  const activeRecurring = recurring.filter((r) => r.active);
  const recTotal = activeRecurring.reduce((s, r) => s + r.monthlyEstimate, 0);
  if (recTotal > 0) {
    insights.push({
      id: "recurring-total",
      kind: "opportunity",
      title: `${fmt(recTotal)}/month in recurring payments`,
      detail: `${activeRecurring.length} active recurring payments ≈ ${fmt(recTotal * 12)}/year. Trimming 20% would save ${fmt(recTotal * 0.2 * 12)}/year.`,
    });
  }

  // Dining opportunity
  const dining = curCats.filter((c) => ["Dining", "Coffee"].includes(c.name));
  const diningTotal = dining.reduce((s, c) => s + c.total, 0);
  if (diningTotal > 150) {
    insights.push({
      id: "dining-opportunity",
      kind: "opportunity",
      title: `Dining + coffee: ${fmt(diningTotal)} last month`,
      detail: `Cutting this by a quarter frees up ${fmt((diningTotal * 0.25) * 12)}/year toward your goals.`,
    });
  }

  return insights;
}
