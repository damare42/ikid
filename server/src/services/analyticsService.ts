/**
 * Spending analytics. Convention throughout:
 *   expense  = amount < 0 and not a transfer
 *   income   = amount > 0 and not a transfer
 * Transfers (savings moves, card autopay) never count as income or spending.
 */
import { prisma } from "../lib/prisma.js";
import { toTransactionDTO } from "../lib/dto.js";
import {
  isExpense, isIncome, isInvestment, isTransferTxn, monthKeyOf, round2,
  type SlimTxn,
} from "./analyticsTypes.js";
import { budgetStatus } from "./budgetService.js";
import type { DashboardSummary, MonthlyPoint } from "../../../shared/types.js";
import { financialHealth } from "./healthCore.js";
import { findRecurring, type RecurringCharge, type RecurringPayment } from "./recurringCore.js";
// Definitions, not arithmetic — and shared, so the demo can't hold a second copy.
import { CSP_BUCKETS, isFixedCost } from "./cspCore.js";

export type { SlimTxn } from "./analyticsTypes.js";

export async function loadSlim(from?: Date, to?: Date): Promise<SlimTxn[]> {
  const rows = await prisma.transaction.findMany({
    where: from || to ? { date: { ...(from && { gte: from }), ...(to && { lte: to }) } } : undefined,
    select: {
      date: true, amount: true, isTransfer: true, categoryId: true,
      category: { select: { name: true, color: true, type: true } },
      merchant: { select: { name: true } },
    },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date,
    amount: r.amount,
    isTransfer: r.isTransfer,
    categoryId: r.categoryId,
    categoryName: r.category?.name ?? "Unknown",
    categoryColor: r.category?.color ?? "#9ca3af",
    categoryType: r.category?.type ?? "expense",
    merchantName: r.merchant?.name ?? "Unknown",
  }));
}

// The conventions live in analyticsTypes.ts — a dependency-free file the
// hosted demo also imports, so browser and server can't disagree about what
// counts as spending. Re-exported here so existing importers are unaffected.
export { isExpense, isIncome, isInvestment, isTransferTxn } from "./analyticsTypes.js";
const monthKey = monthKeyOf;

export async function monthlySeries(months = 12): Promise<MonthlyPoint[]> {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const txns = await loadSlim(from);
  const map = new Map<string, MonthlyPoint>();
  for (let i = 0; i < months; i++) {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
    if (d > now) break;
    map.set(monthKey(d), { month: monthKey(d), income: 0, expenses: 0, savings: 0, investments: 0 });
  }
  for (const t of txns) {
    const p = map.get(monthKey(t.date));
    if (!p) continue;
    if (isIncome(t)) p.income += t.amount;
    if (isExpense(t)) p.expenses += -t.amount;
    if (isInvestment(t)) p.investments = (p.investments ?? 0) + -t.amount;
  }
  for (const p of map.values()) {
    p.income = round2(p.income);
    p.expenses = round2(p.expenses);
    p.investments = round2(p.investments ?? 0);
    p.savings = round2(p.income - p.expenses);
  }
  return [...map.values()];
}

export async function weeklySeries(weeks = 12) {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - weeks * 7);
  const txns = await loadSlim(from);
  const map = new Map<string, { week: string; spending: number }>();
  for (const t of txns) {
    if (!isExpense(t)) continue;
    const d = new Date(t.date);
    d.setDate(d.getDate() - d.getDay()); // week starts Sunday
    const key = d.toISOString().slice(0, 10);
    const p = map.get(key) ?? { week: key, spending: 0 };
    p.spending = round2(p.spending + -t.amount);
    map.set(key, p);
  }
  return [...map.values()].sort((a, b) => a.week.localeCompare(b.week));
}

