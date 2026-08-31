import { useState } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import type { AssetDTO, AssetKind, NetWorthPoint, NetWorthSummary } from "@shared/types";
import { api } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { fmtMoney, fmtMonth } from "../lib/format";
import { Card, EmptyState, ErrorNote, Modal, Spinner, StatCard } from "../components/ui";
import { legendLabel, useChartColors } from "../lib/chartColors";

const ASSET_KINDS: { value: AssetKind; label: string }[] = [
  { value: "cash", label: "💵 Cash / bank" },
  { value: "investment", label: "📈 Investment" },
  { value: "property", label: "🏠 Property" },
  { value: "vehicle", label: "🚗 Vehicle" },
  { value: "other", label: "💰 Other asset" },
];
const LIABILITY_KINDS: { value: AssetKind; label: string }[] = [
  { value: "mortgage", label: "🏦 Mortgage" },
  { value: "loan", label: "📄 Loan" },
  { value: "credit", label: "💳 Credit card" },
];
const KIND_LABEL: Record<string, string> = Object.fromEntries(
  [...ASSET_KINDS, ...LIABILITY_KINDS].map((k) => [k.value, k.label.replace(/^\S+\s/, "")]),
);

export default function NetWorth() {
  const c = useChartColors();
  const { data: sum, loading, error, refresh } = useFetch<NetWorthSummary>("/api/networth/summary");
  const { data: hist, refresh: refreshHist } = useFetch<NetWorthPoint[]>("/api/networth/history?months=24");
  const [adding, setAdding] = useState<"asset" | "liability" | null>(null);
  const [editing, setEditing] = useState<AssetDTO | null>(null);
  const [updating, setUpdating] = useState<AssetDTO | null>(null);

  const refreshAll = () => { refresh(); refreshHist(); };

  if (loading && !sum) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!sum) return null;

  const assets = sum.assets.filter((a) => !a.isLiability);
  const liabilities = sum.assets.filter((a) => a.isLiability);
  const prev = hist && hist.length >= 2 ? hist[hist.length - 2] : null;
  const change = prev ? sum.netWorth - prev.netWorth : null;

  async function remove(a: AssetDTO) {
    if (!confirm(`Delete "${a.name}" and its entire value history?`)) return;
    await api.delete(`/api/networth/assets/${a.id}`);
    refreshAll();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">Net Worth</h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setAdding("liability")}>+ Liability</button>
          <button className="btn-primary" onClick={() => setAdding("asset")}>+ Asset</button>
        </div>
      </div>

      {sum.assets.length === 0 ? (
        <Card>
          <EmptyState
            icon="💎"
            title="Track what you own and what you owe"
            hint="Add your accounts, investments, property, and loans. Update values whenever you like — Ikid keeps the history and charts your net worth over time."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Net worth"
              value={fmtMoney(sum.netWorth)}
              tone={sum.netWorth >= 0 ? "good" : "bad"}
              sub={change != null ? `${change >= 0 ? "+" : ""}${fmtMoney(change)} vs last month` : undefined}
            />
            <StatCard label="Assets" value={fmtMoney(sum.totalAssets)} sub={`${assets.length} item${assets.length === 1 ? "" : "s"}`} />
            <StatCard label="Liabilities" value={fmtMoney(sum.totalLiabilities)} sub={`${liabilities.length} item${liabilities.length === 1 ? "" : "s"}`} tone={sum.totalLiabilities > 0 ? "bad" : "default"} />
            <StatCard
              label="Debt ratio"
              value={sum.totalAssets > 0 ? `${Math.round((sum.totalLiabilities / sum.totalAssets) * 100)}%` : "—"}
              sub="liabilities ÷ assets"
            />
          </div>

          {hist && hist.length > 1 && (
            <Card title="Net worth over time">
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={hist}>
                  <defs>
                    <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c.series[0]} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={c.series[0]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                  <XAxis dataKey="month" tickFormatter={fmtMonth} fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={80} />
                  <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(m) => fmtMonth(String(m))} />
                  <Legend formatter={legendLabel} />
                  <Bar dataKey="assets" name="Assets" fill={c.in} fillOpacity={0.55} barSize={14} />
                  <Bar dataKey="liabilities" name="Liabilities" fill={c.out} fillOpacity={0.55} barSize={14} />
                  <Area type="monotone" dataKey="netWorth" name="Net worth" stroke="none" fill="url(#nwFill)" />
                  <Line type="monotone" dataKey="netWorth" name="Net worth" stroke={c.series[0]} strokeWidth={2.5} dot={false} legendType="none" />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>
          )}

          <AssetTable
            title={`Assets — ${fmtMoney(sum.totalAssets)}`}
            items={assets}
            onUpdate={setUpdating}
            onEdit={setEditing}
            onDelete={remove}
          />
          <AssetTable
            title={`Liabilities — ${fmtMoney(sum.totalLiabilities)}`}
            items={liabilities}
            onUpdate={setUpdating}
            onEdit={setEditing}
            onDelete={remove}
          />
        </>
      )}

      {(adding || editing) && (
        <AssetForm
          asset={editing}
          side={adding ?? (editing!.isLiability ? "liability" : "asset")}
          onClose={() => { setAdding(null); setEditing(null); }}
          onSaved={() => { setAdding(null); setEditing(null); refreshAll(); }}
        />
      )}
      {updating && (
        <SnapshotForm
          asset={updating}
          onClose={() => setUpdating(null)}
          onSaved={() => { setUpdating(null); refreshAll(); }}
        />
      )}
    </div>
  );
}

