import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { DashboardSummary, MonthlyPoint, NetWorthSummary } from "@shared/types";
import { useFetch } from "../hooks/useFetch";
import { fmtDate, fmtMoney, fmtMonth, fmtSigned, monthInputValue, pct } from "../lib/format";
import { Badge, Card, ErrorNote, Modal, ProgressBar, Spinner, StatCard } from "../components/ui";
import { MonthBreakdownModal } from "../components/MonthBreakdownModal";

interface CspBucket {
  key: string;
  label: string;
  total: number;
  pctOfIncome: number;
  targetLow: number;
  targetHigh: number;
  color: string;
  categories: { id: number | null; name: string; color: string; total: number; count: number }[];
}

interface CspBreakdown {
  month: string;
  from: string;
  to: string;
  income: number;
  allocated: number;
  unallocated: number;
  buckets: CspBucket[];
}

function YearTotalsModal({ monthly, onClose }: { monthly: MonthlyPoint[]; onClose: () => void }) {
  const totalIncome = monthly.reduce((s, p) => s + p.income, 0);
  const totalExpenses = monthly.reduce((s, p) => s + p.expenses, 0);
  const totalSavings = totalIncome - totalExpenses;
  // Averages exclude the current (partial) month so they aren't skewed low.
  const complete = monthly.slice(0, -1);
  const n = Math.max(1, complete.length);
  const avgIncome = complete.reduce((s, p) => s + p.income, 0) / n;
  const avgExpenses = complete.reduce((s, p) => s + p.expenses, 0) / n;
  const first = monthly[0]?.month ?? "";
  const last = monthly[monthly.length - 1]?.month ?? "";

  const Row = ({ label, total, avg, tone }: { label: string; total: number; avg: number; tone?: string }) => (
    <tr className="border-b border-slate-100 dark:border-slate-800">
      <td className="py-2 font-medium">{label}</td>
      <td className={`py-2 text-right font-bold tabular-nums ${tone ?? ""}`}>{fmtMoney(total)}</td>
      <td className="py-2 text-right tabular-nums text-slate-500">{fmtMoney(avg)}/mo</td>
    </tr>
  );

  return (
    <Modal title={`Totals — ${fmtMonth(first)} to ${fmtMonth(last)}`} onClose={onClose}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
            <th className="py-1 text-left"></th>
            <th className="py-1 text-right">Total</th>
            <th className="py-1 text-right">Average</th>
          </tr>
        </thead>
        <tbody>
          <Row label="Income" total={totalIncome} avg={avgIncome} tone="text-emerald-600 dark:text-emerald-400" />
          <Row label="Expenses" total={totalExpenses} avg={avgExpenses} tone="text-rose-600 dark:text-rose-400" />
          <Row
            label="Net saved"
            total={totalSavings}
            avg={avgIncome - avgExpenses}
            tone={totalSavings >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}
          />
        </tbody>
      </table>
      <p className="mt-3 text-xs text-slate-400">
        Totals cover all {monthly.length} months shown (including the current month so far). Averages
        use the {n} complete months, so the in-progress month doesn't skew them. Savings rate over the
        period: {totalIncome > 0 ? Math.round((totalSavings / totalIncome) * 100) : 0}%.
      </p>
    </Modal>
  );
}

