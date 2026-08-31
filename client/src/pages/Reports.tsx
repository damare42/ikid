import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { BudgetStatusDTO, GoalDTO, MonthlyPoint } from "@shared/types";
import { useFetch } from "../hooks/useFetch";
import { fmtMoney, fmtMonth, monthInputValue } from "../lib/format";
import { Badge, Card, ProgressBar, Spinner } from "../components/ui";
import { legendLabel, useChartColors } from "../lib/chartColors";

export default function Reports() {
  const c = useChartColors();
  const [month] = useState(monthInputValue());
  const { data: monthly } = useFetch<MonthlyPoint[]>("/api/analytics/monthly?months=12");
  const { data: cats } = useFetch<{ name: string; color: string; total: number }[]>("/api/analytics/categories");
  const { data: budgets } = useFetch<BudgetStatusDTO[]>(`/api/budgets?month=${month}`);
  const { data: goals } = useFetch<GoalDTO[]>("/api/goals");
  const { data: savings } = useFetch<any>("/api/analytics/savings");

  if (!monthly || !cats) return <Spinner />;

  const last = monthly[monthly.length - 1];
  const totalIncome = monthly.reduce((s, p) => s + p.income, 0);
  const totalExpenses = monthly.reduce((s, p) => s + p.expenses, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="no-print flex items-center justify-between">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">Reports</h1>
        <div className="flex gap-2">
          <a className="btn-ghost" href="/api/reports/csv" download>⬇ Export CSV</a>
          <button className="btn-primary" onClick={() => window.print()}>🖨 Save as PDF</button>
        </div>
      </div>

      {/* Printable report */}
      <Card>
        <div className="mb-4 border-b border-slate-200 pb-3 dark:border-slate-800">
          <div className="text-2xl font-bold">Ikid Financial Report</div>
          <div className="text-sm text-slate-500">
            Generated {new Date().toLocaleDateString("en-US", { dateStyle: "long" })} · last 12 months
          </div>
        </div>

        <h3 className="mb-2 font-semibold">Summary</h3>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Sum label="Total income" value={fmtMoney(totalIncome)} />
          <Sum label="Total expenses" value={fmtMoney(totalExpenses)} />
          <Sum label="Net saved" value={fmtMoney(totalIncome - totalExpenses)} />
          <Sum label="This month net" value={fmtMoney(last ? last.savings : 0)} />
        </div>

        <h3 className="mb-2 font-semibold">Income vs Expenses</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
            <XAxis dataKey="month" tickFormatter={fmtMonth} fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={70} />
            <Tooltip formatter={(v: number) => fmtMoney(v)} />
            <Legend formatter={legendLabel} />
            <Bar dataKey="income" name="Income" fill={c.in} />
            <Bar dataKey="expenses" name="Expenses" fill={c.out} />
          </BarChart>
        </ResponsiveContainer>

        <h3 className="mb-2 mt-6 font-semibold">Spending by Category (all time)</h3>
        <div className="flex items-center">
          <ResponsiveContainer width="50%" height={220}>
            <PieChart>
              <Pie data={cats.slice(0, 8)} dataKey="total" nameKey="name" outerRadius={85}>
                {cats.slice(0, 8).map((c) => <Cell key={c.name} fill={c.color} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
            </PieChart>
          </ResponsiveContainer>
          <table className="flex-1 text-sm">
            <tbody>
              {cats.slice(0, 8).map((c) => (
                <tr key={c.name} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1"><Badge color={c.color}>{c.name}</Badge></td>
                  <td className="py-1 text-right tabular-nums">{fmtMoney(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {budgets && budgets.length > 0 && (
          <>
            <h3 className="mb-2 mt-6 font-semibold">Budget Status — {fmtMonth(month)}</h3>
            <div className="space-y-2">
              {budgets.map((b) => (
                <div key={b.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{b.categoryName}</span>
                    <span className="tabular-nums">
                      {fmtMoney(b.spent)} / {fmtMoney(b.monthlyLimit)} ({Math.round(b.pctUsed)}%)
                    </span>
                  </div>
                  <ProgressBar pct={b.pctUsed} />
                </div>
              ))}
            </div>
          </>
        )}

        {goals && goals.length > 0 && (
          <>
            <h3 className="mb-2 mt-6 font-semibold">Goal Progress</h3>
            <div className="overflow-x-auto">
              {/* Scrolls sideways rather than squashing. On a phone these columns are
                  wider than the screen, and a table that drags the whole page into
                  horizontal scrolling is the worse of the two failures. */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="th">Goal</th><th className="th text-right">Saved</th>
                    <th className="th text-right">Target</th><th className="th text-right">Progress</th>
                    <th className="th">Est. completion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {goals.map((g) => (
                    <tr key={g.id}>
                      <td className="td">{g.icon} {g.name}</td>
                      <td className="td text-right tabular-nums">{fmtMoney(g.currentSaved)}</td>
                      <td className="td text-right tabular-nums">{fmtMoney(g.targetAmount)}</td>
                      <td className="td text-right">{g.progressPct}%</td>
                      <td className="td">{g.estimatedCompletion ? fmtMonth(g.estimatedCompletion) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {savings && (
          <>
            <h3 className="mb-2 mt-6 font-semibold">Savings</h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Sum label="Avg monthly savings" value={fmtMoney(savings.averageMonthlySavings)} />
              <Sum label="Savings rate" value={`${Math.round(savings.savingsRate * 100)}%`} />
              <Sum label="Est. yearly" value={fmtMoney(savings.estimatedYearlySavings)} />
              <Sum label="Emergency fund target" value={fmtMoney(savings.emergencyFundTarget)} />
            </div>
          </>
        )}
      </Card>

      <div className="no-print text-center text-xs text-slate-400">
        "Save as PDF" opens your browser's print dialog — choose "Save as PDF" as the destination.
      </div>
    </div>
  );
}

function Sum({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
