/**
 * Analytics computed in the browser.
 *
 * The aggregation shapes mirror `server/src/services/analyticsService.ts`. The
 * *definitions* — what counts as income, spending, a transfer, an investment —
 * are imported from `analyticsTypes.ts` rather than restated, because those are
 * the ones that would make the demo quietly lie if they drifted.
 */
import type { DashboardSummary, MonthlyPoint, TransactionDTO } from "@shared/types";
import {
  isExpense, isIncome, isInvestment, monthKeyOf, round2, type SlimTxn,
} from "@engine/analyticsTypes.js";
import { financialHealth } from "@engine/healthCore.js";
import { num, route, str } from "./router.js";
import { allTxns, asDate, categoryDTO, latestDate, merchantDTO, txnDTO, ymd } from "./data.js";
import { handle } from "./router.js";

/** The store's rows, flattened into what every aggregation below consumes. */
function slim(from?: Date, to?: Date): SlimTxn[] {
  return allTxns()
    .filter((t) => {
      const d = asDate(t.date).getTime();
      if (from && d < from.getTime()) return false;
      if (to && d > to.getTime()) return false;
      return true;
    })
    .map((t) => {
      const c = categoryDTO(t.categoryId);
      return {
        date: asDate(t.date),
        amount: t.amount as number,
        isTransfer: Boolean(t.isTransfer),
        categoryId: (t.categoryId as number | null) ?? null,
        categoryName: c?.name ?? "Unknown",
        categoryColor: c?.color ?? "#9ca3af",
        categoryType: c?.type ?? "expense",
        merchantName: merchantDTO(t.merchantId)?.name ?? "Unknown",
      };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

const dateParam = (v?: string): Date | undefined => (v ? new Date(v) : undefined);

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export function monthlySeries(months = 12): MonthlyPoint[] {
  const now = latestDate();
  const from = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const txns = slim(from);
  const map = new Map<string, MonthlyPoint>();
  for (let i = 0; i < months; i++) {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
    if (d > now) break;
    map.set(monthKeyOf(d), { month: monthKeyOf(d), income: 0, expenses: 0, savings: 0, investments: 0 });
  }
  for (const t of txns) {
    const p = map.get(monthKeyOf(t.date));
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

route("GET /api/analytics/monthly", ({ query }) => monthlySeries(num(query, "months") ?? 12));

route("GET /api/analytics/weekly", ({ query }) => {
  const weeks = num(query, "weeks") ?? 12;
  const now = latestDate();
  const from = new Date(now);
  from.setDate(from.getDate() - weeks * 7);
  const map = new Map<string, { week: string; spending: number }>();
  for (const t of slim(from)) {
    if (!isExpense(t)) continue;
    const d = new Date(t.date);
    d.setDate(d.getDate() - d.getDay()); // week starts Sunday
    const key = d.toISOString().slice(0, 10);
    const p = map.get(key) ?? { week: key, spending: 0 };
    p.spending = round2(p.spending + -t.amount);
    map.set(key, p);
  }
  return [...map.values()].sort((a, b) => a.week.localeCompare(b.week));
});

route("GET /api/analytics/yearly", () => {
  const map = new Map<string, MonthlyPoint>();
  for (const t of slim()) {
    const key = String(t.date.getFullYear());
    const p = map.get(key) ?? { month: key, income: 0, expenses: 0, savings: 0, investments: 0 };
    if (isIncome(t)) p.income = round2(p.income + t.amount);
    if (isExpense(t)) p.expenses = round2(p.expenses + -t.amount);
    if (isInvestment(t)) p.investments = round2((p.investments ?? 0) + -t.amount);
    p.savings = round2(p.income - p.expenses);
    map.set(key, p);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
});

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

interface CatRow { id: number | null; name: string; color: string; total: number; count: number }

export function categoryBreakdown(from?: Date, to?: Date): CatRow[] {
  const map = new Map<string, CatRow>();
  for (const t of slim(from, to)) {
    if (!isExpense(t)) continue;
    const p = map.get(t.categoryName) ?? {
      id: t.categoryId, name: t.categoryName, color: t.categoryColor, total: 0, count: 0,
    };
    p.total = round2(p.total + -t.amount);
    p.count++;
    map.set(t.categoryName, p);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

route("GET /api/analytics/categories", ({ query }) =>
  categoryBreakdown(dateParam(str(query, "from")), dateParam(str(query, "to"))));

route("GET /api/analytics/merchants", ({ query }) => {
  const limit = num(query, "limit") ?? 20;
  const map = new Map<string, { name: string; total: number; count: number }>();
  for (const t of slim(dateParam(str(query, "from")), dateParam(str(query, "to")))) {
    if (!isExpense(t)) continue;
    const p = map.get(t.merchantName) ?? { name: t.merchantName, total: 0, count: 0 };
    p.total = round2(p.total + -t.amount);
    p.count++;
    map.set(t.merchantName, p);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
});

route("GET /api/analytics/category-merchants", ({ query }) => {
  const categoryId = num(query, "categoryId");
  const limit = num(query, "limit") ?? 10;
  const from = dateParam(str(query, "from"));
  const to = dateParam(str(query, "to"));
  const map = new Map<string, { merchantId: number | null; name: string; total: number; count: number }>();
  let categoryTotal = 0;
  for (const t of allTxns()) {
    if (t.categoryId !== categoryId) continue;
    if ((t.amount as number) >= 0 || t.isTransfer) continue;
    const d = asDate(t.date).getTime();
    if (from && d < from.getTime()) continue;
    if (to && d > to.getTime()) continue;
    const name = merchantDTO(t.merchantId)?.name ?? "Unknown";
    const p = map.get(name) ?? { merchantId: (t.merchantId as number) ?? null, name, total: 0, count: 0 };
    p.total = round2(p.total + -(t.amount as number));
    p.count++;
    map.set(name, p);
    categoryTotal += -(t.amount as number);
  }
  categoryTotal = round2(categoryTotal);
  const merchants = [...map.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((m) => ({ ...m, pct: categoryTotal > 0 ? Math.round((m.total / categoryTotal) * 1000) / 10 : 0 }));
  return { categoryTotal, merchants };
});

route("GET /api/analytics/largest", ({ query }) => {
  const limit = num(query, "limit") ?? 10;
  const from = dateParam(str(query, "from"));
  const to = dateParam(str(query, "to"));
  return allTxns()
    .filter((t) => {
      if ((t.amount as number) >= 0 || t.isTransfer) return false;
      if (categoryDTO(t.categoryId)?.type === "transfer") return false;
      const d = asDate(t.date).getTime();
      if (from && d < from.getTime()) return false;
      if (to && d > to.getTime()) return false;
      return true;
    })
    .sort((a, b) => (a.amount as number) - (b.amount as number))
    .slice(0, limit)
    .map(txnDTO);
});

route("GET /api/analytics/heatmap", ({ query }) => {
  const year = num(query, "year") ?? latestDate().getFullYear();
  const map = new Map<string, number>();
  for (const t of slim(new Date(year, 0, 1), new Date(year, 11, 31, 23, 59, 59))) {
    if (!isExpense(t)) continue;
    const key = t.date.toISOString().slice(0, 10);
    map.set(key, round2((map.get(key) ?? 0) + -t.amount));
  }
  return [...map.entries()].map(([date, total]) => ({ date, total }));
});

route("GET /api/analytics/recurring", () => {
  const byMerchant = new Map<string, SlimTxn[]>();
  for (const t of slim()) {
    if (!isExpense(t)) continue;
    const list = byMerchant.get(t.merchantName) ?? [];
    list.push(t);
    byMerchant.set(t.merchantName, list);
  }
  const out: { merchant: string; avgAmount: number; count: number; lastDate: string; active: boolean; monthlyEstimate: number }[] = [];
  const now = latestDate().getTime();
  for (const [merchant, list] of byMerchant) {
    if (list.length < 3) continue;
    const amounts = list.map((t) => -t.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (amounts.filter((a) => Math.abs(a - median) / median <= 0.15).length < 3) continue;
    const months = new Set(list.map((t) => monthKeyOf(t.date)));
    if (months.size < 3) continue;
    const perMonth = list.length / months.size;
    if (perMonth > 2.5) continue;
    const last = list[list.length - 1].date;
    out.push({
      merchant,
      avgAmount: round2(amounts.reduce((s, a) => s + a, 0) / amounts.length),
      count: list.length,
      lastDate: last.toISOString().slice(0, 10),
      active: now - last.getTime() < 45 * 24 * 3600 * 1000,
      monthlyEstimate: round2(median * Math.min(perMonth, 1.5)),
    });
  }
  return out.sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);
});

// ---------------------------------------------------------------------------
// Conscious Spending Plan + month breakdown
// ---------------------------------------------------------------------------

const CSP_FIXED = new Set(
  ["Housing", "Rent", "Mortgage", "Utilities", "Electricity", "Water", "Gas", "Internet",
    "Phone", "Insurance", "Health", "Medical", "Pharmacy", "Transportation", "Car Payment",
    "Groceries", "Subscriptions", "Debt", "Loan", "Loans", "Student Loans", "Childcare",
    "Tuition", "Taxes", "Fees & Charges"].map((n) => n.toLowerCase()),
);

route("GET /api/analytics/csp", ({ query }) => {
  const ytd = str(query, "range") === "ytd";
  const now = latestDate();
  const month = str(query, "month");
  const [y, m] = month ? month.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const from = ytd ? new Date(y, 0, 1) : new Date(y, m - 1, 1);
  const to = ytd ? now : new Date(y, m, 0, 23, 59, 59);

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
  for (const t of slim(from, to)) {
    if (isIncome(t)) income += t.amount;
    if (t.amount >= 0) continue;
    const out = -t.amount;
    if (t.categoryName === "Investment") add("investments", t, out);
    else if (isExpense(t)) add(CSP_FIXED.has(t.categoryName.toLowerCase()) ? "fixed" : "guiltFree", t, out);
  }

  const sum = (k: string) => round2([...detail[k].values()].reduce((s, c) => s + c.total, 0));
  const cats = (k: string) => [...detail[k].values()].sort((a, b) => b.total - a.total);
  const pct = (v: number) => (income > 0 ? Math.round((v / income) * 1000) / 10 : 0);
  const leftover = round2(income - sum("fixed") - sum("investments") - sum("guiltFree"));

  const meta = [
    { key: "fixed", label: "Fixed Costs", targetLow: 50, targetHigh: 60, color: "#64748b" },
    { key: "investments", label: "Investments", targetLow: 10, targetHigh: 10, color: "#6366f1" },
    { key: "savings", label: "Savings", targetLow: 5, targetHigh: 10, color: "#0d9488" },
    { key: "guiltFree", label: "Guilt-Free Spending", targetLow: 20, targetHigh: 35, color: "#f59e0b" },
  ];
  const buckets = meta.map((b) => ({
    ...b,
    total: b.key === "savings" ? leftover : sum(b.key),
    pctOfIncome: pct(b.key === "savings" ? leftover : sum(b.key)),
    categories: cats(b.key),
  }));
  const allocated = round2(buckets.reduce((s, b) => s + b.total, 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return {
    month: ytd ? `${y}-YTD` : `${y}-${pad(m)}`,
    from: localDate(from),
    to: localDate(to),
    income: round2(income),
    allocated,
    unallocated: round2(income - allocated),
    buckets,
  };
});

route("GET /api/analytics/month-breakdown", ({ query }) => {
  const now = latestDate();
  const ym = str(query, "month") ?? monthKeyOf(now);
  const [y, m] = ym.split("-").map(Number);
  const income = new Map<string, CatRow>();
  const expenses = new Map<string, CatRow>();
  const investments = new Map<string, CatRow>();
  for (const t of slim(new Date(y, m - 1, 1), new Date(y, m, 0, 23, 59, 59))) {
    const target = isIncome(t) ? income : isInvestment(t) ? investments : isExpense(t) ? expenses : null;
    if (!target) continue;
    const p = target.get(t.categoryName) ?? {
      id: t.categoryId, name: t.categoryName, color: t.categoryColor, total: 0, count: 0,
    };
    p.total = round2(p.total + Math.abs(t.amount));
    p.count++;
    target.set(t.categoryName, p);
  }
  const sort = (map: Map<string, CatRow>) => [...map.values()].sort((a, b) => b.total - a.total);
  const sum = (map: Map<string, CatRow>) => round2([...map.values()].reduce((s, r) => s + r.total, 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    month: ym,
    from: `${y}-${pad(m)}-01`,
    to: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`,
    income: sort(income), expenses: sort(expenses), investments: sort(investments),
    totalIncome: sum(income), totalExpenses: sum(expenses), totalInvestments: sum(investments),
  };
});

route("GET /api/analytics/savings", () => {
  const series = monthlySeries(12);
  const complete = series.slice(0, -1);
  const src = complete.length > 0 ? complete : series;
  const savings = src.map((p) => p.savings);
  const avg = savings.length ? savings.reduce((s, v) => s + v, 0) / savings.length : 0;
  const totalIncome = src.reduce((s, p) => s + p.income, 0);
  const totalSavings = src.reduce((s, p) => s + p.savings, 0);
  const avgMonthlyExpenses = src.length ? src.reduce((s, p) => s + p.expenses, 0) / src.length : 0;
  const best = src.reduce((a, b) => (b.savings > a.savings ? b : a), src[0]);
  const worst = src.reduce((a, b) => (b.savings < a.savings ? b : a), src[0]);
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
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

route("GET /api/analytics/summary", async ({ query }) => {
  const now = latestDate();
  const ytd = str(query, "range") === "ytd";
  const month = str(query, "month") ?? monthKeyOf(now);
  const [y, m] = month.split("-").map(Number);
  const from = ytd ? new Date(y, 0, 1) : new Date(y, m - 1, 1);
  const to = ytd ? now : new Date(y, m, 0, 23, 59, 59);
  const txns = slim(from, to);

  let income = 0;
  let spending = 0;
  for (const t of txns) {
    if (isIncome(t)) income += t.amount;
    if (isExpense(t)) spending += -t.amount;
  }
  income = round2(income);
  spending = round2(spending);
  const netSavings = round2(income - spending);

  // Daily net, then a running total — the cash-flow curve on the dashboard.
  const byDay = new Map<string, number>();
  for (const t of txns) {
    if (!isIncome(t) && !isExpense(t)) continue;
    const key = t.date.toISOString().slice(0, 10);
    byDay.set(key, round2((byDay.get(key) ?? 0) + t.amount));
  }
  let cumulative = 0;
  const cashFlow = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, net]) => {
      cumulative = round2(cumulative + net);
      return { date, net, cumulative };
    });

  const recent = allTxns()
    .slice()
    .sort((a, b) => asDate(b.date).getTime() - asDate(a.date).getTime() || b.id - a.id)
    .slice(0, 8)
    .map(txnDTO) as TransactionDTO[];

  const budgets = (await handle("GET", `/api/budgets?year=${y}&month=${m}`, undefined)) as DashboardSummary["budgets"];

  // The product's score, not a second one. This file used to compute
  // `rate * 250 + 25` clamped to 100, which put "100/100" directly above
  // "3 budgets over limit" on the demo's own dashboard — a perfect score
  // contradicting the line beneath it, using a formula the installed app has
  // never used. The demo exists to show what the app does; a scoring rule of
  // its own is the one thing it must not have.
  const health = financialHealth({
    savingsRate: income > 0 ? netSavings / income : 0,
    spending,
    budgets,
    categoryTotals: categoryBreakdown(from, to),
  });

  const pad = (n: number) => String(n).padStart(2, "0");
  const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const summary: DashboardSummary = {
    month: ytd ? `${y}-YTD` : month,
    income, spending, netSavings,
    savingsRate: income > 0 ? round2(netSavings / income) : 0,
    cashFlow,
    largestCategories: categoryBreakdown(from, to).slice(0, 6)
      .map((c) => ({ id: c.id, name: c.name, color: c.color, total: c.total })),
    from: localDate(from),
    to: localDate(to),
    recentTransactions: recent,
    budgets,
    healthScore: health.score,
    healthNotes: health.notes,
  };
  return summary;
});

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

route("GET /api/analytics/insights", () => {
  const now = latestDate();
  const thisFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevTo = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const cur = categoryBreakdown(thisFrom, now);
  const prev = categoryBreakdown(prevFrom, prevTo);
  const prevByName = new Map(prev.map((c) => [c.name, c.total]));

  const out: { id: string; kind: string; title: string; detail: string; amount?: number }[] = [];
  for (const c of cur) {
    const before = prevByName.get(c.name);
    if (before == null || before === 0) continue;
    const delta = round2(c.total - before);
    // 25% and $40 together, so a rounding wobble on a small category doesn't
    // masquerade as news.
    if (Math.abs(delta) < 40 || Math.abs(delta) / before < 0.25) continue;
    out.push({
      id: `cat-${c.name}`,
      kind: delta > 0 ? "increase" : "decrease",
      title: `${c.name} ${delta > 0 ? "up" : "down"} ${Math.round((Math.abs(delta) / before) * 100)}%`,
      detail: `${delta > 0 ? "Spent" : "Saved"} $${Math.abs(delta).toFixed(2)} ${delta > 0 ? "more" : "less"} than last month.`,
      amount: delta,
    });
  }
  return out.sort((a, b) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0)).slice(0, 8);
});

route("GET /api/reports/csv", () => {
  const header = "date,description,merchant,category,account,amount\n";
  const body = allTxns()
    .slice()
    .sort((a, b) => asDate(a.date).getTime() - asDate(b.date).getTime())
    .map((t) => [
      ymd(t.date),
      JSON.stringify(t.description ?? ""),
      JSON.stringify(merchantDTO(t.merchantId)?.name ?? ""),
      JSON.stringify(categoryDTO(t.categoryId)?.name ?? ""),
      JSON.stringify(String(t.accountId ?? "")),
      t.amount,
    ].join(","))
    .join("\n");
  return header + body;
});
