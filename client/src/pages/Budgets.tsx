import { useState } from "react";
import type { BudgetStatusDTO, CategoryDTO } from "@shared/types";
import { api } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { fmtMoney, monthInputValue, pct } from "../lib/format";
import { Badge, Card, EmptyState, ErrorNote, Modal, ProgressBar, Spinner } from "../components/ui";

export default function Budgets() {
  const [month, setMonth] = useState(monthInputValue());
  const { data: budgets, loading, error, refresh } = useFetch<BudgetStatusDTO[]>(`/api/budgets?month=${month}`);
  const { data: categories } = useFetch<CategoryDTO[]>("/api/categories");
  const [adding, setAdding] = useState(false);

  async function remove(id: number) {
    if (!confirm("Delete this budget?")) return;
    await api.delete(`/api/budgets/${id}`);
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">Budgets</h1>
        <div className="flex gap-2">
          <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button className="btn-primary" onClick={() => setAdding(true)}>+ Budget</button>
        </div>
      </div>

      {error && <ErrorNote message={error} />}
      {loading && !budgets ? (
        <Spinner />
      ) : !budgets || budgets.length === 0 ? (
        <Card><EmptyState icon="🎯" title="No budgets yet" hint="Set a monthly limit per category — Ikid tracks spending, remaining, and forecasts your end-of-month total." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {budgets.map((b) => (
            <Card key={b.id}>
              <div className="mb-2 flex items-center justify-between">
                <Badge color={b.categoryColor}>{b.categoryName}</Badge>
                <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => remove(b.id)}>✕</button>
              </div>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-2xl font-bold tabular-nums">{fmtMoney(b.spent)}</span>
                <span className="text-sm text-slate-500">of {fmtMoney(b.monthlyLimit)}</span>
              </div>
              <ProgressBar pct={b.pctUsed} />
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <div className="text-slate-500">Used</div>
                  <div className={`font-semibold ${b.overBudget ? "text-rose-500" : ""}`}>{pct(b.pctUsed)}</div>
                </div>
                <div>
                  <div className="text-slate-500">{b.remaining >= 0 ? "Remaining" : "Over by"}</div>
                  <div className={`font-semibold ${b.remaining < 0 ? "text-rose-500" : "text-emerald-600"}`}>
                    {fmtMoney(Math.abs(b.remaining))}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Forecast</div>
                  <div className={`font-semibold ${b.forecast > b.monthlyLimit ? "text-amber-500" : ""}`}>
                    {fmtMoney(b.forecast)}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {adding && categories && (
        <AddBudget
          categories={categories.filter((c) => c.type === "expense" && !budgets?.some((b) => b.categoryId === c.id))}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); refresh(); }}
        />
      )}
    </div>
  );
}

function AddBudget({ categories, onClose, onSaved }: {
  categories: CategoryDTO[]; onClose: () => void; onSaved: () => void;
}) {
  const [categoryId, setCategoryId] = useState<number | "">(categories[0]?.id ?? "");
  const [limit, setLimit] = useState("500");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      await api.put("/api/budgets", { categoryId: Number(categoryId), monthlyLimit: Number(limit) });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Modal title="Add budget" onClose={onClose}>
      <div className="space-y-3">
        {error && <ErrorNote message={error} />}
        <div>
          <label className="label">Category</label>
          <select className="input w-full" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Monthly limit ($)</label>
          <input type="number" min="1" className="input w-full" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!categoryId || !Number(limit)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
