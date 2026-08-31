import { useNavigate } from "react-router-dom";
import { useFetch } from "../hooks/useFetch";
import { fmtMoney, fmtMonth, fmtSigned } from "../lib/format";
import { Badge, Modal, Spinner } from "./ui";

interface Row {
  id: number | null;
  name: string;
  color: string;
  total: number;
  count: number;
}

interface Breakdown {
  month: string;
  from: string;
  to: string;
  income: Row[];
  expenses: Row[];
  investments: Row[];
  totalIncome: number;
  totalExpenses: number;
  totalInvestments: number;
}

/** Drill-down shown when a month is clicked on an Income vs Expenses chart. */
export function MonthBreakdownModal({ month, onClose }: { month: string; onClose: () => void }) {
  const { data } = useFetch<Breakdown>(`/api/analytics/month-breakdown?month=${month}`);
  const navigate = useNavigate();

  function openTransactions(row: Row) {
    if (!data) return;
    const cat = row.id != null ? `&categoryId=${row.id}` : "";
    onClose();
    navigate(`/transactions?from=${data.from}&to=${data.to}${cat}`, { state: { back: true } });
  }

  return (
    <Modal title={`${fmtMonth(month)} breakdown`} onClose={onClose} wide>
      {!data ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-semibold text-emerald-600 dark:text-emerald-400">Income</h3>
              <span className="font-bold tabular-nums">{fmtMoney(data.totalIncome)}</span>
            </div>
            {data.income.length === 0 ? (
              <p className="text-sm text-slate-500">No income recorded this month.</p>
            ) : (
              <div className="space-y-1">
                {data.income.map((r) => (
                  <RowButton key={r.name} row={r} onClick={() => openTransactions(r)} />
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-semibold text-rose-600 dark:text-rose-400">Expenses</h3>
              <span className="font-bold tabular-nums">{fmtMoney(data.totalExpenses)}</span>
            </div>
            {data.expenses.length === 0 ? (
              <p className="text-sm text-slate-500">No expenses recorded this month.</p>
            ) : (
              <div className="space-y-1">
                {data.expenses.map((r) => (
                  <RowButton key={r.name} row={r} onClick={() => openTransactions(r)} />
                ))}
              </div>
            )}
          </section>

          {data.totalInvestments > 0 && (
            <section className="md:col-span-2">
              <div className="mb-1 flex items-baseline justify-between">
                <h3 className="font-semibold text-emerald-700 dark:text-emerald-300">Investments</h3>
                <span className="font-bold tabular-nums">{fmtMoney(data.totalInvestments)}</span>
              </div>
              <div className="space-y-1">
                {data.investments.map((r) => (
                  <RowButton key={r.name} row={r} onClick={() => openTransactions(r)} />
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-400">Contributions — not counted as spending.</p>
            </section>
          )}

          <div className="md:col-span-2 border-t border-slate-200 pt-3 text-right text-sm dark:border-slate-800">
            Saved (income − expenses):{" "}
            <span className={`font-bold tabular-nums ${data.totalIncome - data.totalExpenses >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}>
              {fmtSigned(Math.round((data.totalIncome - data.totalExpenses) * 100) / 100)}
            </span>
            {data.totalInvestments > 0 && (
              <span className="ml-3 text-slate-500">
                of which invested {fmtMoney(data.totalInvestments)}
              </span>
            )}
            <span className="ml-3 text-xs text-slate-400">Click any row to see its transactions.</span>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RowButton({ row, onClick }: { row: Row; onClick: () => void }) {
  return (
    <button
      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
      onClick={onClick}
      title="View these transactions"
    >
      <span className="flex items-center gap-2">
        <Badge color={row.color}>{row.name}</Badge>
        <span className="text-xs text-slate-400">×{row.count}</span>
      </span>
      <span className="tabular-nums">{fmtMoney(row.total)}</span>
    </button>
  );
}
