import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { CategoryDTO, InsightDTO, MonthlyPoint, TransactionDTO } from "@shared/types";
import { useFetch } from "../hooks/useFetch";
import { fmtDate, fmtMoney, fmtMonth } from "../lib/format";
import { Badge, Card, ProgressBar, Spinner } from "../components/ui";
import { MonthBreakdownModal } from "../components/MonthBreakdownModal";
import { legendLabel, useChartColors } from "../lib/chartColors";

type Tab = "trends" | "breakdown" | "recurring" | "insights";

export default function Analytics() {
  // Tab lives in the URL so browser Back returns to the exact view.
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = raw === "breakdown" || raw === "recurring" || raw === "insights" ? raw : "trends";
  function setTab(t: Tab) {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next);
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">Analytics</h1>
        <div className="flex gap-1 rounded-lg bg-slate-200 p-1 dark:bg-slate-800">
          {(["trends", "breakdown", "recurring", "insights"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`rounded-md px-3 py-1 text-sm capitalize ${tab === t ? "bg-white font-medium shadow dark:bg-slate-700" : "text-slate-500"}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {tab === "trends" && <Trends />}
      {tab === "breakdown" && <Breakdown />}
      {tab === "recurring" && <Recurring />}
      {tab === "insights" && <Insights />}
    </div>
  );
}

function Trends() {
  const c = useChartColors();
  const { data: monthly } = useFetch<MonthlyPoint[]>("/api/analytics/monthly?months=12");
  const [breakdownMonth, setBreakdownMonth] = useState<string | null>(null);
  const { data: weekly } = useFetch<{ week: string; spending: number }[]>("/api/analytics/weekly?weeks=12");
  const { data: yearly } = useFetch<MonthlyPoint[]>("/api/analytics/yearly");
  const { data: savings } = useFetch<any>("/api/analytics/savings");
  const { data: heat } = useFetch<{ date: string; total: number }[]>(`/api/analytics/heatmap?year=${new Date().getFullYear()}`);

  if (!monthly) return <Spinner />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Monthly Income vs Expenses (click a month for the breakdown)">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            data={monthly}
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
            <Legend formatter={legendLabel} />
            <Bar dataKey="income" name="Income" fill={c.in} radius={[3, 3, 0, 0]} />
            <Bar dataKey="expenses" name="Expenses" fill={c.out} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Savings Trend">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
            <XAxis dataKey="month" tickFormatter={fmtMonth} fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={70} />
            <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(m) => fmtMonth(String(m))} />
            <Line type="monotone" dataKey="savings" name="Net savings" stroke={c.series[0]} strokeWidth={2} dot />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Weekly Spending — last 12 weeks">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={weekly ?? []}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
            <XAxis dataKey="week" tickFormatter={(d) => d.slice(5)} fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={70} />
            <Tooltip formatter={(v: number) => fmtMoney(v)} />
            <Bar dataKey="spending" name="Spending" fill={c.out} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Yearly Totals">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={yearly ?? []}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
            <XAxis dataKey="month" fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={70} />
            <Tooltip formatter={(v: number) => fmtMoney(v)} />
            <Legend formatter={legendLabel} />
            <Bar dataKey="income" name="Income" fill={c.in} radius={[3, 3, 0, 0]} />
            <Bar dataKey="expenses" name="Expenses" fill={c.out} radius={[3, 3, 0, 0]} />
            <Bar dataKey="savings" name="Savings" fill={c.series[0]} radius={[3, 3, 0, 0]} />
            <Bar dataKey="investments" name="Investments" fill={c.series[1]} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {savings && (
        <Card title="Savings Analysis">
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
            <Metric label="Avg monthly savings" value={fmtMoney(savings.averageMonthlySavings)} />
            <Metric label="Savings rate" value={`${Math.round(savings.savingsRate * 100)}%`} />
            <Metric label="Est. yearly savings" value={fmtMoney(savings.estimatedYearlySavings)} />
            <Metric label="Best month" value={`${fmtMonth(savings.highestMonth.month)} (${fmtMoney(savings.highestMonth.savings)})`} />
            <Metric label="Worst month" value={`${fmtMonth(savings.lowestMonth.month)} (${fmtMoney(savings.lowestMonth.savings)})`} />
            <Metric label="Emergency fund (6× expenses)" value={fmtMoney(savings.emergencyFundTarget)} />
          </div>
        </Card>
      )}

      <Card title={`Spending Heatmap — ${new Date().getFullYear()}`}>
        <Heatmap data={heat ?? []} />
      </Card>

      {breakdownMonth && (
        <MonthBreakdownModal month={breakdownMonth} onClose={() => setBreakdownMonth(null)} />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Heatmap({ data }: { data: { date: string; total: number }[] }) {
  const byDate = new Map(data.map((d) => [d.date, d.total]));
  const max = Math.max(1, ...data.map((d) => d.total));
  const year = new Date().getFullYear();
  const start = new Date(year, 0, 1);
  const days: { date: string; total: number }[] = [];
  for (let d = new Date(start); d.getFullYear() === year && d <= new Date(); d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({ date: key, total: byDate.get(key) ?? 0 });
  }
  const weeks: (typeof days)[] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((d) => {
              const intensity = d.total === 0 ? 0 : Math.min(1, 0.15 + (d.total / max) * 0.85);
              return (
                <div
                  key={d.date}
                  title={`${d.date}: ${fmtMoney(d.total)}`}
                  className="h-3 w-3 rounded-sm bg-slate-200 dark:bg-slate-800"
                  style={intensity ? { backgroundColor: `rgba(225,29,72,${intensity})` } : undefined}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 text-xs text-slate-500">Darker = more spent that day. Hover for amounts.</div>
    </div>
  );
}

function Breakdown() {
  const c = useChartColors();
  // Date range lives in the URL so Back restores the exact view.
  const [params, setParams] = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  function setRange(patch: { from?: string; to?: string }) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next);
  }
  const setFrom = (v: string) => setRange({ from: v });
  const setTo = (v: string) => setRange({ to: v });
  const navigate = useNavigate();
  const range = `${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  const { data: cats } = useFetch<{ id: number | null; name: string; color: string; total: number; count: number }[]>(`/api/analytics/categories?x=1${range}`);

  function openCategory(c: { id: number | null }) {
    const parts = [
      c.id != null ? `categoryId=${c.id}` : "",
      from ? `from=${from}` : "",
      to ? `to=${to}` : "",
    ].filter(Boolean);
    navigate(`/transactions${parts.length ? "?" + parts.join("&") : ""}`, { state: { back: true } });
  }
  const { data: merchants } = useFetch<{ name: string; total: number; count: number }[]>(`/api/analytics/merchants?limit=15${range}`);
  const { data: largest } = useFetch<TransactionDTO[]>(`/api/analytics/largest?limit=10${range}`);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Date range:</span>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>→</span>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          {(from || to) && <button className="btn-ghost" onClick={() => setRange({ from: "", to: "" })}>Clear</button>}
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Category Breakdown">
          {!cats ? <Spinner /> : (
            <div>
              {/* Stacked, for the reason described on the dashboard's Largest
                  Categories: a ResponsiveContainer with a percentage width is
                  under-defined inside a flex row, and Recharts' absolutely
                  positioned svg then draws over the list beside it. */}
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={cats.slice(0, 9)}
                    dataKey="total"
                    nameKey="name"
                    outerRadius={95}
                    className="cursor-pointer"
                    onClick={(_, index) => openCategory(cats[index])}
                  >
                    {cats.slice(0, 9).map((c) => <Cell key={c.name} fill={c.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtMoney(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-1 grid max-h-56 grid-cols-1 gap-x-4 gap-y-0.5 overflow-y-auto pr-1 sm:grid-cols-2">
                {cats.map((c) => (
                  <button
                    key={c.name}
                    className="flex w-full min-w-0 items-center justify-between gap-2 rounded px-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => openCategory(c)}
                    title="View these transactions"
                  >
                    <Badge color={c.color}>{c.name}</Badge>
                    <span className="shrink-0 tabular-nums">{fmtMoney(c.total)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card title="Top Merchants">
          {!merchants ? <Spinner /> : (
            <ResponsiveContainer width="100%" height={Math.max(260, merchants.length * 24)}>
              <BarChart data={merchants} layout="vertical" margin={{ left: 40 }}>
                <XAxis type="number" fontSize={11} tickFormatter={(v) => fmtMoney(v)} />
                <YAxis type="category" dataKey="name" fontSize={11} width={110} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
                <Bar dataKey="total" fill={c.series[0]} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
      <TopMerchantsByCategory from={from} to={to} />

      <Card title="Largest Purchases">
        {!largest ? <Spinner /> : (
          <div className="overflow-x-auto">
            {/* Scrolls sideways rather than squashing. On a phone these columns are
                wider than the screen, and a table that drags the whole page into
                horizontal scrolling is the worse of the two failures. */}
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="th">Date</th><th className="th">Description</th><th className="th">Category</th><th className="th text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {largest.map((t) => (
                  <tr key={t.id}>
                    <td className="td whitespace-nowrap">{fmtDate(t.date)}</td>
                    <td className="td">{t.merchant?.name ?? t.description}</td>
                    <td className="td">{t.category && <Badge color={t.category.color}>{t.category.name}</Badge>}</td>
                    <td className="td text-right font-semibold tabular-nums">{fmtMoney(Math.abs(t.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function TopMerchantsByCategory({ from, to }: { from: string; to: string }) {
  const navigate = useNavigate();
  const { data: categories } = useFetch<CategoryDTO[]>("/api/categories");
  const [categoryId, setCategoryId] = useState<number | null>(null);

  // Default to Shopping (or the first expense category) once categories load.
  const expenseCats = (categories ?? []).filter((c) => c.type === "expense");
  const selectedId =
    categoryId ?? expenseCats.find((c) => c.name === "Shopping")?.id ?? expenseCats[0]?.id ?? null;
  const selected = expenseCats.find((c) => c.id === selectedId);

  const range = `${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  const { data } = useFetch<{
    categoryTotal: number;
    merchants: { merchantId: number | null; name: string; total: number; count: number; pct: number }[];
  }>(selectedId ? `/api/analytics/category-merchants?categoryId=${selectedId}&limit=10${range}` : null);

  return (
    <Card
      title={`Top 10 Merchants — ${selected?.name ?? ""}`}
      action={
        <select
          className="input !py-1 text-xs"
          value={selectedId ?? ""}
          onChange={(e) => setCategoryId(Number(e.target.value))}
        >
          {expenseCats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      }
    >
      {!data ? (
        <Spinner />
      ) : data.merchants.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500">
          No spending in this category for the selected range.
        </div>
      ) : (
        <div className="space-y-2">
          {data.merchants.map((m) => (
            <button
              key={m.name}
              className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => {
                const parts = [
                  `categoryId=${selectedId}`,
                  m.merchantId != null ? `merchantId=${m.merchantId}` : "",
                  from ? `from=${from}` : "",
                  to ? `to=${to}` : "",
                ].filter(Boolean);
                navigate(`/transactions?${parts.join("&")}`, { state: { back: true } });
              }}
              title="View these transactions"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">
                  {m.name} <span className="text-xs text-slate-400">×{m.count}</span>
                </span>
                <span className="tabular-nums">
                  {fmtMoney(m.total)}
                  <span className="ml-1.5 text-xs text-slate-400">{m.pct}%</span>
                </span>
              </div>
              <ProgressBar pct={m.pct} color={selected?.color} />
            </button>
          ))}
          <div className="pt-1 text-right text-xs text-slate-400">
            Category total: {fmtMoney(data.categoryTotal)} · percentages are of this category
          </div>
        </div>
      )}
    </Card>
  );
}

function Recurring() {
  const { data } = useFetch<{ merchant: string; avgAmount: number; count: number; lastDate: string; active: boolean; monthlyEstimate: number }[]>("/api/analytics/recurring");
  if (!data) return <Spinner />;
  const total = data.filter((r) => r.active).reduce((s, r) => s + r.monthlyEstimate, 0);
  return (
    <Card title={`Recurring Payments — ~${fmtMoney(total)}/month active`}>
      <div className="overflow-x-auto">
        {/* Scrolls sideways rather than squashing. On a phone these columns are
            wider than the screen, and a table that drags the whole page into
            horizontal scrolling is the worse of the two failures. */}
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="th">Merchant</th><th className="th text-right">Avg amount</th>
              <th className="th text-right">Times seen</th><th className="th">Last charge</th><th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.map((r) => (
              <tr key={r.merchant}>
                <td className="td font-medium">{r.merchant}</td>
                <td className="td text-right tabular-nums">{fmtMoney(r.avgAmount)}</td>
                <td className="td text-right">{r.count}</td>
                <td className="td">{fmtDate(r.lastDate)}</td>
                <td className="td">
                  {r.active
                    ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">active</span>
                    : <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">inactive</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Insights() {
  const { data } = useFetch<InsightDTO[]>("/api/analytics/insights");
  if (!data) return <Spinner />;
  const KIND: Record<InsightDTO["kind"], { icon: string; cls: string }> = {
    increase: { icon: "📈", cls: "border-rose-200 dark:border-rose-900" },
    decrease: { icon: "📉", cls: "border-emerald-200 dark:border-emerald-900" },
    info: { icon: "💡", cls: "border-slate-200 dark:border-slate-800" },
    warning: { icon: "⚠️", cls: "border-amber-200 dark:border-amber-900" },
    opportunity: { icon: "💰", cls: "border-brand-200 dark:border-brand-900" },
  };
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {data.map((i) => (
        <div key={i.id} className={`card border-2 ${KIND[i.kind].cls}`}>
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <span>{KIND[i.kind].icon}</span> {i.title}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300">{i.detail}</div>
        </div>
      ))}
    </div>
  );
}
