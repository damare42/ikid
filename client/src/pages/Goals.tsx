import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GoalDTO } from "@shared/types";
import { api } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { fmtMoney, fmtMonth } from "../lib/format";
import { Card, EmptyState, ErrorNote, Modal, ProgressBar, Spinner } from "../components/ui";
import { useChartColors } from "../lib/chartColors";

export default function Goals() {
  const c = useChartColors();
  const { data: goals, loading, error, refresh } = useFetch<GoalDTO[]>("/api/goals");
  const [editing, setEditing] = useState<GoalDTO | null>(null);
  const [adding, setAdding] = useState(false);

  async function remove(id: number) {
    if (!confirm("Delete this goal?")) return;
    await api.delete(`/api/goals/${id}`);
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">Goals</h1>
        <button className="btn-primary" onClick={() => setAdding(true)}>+ Goal</button>
      </div>

      {error && <ErrorNote message={error} />}
      {loading && !goals ? (
        <Spinner />
      ) : !goals || goals.length === 0 ? (
        <Card><EmptyState icon="🏁" title="No goals yet" hint="Add a savings goal — Ikid projects your completion date and required monthly contribution." /></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {goals.map((g) => (
            <Card key={g.id}>
              <div className="mb-2 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{g.icon}</span>
                  <div>
                    <div className="font-semibold">{g.name}</div>
                    <div className="text-xs text-slate-500">
                      {fmtMoney(g.currentSaved)} of {fmtMoney(g.targetAmount)} · {fmtMoney(g.monthlyContribution)}/mo
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => setEditing(g)}>Edit</button>
                  <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => remove(g.id)}>✕</button>
                </div>
              </div>
              <ProgressBar pct={g.progressPct} color={c.series[0]} />
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <div className="text-slate-500">Progress</div>
                  <div className="font-semibold">{g.progressPct}%</div>
                </div>
                <div>
                  <div className="text-slate-500">Est. completion</div>
                  <div className="font-semibold">{g.estimatedCompletion ? fmtMonth(g.estimatedCompletion) : "—"}</div>
                </div>
                <div>
                  <div className="text-slate-500">{g.deadline ? "Needed/mo for deadline" : "Months left"}</div>
                  <div className="font-semibold">
                    {g.deadline
                      ? g.requiredMonthly != null ? fmtMoney(g.requiredMonthly) : "—"
                      : g.monthsRemaining ?? "—"}
                  </div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={110}>
                <AreaChart data={g.projection} margin={{ top: 10, left: 0, right: 0 }}>
                  <defs>
                    <linearGradient id={`g${g.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c.series[0]} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={c.series[0]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                  <XAxis dataKey="month" tickFormatter={fmtMonth} fontSize={10} interval="preserveStartEnd" />
                  <YAxis hide domain={[0, g.targetAmount * 1.05]} />
                  <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(m) => fmtMonth(String(m))} />
                  <Area type="monotone" dataKey="balance" stroke={c.series[0]} fill={`url(#g${g.id})`} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <GoalForm
          goal={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function GoalForm({ goal, onClose, onSaved }: { goal: GoalDTO | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(goal?.name ?? "");
  const [icon, setIcon] = useState(goal?.icon ?? "🎯");
  const [target, setTarget] = useState(String(goal?.targetAmount ?? 10000));
  const [saved, setSaved] = useState(String(goal?.currentSaved ?? 0));
  const [monthly, setMonthly] = useState(String(goal?.monthlyContribution ?? 250));
  const [deadline, setDeadline] = useState(goal?.deadline ?? "");
  const [error, setError] = useState<string | null>(null);
  const [whatIf, setWhatIf] = useState<{ estimatedCompletion: string | null; monthsRemaining: number | null } | null>(null);

  // "What if?" live preview as numbers change
  useEffect(() => {
    const t = setTimeout(() => {
      const body = {
        targetAmount: Number(target) || 0,
        currentSaved: Number(saved) || 0,
        monthlyContribution: Number(monthly) || 0,
        deadline: deadline || null,
      };
      if (body.targetAmount > 0) {
        api.post<{ estimatedCompletion: string | null; monthsRemaining: number | null }>("/api/goals/what-if", body)
          .then(setWhatIf)
          .catch(() => setWhatIf(null));
      }
    }, 300);
    return () => clearTimeout(t);
  }, [target, saved, monthly, deadline]);

  async function save() {
    setError(null);
    const body = {
      name: name.trim(),
      icon,
      targetAmount: Number(target),
      currentSaved: Number(saved),
      monthlyContribution: Number(monthly),
      deadline: deadline || null,
    };
    try {
      if (goal) await api.patch(`/api/goals/${goal.id}`, body);
      else await api.post("/api/goals", body);
      onSaved();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Modal title={goal ? "Edit goal" : "New goal"} onClose={onClose}>
      <div className="space-y-3">
        {error && <ErrorNote message={error} />}
        <div className="grid grid-cols-4 gap-2">
          <div>
            <label className="label">Icon</label>
            <input className="input w-full" value={icon} onChange={(e) => setIcon(e.target.value)} />
          </div>
          <div className="col-span-3">
            <label className="label">Name</label>
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="House Down Payment" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label">Target ($)</label>
            <input type="number" className="input w-full" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div>
            <label className="label">Saved so far ($)</label>
            <input type="number" className="input w-full" value={saved} onChange={(e) => setSaved(e.target.value)} />
          </div>
          <div>
            <label className="label">Monthly ($)</label>
            <input type="number" className="input w-full" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Deadline (optional)</label>
          <input type="date" className="input w-full" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        {whatIf && (
          <div className="rounded-lg bg-brand-50 p-3 text-sm text-brand-800 dark:bg-brand-900/20 dark:text-brand-200">
            What if? At {fmtMoney(Number(monthly) || 0)}/month you'd finish{" "}
            {whatIf.estimatedCompletion ? <b>{fmtMonth(whatIf.estimatedCompletion)}</b> : "—"}
            {whatIf.monthsRemaining != null && <> ({whatIf.monthsRemaining} months)</>}.
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!name.trim() || !Number(target)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