function ChangeChip({ a }: { a: AssetDTO }) {
  if (a.previousValue == null || a.previousValue === a.value) return null;
  const diff = a.value - a.previousValue;
  // For liabilities, a falling balance is good news.
  const good = a.isLiability ? diff < 0 : diff > 0;
  return (
    <span className={`text-xs tabular-nums ${good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
      {diff > 0 ? "▲" : "▼"} {fmtMoney(Math.abs(diff))}
    </span>
  );
}

function AssetTable({ title, items, onUpdate, onEdit, onDelete }: {
  title: string;
  items: AssetDTO[];
  onUpdate: (a: AssetDTO) => void;
  onEdit: (a: AssetDTO) => void;
  onDelete: (a: AssetDTO) => void;
}) {
  if (items.length === 0) return null;
  return (
    <Card title={title}>
      <div className="overflow-x-auto">
        {/* Scrolls sideways rather than squashing. On a phone these columns are
            wider than the screen, and a table that drags the whole page into
            horizontal scrolling is the worse of the two failures. */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left dark:border-slate-800">
              <th className="th">Name</th>
              <th className="th">Type</th>
              <th className="th text-right">Value</th>
              <th className="th text-right">Change</th>
              <th className="th">Details</th>
              <th className="th">Updated</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((a) => (
              <tr key={a.id}>
                <td className="td font-medium">{a.icon} {a.name}</td>
                <td className="td text-slate-500">{KIND_LABEL[a.kind] ?? a.kind}</td>
                <td className="td text-right font-semibold tabular-nums">{fmtMoney(a.value)}</td>
                <td className="td text-right"><ChangeChip a={a} /></td>
                <td className="td text-xs text-slate-500">
                  {a.units != null && a.unitPrice != null && (
                    <span>{a.units} × {fmtMoney(a.unitPrice)}</span>
                  )}
                  {a.payoff && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      title={`Total interest remaining: ${fmtMoney(a.payoff.totalInterest)}`}>
                      paid off {fmtMonth(a.payoff.payoffDate)} · {a.payoff.months} mo
                    </span>
                  )}
                  {a.isLiability && !a.payoff && a.ratePct != null && a.monthlyPayment != null && (
                    <span className="text-rose-500 dark:text-rose-400" title="Payment doesn't cover monthly interest">
                      payment too low
                    </span>
                  )}
                </td>
                <td className="td text-xs text-slate-400">{a.updatedAt}</td>
                <td className="td text-right whitespace-nowrap">
                  <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => onUpdate(a)}>Update value</button>
                  <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => onEdit(a)}>Edit</button>
                  <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => onDelete(a)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SnapshotForm({ asset, onClose, onSaved }: {
  asset: AssetDTO; onClose: () => void; onSaved: () => void;
}) {
  const [value, setValue] = useState(String(asset.value));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [units, setUnits] = useState(asset.units != null ? String(asset.units) : "");
  const [unitPrice, setUnitPrice] = useState(asset.unitPrice != null ? String(asset.unitPrice) : "");
  const hasUnits = asset.units != null && asset.unitPrice != null;

  async function save() {
    setError(null);
    try {
      if (hasUnits) {
        const u = Number(units) || 0;
        const p = Number(unitPrice) || 0;
        await api.patch(`/api/networth/assets/${asset.id}`, { units: u || null, unitPrice: p || null });
        await api.post(`/api/networth/assets/${asset.id}/snapshot`, { value: Math.round(u * p * 100) / 100, date });
      } else {
        await api.post(`/api/networth/assets/${asset.id}/snapshot`, { value: Number(value) || 0, date });
      }
      onSaved();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Modal title={`Update ${asset.icon} ${asset.name}`} onClose={onClose}>
      <div className="space-y-3">
        {error && <ErrorNote message={error} />}
        {hasUnits ? (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Units / shares</label>
              <input type="number" step="any" className="input w-full" value={units} onChange={(e) => setUnits(e.target.value)} />
            </div>
            <div>
              <label className="label">Price per unit ($)</label>
              <input type="number" step="any" className="input w-full" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </div>
            <div className="col-span-2 text-sm text-slate-500">
              New value: <b className="tabular-nums">{fmtMoney((Number(units) || 0) * (Number(unitPrice) || 0))}</b>
            </div>
          </div>
        ) : (
          <div>
            <label className="label">{asset.isLiability ? "Current balance owed ($)" : "Current value ($)"}</label>
            <input type="number" step="any" className="input w-full" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        )}
        <div>
          <label className="label">As of date</label>
          <input type="date" className="input w-full" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="mt-1 text-xs text-slate-400">Back-date to fill in history. One value per day — same-day updates replace.</div>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function AssetForm({ asset, side, onClose, onSaved }: {
  asset: AssetDTO | null;
  side: "asset" | "liability";
  onClose: () => void;
  onSaved: () => void;
}) {
  const kinds = side === "liability" ? LIABILITY_KINDS : ASSET_KINDS;
  const [name, setName] = useState(asset?.name ?? "");
  const [kind, setKind] = useState<AssetKind>(asset?.kind ?? kinds[0].value);
  const [value, setValue] = useState(asset ? String(asset.value) : "");
  const [icon, setIcon] = useState(asset?.icon ?? "");
  const [units, setUnits] = useState(asset?.units != null ? String(asset.units) : "");
  const [unitPrice, setUnitPrice] = useState(asset?.unitPrice != null ? String(asset.unitPrice) : "");
  const [ratePct, setRatePct] = useState(asset?.ratePct != null ? String(asset.ratePct) : "");
  const [monthlyPayment, setMonthlyPayment] = useState(asset?.monthlyPayment != null ? String(asset.monthlyPayment) : "");
  const [notes, setNotes] = useState(asset?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const isLiability = side === "liability";
  const showUnits = kind === "investment";
  const showLoan = isLiability;
  const unitsValue = (Number(units) || 0) * (Number(unitPrice) || 0);

  async function save() {
    setError(null);
    const body: any = {
      name: name.trim(),
      kind,
      icon: icon.trim() || undefined,
      units: showUnits && Number(units) > 0 ? Number(units) : null,
      unitPrice: showUnits && Number(unitPrice) >= 0 && units ? Number(unitPrice) : null,
      ratePct: showLoan && ratePct !== "" ? Number(ratePct) : null,
      monthlyPayment: showLoan && monthlyPayment !== "" ? Number(monthlyPayment) : null,
      notes: notes.trim() || null,
    };
    try {
      if (asset) {
        await api.patch(`/api/networth/assets/${asset.id}`, body);
      } else {
        body.value = showUnits && unitsValue > 0 ? Math.round(unitsValue * 100) / 100 : Number(value) || 0;
        await api.post("/api/networth/assets", body);
      }
      onSaved();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Modal title={asset ? `Edit ${asset.name}` : isLiability ? "New liability" : "New asset"} onClose={onClose}>
      <div className="space-y-3">
        {error && <ErrorNote message={error} />}
        <div className="grid grid-cols-4 gap-2">
          <div>
            <label className="label">Icon</label>
            <input className="input w-full" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="auto" />
          </div>
          <div className="col-span-3">
            <label className="label">Name</label>
            <input className="input w-full" autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder={isLiability ? "Home mortgage" : "Brokerage account"} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Type</label>
            <select className="input w-full" value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
              {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          {!asset && !showUnits && (
            <div>
              <label className="label">{isLiability ? "Balance owed ($)" : "Current value ($)"}</label>
              <input type="number" step="any" className="input w-full" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          )}
        </div>

        {showUnits && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Units / shares (optional)</label>
              <input type="number" step="any" className="input w-full" value={units} onChange={(e) => setUnits(e.target.value)} />
            </div>
            <div>
              <label className="label">Price per unit ($)</label>
              <input type="number" step="any" className="input w-full" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </div>
            {!asset && (
              <div className="col-span-2">
                {unitsValue > 0 ? (
                  <div className="text-sm text-slate-500">Starting value: <b className="tabular-nums">{fmtMoney(unitsValue)}</b></div>
                ) : (
                  <>
                    <label className="label">Or starting value ($)</label>
                    <input type="number" step="any" className="input w-full" value={value} onChange={(e) => setValue(e.target.value)} />
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {showLoan && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Interest rate % (optional)</label>
              <input type="number" step="any" className="input w-full" value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="6.5" />
            </div>
            <div>
              <label className="label">Monthly payment ($)</label>
              <input type="number" step="any" className="input w-full" value={monthlyPayment} onChange={(e) => setMonthlyPayment(e.target.value)} placeholder="2022" />
            </div>
            <div className="col-span-2 text-xs text-slate-400">
              With rate + payment, Ikid shows the projected payoff date and remaining interest.
            </div>
          </div>
        )}

        <div>
          <label className="label">Notes (optional)</label>
          <input className="input w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!name.trim()}>
            {asset ? "Save changes" : "Add"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