export async function yearlySeries() {
  const txns = await loadSlim();
  const map = new Map<string, MonthlyPoint>();
  for (const t of txns) {
    const key = String(t.date.getFullYear());
    const p = map.get(key) ?? { month: key, income: 0, expenses: 0, savings: 0, investments: 0 };
    if (isIncome(t)) p.income = round2(p.income + t.amount);
    if (isExpense(t)) p.expenses = round2(p.expenses + -t.amount);
    if (isInvestment(t)) p.investments = round2((p.investments ?? 0) + -t.amount);
    p.savings = round2(p.income - p.expenses);
    map.set(key, p);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export async function categoryBreakdown(from?: Date, to?: Date) {
  const txns = await loadSlim(from, to);
  const map = new Map<string, { id: number | null; name: string; color: string; total: number; count: number }>();
  for (const t of txns) {
    if (!isExpense(t)) continue;
    const p = map.get(t.categoryName) ?? { id: t.categoryId, name: t.categoryName, color: t.categoryColor, total: 0, count: 0 };
    p.total = round2(p.total + -t.amount);
    p.count++;
    map.set(t.categoryName, p);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export async function merchantBreakdown(from?: Date, to?: Date, limit = 20) {
  const txns = await loadSlim(from, to);
  const map = new Map<string, { name: string; total: number; count: number }>();
  for (const t of txns) {
    if (!isExpense(t)) continue;
    const p = map.get(t.merchantName) ?? { name: t.merchantName, total: 0, count: 0 };
    p.total = round2(p.total + -t.amount);
    p.count++;
    map.set(t.merchantName, p);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

/** Top merchants within one category, with each merchant's share of that category's spend. */
export async function categoryMerchants(categoryId: number, from?: Date, to?: Date, limit = 10) {
  const rows = await prisma.transaction.findMany({
    where: {
      categoryId,
      amount: { lt: 0 },
      isTransfer: false,
      ...(from || to ? { date: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {}),
    },
    select: { amount: true, merchantId: true, merchant: { select: { name: true } } },
  });
  const map = new Map<string, { merchantId: number | null; name: string; total: number; count: number }>();
  let categoryTotal = 0;
  for (const r of rows) {
    const name = r.merchant?.name ?? "Unknown";
    const p = map.get(name) ?? { merchantId: r.merchantId, name, total: 0, count: 0 };
    p.total = round2(p.total + -r.amount);
    p.count++;
    map.set(name, p);
    categoryTotal += -r.amount;
  }
  categoryTotal = round2(categoryTotal);
  const merchants = [...map.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((m) => ({
      ...m,
      pct: categoryTotal > 0 ? Math.round((m.total / categoryTotal) * 1000) / 10 : 0,
    }));
  return { categoryTotal, merchants };
}

export async function largestPurchases(from?: Date, to?: Date, limit = 10) {
  const rows = await prisma.transaction.findMany({
    where: {
      amount: { lt: 0 },
      isTransfer: false,
      OR: [{ categoryId: null }, { category: { type: { not: "transfer" } } }],
      ...(from || to ? { date: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {}),
    },
    include: { category: true, merchant: true, account: true, tags: true },
    orderBy: { amount: "asc" },
    take: limit,
  });
  return rows.map(toTransactionDTO);
}

export type { RecurringPayment } from "./recurringCore.js";

/**
 * Detection lives in recurringCore — pure, and shared with the hosted demo.
 * This is only the grouping.
 */
export async function recurringPayments(): Promise<RecurringPayment[]> {
  const txns = await loadSlim();
  const byMerchant = new Map<string, RecurringCharge[]>();
  let newest = 0;
  for (const t of txns) {
    if (!isExpense(t)) continue;
    const list = byMerchant.get(t.merchantName) ?? [];
    list.push({ amount: -t.amount, date: t.date.toISOString().slice(0, 10) });
    byMerchant.set(t.merchantName, list);
    newest = Math.max(newest, t.date.getTime());
  }
  // "Active" is relative to the newest transaction on file, not to today: an
  // export opened months later shouldn't report every subscription as dead.
  return findRecurring(byMerchant, newest ? new Date(newest) : new Date());
}

export async function heatmap(year: number) {
  const txns = await loadSlim(new Date(year, 0, 1), new Date(year, 11, 31, 23, 59, 59));
  const map = new Map<string, number>();
  for (const t of txns) {
    if (!isExpense(t)) continue;
    const key = t.date.toISOString().slice(0, 10);
    map.set(key, round2((map.get(key) ?? 0) + -t.amount));
  }
  return [...map.entries()].map(([date, total]) => ({ date, total }));
}

/**
 * Conscious Spending Plan breakdown (Ramit Sethi's template):
 *   Fixed Costs 50–60% · Investments 10% · Savings 5–10% · Guilt-Free 20–35%
 * Percentages are of take-home income for the period.
 */
export async function cspBreakdown(month?: string, ytd = false) {
  const now = new Date();
  const [y, m] = month ? month.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const from = ytd ? new Date(y, 0, 1) : new Date(y, m - 1, 1);
  const to = ytd ? now : new Date(y, m, 0, 23, 59, 59);
  const txns = await loadSlim(from, to);

  type CatRow = { id: number | null; name: string; color: string; total: number; count: number };
  const detail: Record<string, Map<string, CatRow>> = {
    fixed: new Map(), investments: new Map(), savings: new Map(), guiltFree: new Map(),
  };
  let income = 0;

  const add = (bucket: string, t: SlimTxn, out: number) => {
    const map = detail[bucket];
    const p = map.get(t.categoryName) ?? {
      id: t.categoryId, name: t.categoryName, color: t.categoryColor, total: 0, count: 0,
    };
    p.total = round2(p.total + out);
    p.count++;
    map.set(t.categoryName, p);
  };

  for (const t of txns) {
    if (isIncome(t)) income += t.amount;
    if (t.amount >= 0) continue;
    const out = -t.amount;
    // Investment purchases are a contribution bucket, not spending.
    if (t.categoryName === "Investment") add("investments", t, out);
    else if (isExpense(t)) {
      // Dining, Coffee, Shopping, Entertainment, Travel, Gifts, Unknown… = guilt-free
      add(isFixedCost(t.categoryName) ? "fixed" : "guiltFree", t, out);
    }
    // Note: "Savings" category moves are ignored here — savings is computed
    // as the leftover below, so shuffling money between accounts never
    // changes it.
  }

  const sum = (k: string) => round2([...detail[k].values()].reduce((s, c) => s + c.total, 0));
  const cats = (k: string) => [...detail[k].values()].sort((a, b) => b.total - a.total);
  const pct = (v: number) => (income > 0 ? Math.round((v / income) * 1000) / 10 : 0);

  // Savings = whatever is left of income after all spending and investing.
  const leftover = round2(income - sum("fixed") - sum("investments") - sum("guiltFree"));

  const buckets = CSP_BUCKETS.map((b) => ({
    ...b,
    total: b.key === "savings" ? leftover : sum(b.key),
    pctOfIncome: pct(b.key === "savings" ? leftover : sum(b.key)),
    categories: cats(b.key),
  }));
  const allocated = round2(buckets.reduce((s, b) => s + b.total, 0));

  const pad = (n: number) => String(n).padStart(2, "0");
  const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return {
    month: ytd ? `${y}-YTD` : `${y}-${String(m).padStart(2, "0")}`,
    from: localDate(from),
    to: localDate(to),
    income: round2(income),
    allocated,
    unallocated: round2(income - allocated),
    buckets,
    // Whether the period has actually finished. The targets are shares of a
    // whole month's income, so measuring a month that is three days old
    // against them says nothing — fixed costs land on the 1st and read as
    // 100%, guilt-free spending reads as 0%, and the app draws confident
    // conclusions from an accounting period it has barely started.
    complete: to.getTime() < Date.now(),
  };
}

/** Income and expense breakdown (by category) for a single month. */
export async function monthBreakdown(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 0, 23, 59, 59);
  const txns = await loadSlim(from, to);

  type Row = { id: number | null; name: string; color: string; total: number; count: number };
  const income = new Map<string, Row>();
  const expenses = new Map<string, Row>();
  const investments = new Map<string, Row>();
  for (const t of txns) {
    const target = isIncome(t) ? income : isInvestment(t) ? investments : isExpense(t) ? expenses : null;
    if (!target) continue;
    const p = target.get(t.categoryName) ?? {
      id: t.categoryId, name: t.categoryName, color: t.categoryColor, total: 0, count: 0,
    };
    p.total = round2(p.total + Math.abs(t.amount));
    p.count++;
    target.set(t.categoryName, p);
  }
  const sort = (map: Map<string, Row>) => [...map.values()].sort((a, b) => b.total - a.total);
  const sum = (map: Map<string, Row>) => round2([...map.values()].reduce((s, r) => s + r.total, 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    month: ym,
    from: `${y}-${pad(m)}-01`,
    to: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`,
    income: sort(income),
    expenses: sort(expenses),
    investments: sort(investments),
    totalIncome: sum(income),
    totalExpenses: sum(expenses),
    totalInvestments: sum(investments),
  };
}

export async function savingsAnalysis() {
  const series = await monthlySeries(12);
  const complete = series.slice(0, -1); // exclude current partial month for averages
  const src = complete.length > 0 ? complete : series;
  const savings = src.map((p) => p.savings);
  const avg = savings.length ? savings.reduce((s, v) => s + v, 0) / savings.length : 0;
  const totalIncome = src.reduce((s, p) => s + p.income, 0);
  const totalSavings = src.reduce((s, p) => s + p.savings, 0);
  const avgMonthlyExpenses = src.length
    ? src.reduce((s, p) => s + p.expenses, 0) / src.length
    : 0;
  const best = src.reduce((a, b) => (b.savings > a.savings ? b : a), src[0] ?? { month: "-", savings: 0 });
  const worst = src.reduce((a, b) => (b.savings < a.savings ? b : a), src[0] ?? { month: "-", savings: 0 });
  return {
    series,
    averageMonthlySavings: round2(avg),
    savingsRate: totalIncome > 0 ? round2((totalSavings / totalIncome) * 100) / 100 : 0,
    highestMonth: best,
    lowestMonth: worst,
    estimatedYearlySavings: round2(avg * 12),
    emergencyFundTarget: round2(avgMonthlyExpenses * 6),
    avgMonthlyExpenses: round2(avgMonthlyExpenses),
  };
}

export async function dashboardSummary(month?: string, ytd = false): Promise<DashboardSummary> {
  const now = new Date();
  const [y, m] = month ? month.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  // Year-to-date mode: Jan 1 of the selected (or current) year through today.
  const from = ytd ? new Date(y, 0, 1) : new Date(y, m - 1, 1);
  const to = ytd ? now : new Date(y, m, 0, 23, 59, 59);
  const txns = await loadSlim(from, to);

  let income = 0;
  let spending = 0;
  const catTotals = new Map<string, { id: number | null; name: string; color: string; total: number }>();
  const daily = new Map<string, number>();
  for (const t of txns) {
    if (isIncome(t)) income += t.amount;
    if (isExpense(t)) {
      spending += -t.amount;
      const c = catTotals.get(t.categoryName) ?? { id: t.categoryId, name: t.categoryName, color: t.categoryColor, total: 0 };
      c.total = round2(c.total + -t.amount);
      catTotals.set(t.categoryName, c);
    }
    if (!isTransferTxn(t)) {
      const key = t.date.toISOString().slice(0, 10);
      daily.set(key, round2((daily.get(key) ?? 0) + t.amount));
    }
  }
  const cashFlow: DashboardSummary["cashFlow"] = [];
  let cumulative = 0;
  for (const [date, net] of [...daily.entries()].sort()) {
    cumulative = round2(cumulative + net);
    cashFlow.push({ date, net, cumulative });
  }

  const recent = await prisma.transaction.findMany({
    include: { category: true, merchant: true, account: true, tags: true },
    orderBy: { date: "desc" },
    take: 8,
  });

  // Budgets are monthly by nature — in YTD mode, show the current month's status.
  const budgets = await budgetStatus(
    ytd ? now.getFullYear() : y,
    ytd ? now.getMonth() + 1 : m,
  );
  const netSavings = round2(income - spending);
  const savingsRate = income > 0 ? Math.max(-1, netSavings / income) : 0;

  // Financial health score (0-100). The arithmetic lives in healthCore so the
  // demo runs this one rather than a formula of its own.
  const health = financialHealth({
    savingsRate,
    spending,
    budgets,
    categoryTotals: [...catTotals.values()],
  });

  // Build local-date strings (avoid toISOString timezone shifts).
  const pad = (n: number) => String(n).padStart(2, "0");
  const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  return {
    month: ytd ? `${y}-YTD` : `${y}-${String(m).padStart(2, "0")}`,
    from: localDate(from),
    to: localDate(to),
    income: round2(income),
    spending: round2(spending),
    netSavings,
    savingsRate: round2(savingsRate * 100) / 100,
    cashFlow,
    largestCategories: [...catTotals.values()].sort((a, b) => b.total - a.total).slice(0, 6),
    recentTransactions: recent.map(toTransactionDTO),
    budgets,
    healthScore: health.score,
    healthNotes: health.notes,
  };
}