function CspDetailModal({ csp, onClose, onOpenCategory }: {
  csp: CspBreakdown;
  onClose: () => void;
  onOpenCategory: (categoryId: number | null) => void;
}) {
  const label = csp.month.endsWith("YTD") ? `${csp.month.slice(0, 4)} year to date` : fmtMonth(csp.month);
  return (
    <Modal title={`Conscious Spending Plan — ${label}`} onClose={onClose} wide>
      <div className="mb-3 text-sm text-slate-500">
        Take-home income: <b className="text-slate-800 dark:text-slate-100">{fmtMoney(csp.income)}</b>
        {" · "}savings is the leftover after spending and investing
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {csp.buckets.map((b) => (
          <section key={b.key} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-1 flex items-center justify-between">
              <Badge color={b.color}>{b.label}</Badge>
              <span className="font-bold tabular-nums">{fmtMoney(b.total)}</span>
            </div>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
              <span>
                target {b.targetLow === b.targetHigh ? `${b.targetLow}%` : `${b.targetLow}–${b.targetHigh}%`} of income
              </span>
              <span className="font-semibold">{b.pctOfIncome}% actual</span>
            </div>
            <ProgressBar pct={b.targetHigh > 0 ? (b.pctOfIncome / b.targetHigh) * 100 : 0} color={b.color} />
            {b.categories.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">
                {b.key === "savings"
                  ? "Income − fixed costs − investments − guilt-free spending."
                  : "Nothing in this bucket for the period."}
              </p>
            ) : (
              <div className="mt-2 space-y-0.5">
                {b.categories.map((c) => (
                  <button
                    key={c.name}
                    className="flex w-full items-center justify-between rounded px-1.5 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => onOpenCategory(c.id)}
                    title="View these transactions"
                  >
                    <span className="flex items-center gap-2">
                      <Badge color={c.color}>{c.name}</Badge>
                      <span className="text-xs text-slate-400">×{c.count}</span>
                    </span>
                    <span className="tabular-nums">{fmtMoney(c.total)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      <p className="mt-3 text-right text-xs text-slate-400">Click any category to see its transactions.</p>
    </Modal>
  );
}

export default function Dashboard() {
  // Month/range live in the URL so browser Back returns to the exact view.
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? monthInputValue();
  const mode: "month" | "ytd" = params.get("range") === "ytd" ? "ytd" : "month";

  function setView(patch: { month?: string; range?: "month" | "ytd" }) {
    const next = new URLSearchParams(params);
    if (patch.month !== undefined) next.set("month", patch.month);
    if (patch.range !== undefined) {
      if (patch.range === "ytd") next.set("range", "ytd");
      else next.delete("range");
    }
    setParams(next);
  }
  const summaryUrl =
    mode === "ytd" ? "/api/analytics/summary?range=ytd" : `/api/analytics/summary?month=${month}`;
  const { data: s, loading, error } = useFetch<DashboardSummary>(summaryUrl);
  const [ivRange, setIvRange] = useState<"12m" | "ytd">("12m");
  const ivMonths = ivRange === "ytd" ? new Date().getMonth() + 1 : 12;
  const { data: monthly } = useFetch<MonthlyPoint[]>(`/api/analytics/monthly?months=${ivMonths}`);
  const { data: csp } = useFetch<CspBreakdown>(
    mode === "ytd" ? "/api/analytics/csp?range=ytd" : `/api/analytics/csp?month=${month}`,
  );
  const { data: nw } = useFetch<NetWorthSummary>("/api/networth/summary");
  const hasNetWorth = !!nw && nw.assets.length > 0;
  const navigate = useNavigate();
  const [breakdownMonth, setBreakdownMonth] = useState<string | null>(null);
  const [cspOpen, setCspOpen] = useState(false);
  const [totalsOpen, setTotalsOpen] = useState(false);

  /** Jump to the Transactions page filtered to a category and this view's date range. */
  function openCategory(c: { id: number | null }) {
    if (!s) return;
    const cat = c.id != null ? `&categoryId=${c.id}` : "";
    navigate(`/transactions?from=${s.from}&to=${s.to}${cat}`, { state: { back: true } });
  }

  if (loading && !s) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!s) return null;

  const scoreTone = s.healthScore >= 70 ? "good" : s.healthScore >= 45 ? "default" : "bad";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-slate-200 p-1 dark:bg-slate-800">
            <button
              className={`rounded-md px-3 py-1 text-sm ${mode === "month" ? "bg-white font-medium shadow dark:bg-slate-700" : "text-slate-500"}`}
              onClick={() => setView({ range: "month" })}
            >
              Month
            </button>
            <button
              className={`rounded-md px-3 py-1 text-sm ${mode === "ytd" ? "bg-white font-medium shadow dark:bg-slate-700" : "text-slate-500"}`}
              onClick={() => setView({ range: "ytd" })}
            >
              Year to date
            </button>
          </div>
          {mode === "month" && (
            <input type="month" className="input" value={month} onChange={(e) => setView({ month: e.target.value })} />
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${hasNetWorth ? "xl:grid-cols-7" : "xl:grid-cols-6"}`}>
        <StatCard label="Income" value={fmtMoney(s.income)} tone="good" />
        <StatCard label="Spending" value={fmtMoney(s.spending)} />
        <StatCard label="Net Savings" value={fmtSigned(s.netSavings)} tone={s.netSavings >= 0 ? "good" : "bad"} />
        <StatCard label="Savings Rate" value={pct(s.savingsRate * 100)} tone={s.savingsRate >= 0.15 ? "good" : s.savingsRate < 0 ? "bad" : "default"} />
        <StatCard
          label="Budget Status"
          value={s.budgets.length ? `${s.budgets.filter((b) => !b.overBudget).length}/${s.budgets.length}` : "—"}
          sub={s.budgets.length ? "budgets on track" : "no budgets set"}
        />
        <StatCard label="Health Score" value={`${s.healthScore}`} sub="out of 100" tone={scoreTone} />
        {hasNetWorth && (
          <div className="cursor-pointer" onClick={() => navigate("/networth")} title="Open Net Worth">
            <StatCard
              label="💎 Net Worth"
              value={fmtMoney(nw!.netWorth)}
              tone={nw!.netWorth >= 0 ? "good" : "bad"}
              sub="view details →"
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Cash flow */}
        <Card title={`Cash Flow — ${mode === "ytd" ? `${s.month.slice(0, 4)} year to date` : fmtMonth(s.month)}`}>
          {s.cashFlow.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No activity this month.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={s.cashFlow}>
                <defs>
                  <linearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1a7f5a" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#1a7f5a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => (mode === "ytd" ? d.slice(5) : d.slice(8))}
                  fontSize={11}
                />
                <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={70} />
                <Tooltip formatter={(v: number) => fmtSigned(v)} labelFormatter={(d) => fmtDate(String(d))} />
                <Area type="monotone" dataKey="cumulative" name="Cumulative" stroke="#1a7f5a" fill="url(#cf)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Category pie */}
        <Card title="Largest Categories">
          {s.largestCategories.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No spending yet this month.</div>
          ) : (
            <div className="flex items-center">
              <ResponsiveContainer width="60%" height={220}>
                <PieChart>
                  <Pie
                    data={s.largestCategories}
                    dataKey="total"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                    className="cursor-pointer"
                    onClick={(_, index) => openCategory(s.largestCategories[index])}
                  >
                    {s.largestCategories.map((c) => <Cell key={c.name} fill={c.color} />)}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) =>
                      `${fmtMoney(v)} (${s.spending > 0 ? Math.round((v / s.spending) * 100) : 0}%)`
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-1.5">
                {s.largestCategories.map((c) => (
                  <button
                    key={c.name}
                    className="flex items-center justify-between gap-4 rounded px-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => openCategory(c)}
                    title="View these transactions"
                  >
                    <Badge color={c.color}>{c.name}</Badge>
                    <span className="tabular-nums">
                      {fmtMoney(c.total)}
                      <span className="ml-1.5 text-xs text-slate-400">
                        {s.spending > 0 ? Math.round((c.total / s.spending) * 100) : 0}%
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Income vs Expenses trend */}
        <Card
          title={
            <button
              className="text-left hover:underline"
              onClick={() => setTotalsOpen(true)}
              title="Show totals and averages"
            >
              Income vs Expenses — {ivRange === "ytd" ? "year to date" : "12 months"}
            </button>
          }
          action={
            <div className="flex gap-1 rounded-lg bg-slate-200 p-0.5 text-xs dark:bg-slate-800">
              <button
                className={`rounded-md px-2 py-0.5 ${ivRange === "12m" ? "bg-white font-medium shadow dark:bg-slate-700" : "text-slate-500"}`}
                onClick={() => setIvRange("12m")}
              >
                12 mo
              </button>
              <button
                className={`rounded-md px-2 py-0.5 ${ivRange === "ytd" ? "bg-white font-medium shadow dark:bg-slate-700" : "text-slate-500"}`}
                onClick={() => setIvRange("ytd")}
              >
                YTD
              </button>
            </div>
          }
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={monthly ?? []}
              onClick={(state: any) => {
                const m = state?.activePayload?.[0]?.payload?.month;
                if (m) setBreakdownMonth(m);
              }}
              className="cursor-pointer"
            >
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
              <XAxis dataKey="month" tickFormatter={fmtMonth} fontSize={11} />
              <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={70} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(m) => fmtMonth(String(m))} />
              <Legend />
              <Bar dataKey="income" name="Income" fill="#1a7f5a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill="#c62f14" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Conscious Spending Plan */}
        <Card title="Conscious Spending Plan">
          {!csp || csp.income <= 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              No income recorded for this period yet — the plan compares each bucket to your take-home pay.
            </div>
          ) : (
            <>
              <div className="flex items-center">
                <ResponsiveContainer width="55%" height={200}>
                  <PieChart>
                    <Pie
                      data={csp.buckets.filter((b) => b.total > 0)}
                      dataKey="total"
                      nameKey="label"
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={2}
                      className="cursor-pointer"
                      onClick={() => setCspOpen(true)}
                    >
                      {csp.buckets.filter((b) => b.total > 0).map((b) => (
                        <Cell key={b.key} fill={b.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtMoney(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-1 flex-col gap-2">
                  {csp.buckets.map((b) => {
                    // Saving/investing above target is good; overspending fixed/guilt-free is not.
                    const saverBucket = b.key === "investments" || b.key === "savings";
                    const good = saverBucket
                      ? b.pctOfIncome >= b.targetLow
                      : b.pctOfIncome >= b.targetLow && b.pctOfIncome <= b.targetHigh;
                    const bad = !saverBucket && b.pctOfIncome > b.targetHigh;
                    return (
                      <div
                        key={b.key}
                        className="cursor-pointer rounded px-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => setCspOpen(true)}
                        title="View bucket details"
                      >
                        <div className="flex items-center justify-between">
                          <Badge color={b.color}>{b.label}</Badge>
                          <span className="tabular-nums">{fmtMoney(b.total)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-xs text-slate-500">
                          <span>
                            target {b.targetLow === b.targetHigh ? `${b.targetLow}%` : `${b.targetLow}–${b.targetHigh}%`}
                          </span>
                          <span
                            className={`font-semibold ${
                              good ? "text-emerald-600 dark:text-emerald-400"
                              : bad ? "text-rose-500"
                              : "text-amber-500"
                            }`}
                          >
                            {b.pctOfIncome}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Ramit Sethi's template: percentages of take-home income. Savings is what's left
                after spending and investing{csp.buckets.find((b) => b.key === "savings") &&
                csp.buckets.find((b) => b.key === "savings")!.total < 0
                  ? " — negative this period (spent more than earned)"
                  : ""}.
              </p>
            </>
          )}
        </Card>

        {/* Budgets */}
        <Card title="Budget Status">
          {s.budgets.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No budgets yet — add some on the Budgets page.</div>
          ) : (
            <div className="space-y-3">
              {s.budgets.slice(0, 6).map((b) => (
                <div key={b.id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <Badge color={b.categoryColor}>{b.categoryName}</Badge>
                    <span className="tabular-nums text-slate-500">
                      {fmtMoney(b.spent)} / {fmtMoney(b.monthlyLimit)}
                      {b.overBudget && <span className="ml-2 font-semibold text-rose-500">over</span>}
                    </span>
                  </div>
                  <ProgressBar pct={b.pctUsed} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Recent transactions */}
      <Card title="Recent Transactions">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="th">Date</th><th className="th">Merchant</th><th className="th">Category</th>
              <th className="th">Account</th><th className="th text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {s.recentTransactions.map((t) => (
              <tr key={t.id}>
                <td className="td whitespace-nowrap">{fmtDate(t.date)}</td>
                <td className="td">{t.merchant?.name ?? t.description}</td>
                <td className="td">{t.category && <Badge color={t.category.color}>{t.category.name}</Badge>}</td>
                <td className="td text-slate-500">{t.account?.name ?? "—"}</td>
                <td className={`td text-right tabular-nums ${t.amount > 0 ? "text-emerald-600" : ""}`}>
                  {fmtSigned(t.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {breakdownMonth && (
        <MonthBreakdownModal month={breakdownMonth} onClose={() => setBreakdownMonth(null)} />
      )}

      {totalsOpen && monthly && (
        <YearTotalsModal monthly={monthly} onClose={() => setTotalsOpen(false)} />
      )}

      {cspOpen && csp && (
        <CspDetailModal
          csp={csp}
          onClose={() => setCspOpen(false)}
          onOpenCategory={(catId) => {
            setCspOpen(false);
            const cat = catId != null ? `&categoryId=${catId}` : "";
            navigate(`/transactions?from=${csp.from}&to=${csp.to}${cat}`, { state: { back: true } });
          }}
        />
      )}

      {/* Health notes */}
      <Card title="Financial Health Breakdown">
        <ul className="grid gap-1 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-3">
          {s.healthNotes.map((n) => <li key={n}>• {n}</li>)}
        </ul>
      </Card>
    </div>
  );
}
