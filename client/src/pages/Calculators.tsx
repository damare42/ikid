import { useEffect, useState } from "react";
import {
  Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { CalcKind, SavedCalcDTO } from "@shared/types";
import { api } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { fmtMoney, fmtMonth } from "../lib/format";
import { Card, ErrorNote, StatCard } from "../components/ui";
import { legendLabel, useChartColors } from "../lib/chartColors";

/** Deterministic calculators backed by the server's tested finmath engine. */

interface AmortYear {
  year: number;
  principalPaid: number;
  interestPaid: number;
  balance: number;
}
interface AmortResult {
  monthlyPayment: number;
  months: number;
  payoffDate: string;
  totalInterest: number;
  totalPaid: number;
  interestSavedByExtra: number;
  monthsSavedByExtra: number;
  yearly: AmortYear[];
}
interface CompoundResult {
  finalBalance: number;
  totalContributed: number;
  totalInterest: number;
  series: { year: number; balance: number; contributed: number; interest: number }[];
}
interface FireResult {
  fireNumber: number;
  swrPct: number;
  alreadyFire: boolean;
  achievable: boolean;
  fireAge: number | null;
  monthsToFire: number | null;
  fireDate: string | null;
  balanceAtFire: number | null;
  series: { age: number; balance: number; contributed: number }[];
}
interface CoastResult {
  fireNumber: number;
  coastNumber: number;
  swrPct: number;
  alreadyCoasting: boolean;
  surplus: number;
  coastAge: number | null;
  coastDate: string | null;
  monthsToCoast: number | null;
  balanceAtRetirement: number;
  series: { age: number; balance: number; coastNumber: number }[];
}

interface DebtRow { name: string; balance: number; ratePct: number; minPayment: number }
interface PayoffPlanDTO {
  strategy: "avalanche" | "snowball";
  feasible: boolean;
  problem?: string;
  months: number;
  payoffDate: string;
  totalInterest: number;
  totalPaid: number;
  monthlyOutlay: number;
  focusOrder: string[];
  debts: { name: string; order: number; monthsToPayoff: number; payoffDate: string; interestPaid: number; totalPaid: number }[];
  schedule: { month: number; remaining: number; interest: number; principal: number }[];
}
interface ComparisonDTO {
  avalanche: PayoffPlanDTO;
  snowball: PayoffPlanDTO;
  cheaper: "avalanche" | "snowball";
  interestSaved: number;
  monthsSaved: number;
  advice: string[];
}

const TABS = [
  { id: "amortization", label: "🏠 Loan / Amortization" },
  { id: "debt", label: "🏔️ Debt payoff" },
  { id: "compound", label: "📈 Compound Interest" },
  { id: "fire", label: "🔥 FIRE" },
  { id: "coast", label: "🏖️ Coast FIRE" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const KIND_EMOJI: Record<CalcKind, string> = {
  amortization: "🏠", compound: "📈", fire: "🔥", coast: "🏖️", retirement: "🧭",
};

interface CalcProps {
  initial: Record<string, number> | null;
  onSave: (inputs: Record<string, number>, defaultName: string) => void;
}

/** Initial input value: loaded-from-history number, or the tab's default. */
const init = (o: Record<string, number> | null, k: string, fallback: string) =>
  o && o[k] != null ? String(o[k]) : fallback;

export default function Calculators() {
  const [tab, setTab] = useState<Tab>("amortization");
  const { data: allSaved, refresh } = useFetch<SavedCalcDTO[]>("/api/calc/saved");
  // Retirement plans have their own panel on the Retirement page.
  const saved = allSaved?.filter((c) => c.kind !== "retirement");
  const [initial, setInitial] = useState<Record<string, number> | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  function switchTab(t: Tab) {
    setTab(t);
    setInitial(null);
    setLoadKey((k) => k + 1);
  }

  function loadSaved(c: SavedCalcDTO) {
    if (c.kind === "retirement") return; // lives on the Retirement page
    setTab(c.kind);
    setInitial(c.inputs);
    setLoadKey((k) => k + 1);
  }

  const onSave = (kind: Tab) => async (inputs: Record<string, number>, defaultName: string) => {
    const name = prompt("Name this calculation:", defaultName);
    if (!name?.trim()) return;
    setSaveError(null);
    try {
      await api.post("/api/calc/saved", { kind, name: name.trim().slice(0, 80), inputs });
      refresh();
    } catch (e: any) {
      setSaveError(e.message);
    }
  };

  async function removeSaved(id: number) {
    try {
      await api.delete(`/api/calc/saved/${id}`);
      refresh();
    } catch (e: any) {
      setSaveError(e.message);
    }
  }

  const key = `${tab}-${loadKey}`;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="font-heading text-2xl font-extrabold tracking-tight">Calculators</h1>
      {saveError && <ErrorNote message={saveError} />}
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex w-fit flex-wrap gap-1 rounded-chrome bg-slate-100 p-1 dark:bg-slate-800">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "bg-white shadow text-slate-900 dark:bg-slate-700 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
                onClick={() => switchTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === "amortization" && <Amortization key={key} initial={initial} onSave={onSave("amortization")} />}
          {tab === "debt" && <DebtPayoff key={key} />}
          {tab === "compound" && <Compound key={key} initial={initial} onSave={onSave("compound")} />}
          {tab === "fire" && <Fire key={key} initial={initial} onSave={onSave("fire")} />}
          {tab === "coast" && <Coast key={key} initial={initial} onSave={onSave("coast")} />}
        </div>

        <aside className="w-full shrink-0 lg:w-64">
          <Card title="📁 Saved calculations">
            {!saved || saved.length === 0 ? (
              <div className="text-xs text-slate-400">
                Nothing saved yet — set up a calculation and hit <b>💾 Save</b> to keep it here.
              </div>
            ) : (
              <ul className="space-y-1">
                {saved.map((c) => (
                  <li key={c.id} className="group flex items-center gap-1">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                      onClick={() => loadSaved(c)}
                      title={`Load into the ${c.kind} calculator`}
                    >
                      <span>{KIND_EMOJI[c.kind] ?? "🧮"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block text-[12px] text-slate-400">{c.createdAt}</span>
                      </span>
                    </button>
                    <button
                      className="btn-ghost !px-1.5 !py-0.5 text-xs opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => removeSaved(c.id)}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function SaveButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      className="btn-ghost !px-2 !py-1 text-xs disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      title="Save this calculation to the history panel"
    >
      💾 Save
    </button>
  );
}

function NumField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step="any"
        className="input w-full"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Debounced POST that keeps the last good result while typing. */
function useCalc<T>(url: string, body: Record<string, number> | null) {
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!body) return;
    const t = setTimeout(() => {
      api.post<T>(url, body)
        .then((r) => { setResult(r); setError(null); })
        .catch((e: any) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [url, JSON.stringify(body)]);
  return { result, error };
}

function Amortization({ initial, onSave }: CalcProps) {
  const c = useChartColors();
  const [principal, setPrincipal] = useState(init(initial, "principal", "320000"));
  const [ratePct, setRatePct] = useState(init(initial, "ratePct", "6.5"));
  const [years, setYears] = useState(init(initial, "years", "30"));
  const [extra, setExtra] = useState(init(initial, "extraMonthly", "0"));

  const p = Number(principal);
  const r = Number(ratePct);
  const y = Number(years);
  const x = Number(extra) || 0;
  const valid = p > 0 && r >= 0 && r <= 50 && y >= 0.5 && y <= 50;

  const { result, error } = useCalc<AmortResult>(
    "/api/calc/amortization",
    valid ? { principal: p, ratePct: r, years: y, extraMonthly: x } : null,
  );

  return (
    <div className="space-y-4">
      <Card
        title="Loan details"
        action={
          <SaveButton
            disabled={!valid}
            onClick={() =>
              onSave(
                { principal: p, ratePct: r, years: y, extraMonthly: x },
                `${fmtMoney(p)} loan @ ${r}% · ${y}y${x > 0 ? ` +${fmtMoney(x)}/mo` : ""}`,
              )
            }
          />
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumField label="Loan amount ($)" value={principal} onChange={setPrincipal} />
          <NumField label="Interest rate (%)" value={ratePct} onChange={setRatePct} />
          <NumField label="Term (years)" value={years} onChange={setYears} />
          <NumField label="Extra payment ($/mo)" value={extra} onChange={setExtra} placeholder="0" />
        </div>
        {!valid && <div className="mt-2 text-xs text-slate-400">Enter a loan amount, rate (0–50%), and term (0.5–50 years).</div>}
        {error && <div className="mt-2"><ErrorNote message={error} /></div>}
      </Card>

      {result && valid && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Monthly payment" value={fmtMoney(result.monthlyPayment)} sub={x > 0 ? `+ ${fmtMoney(x)} extra` : undefined} />
            <StatCard label="Paid off" value={fmtMonth(result.payoffDate)} sub={`${result.months} months`} />
            <StatCard label="Total interest" value={fmtMoney(result.totalInterest)} tone="bad" />
            <StatCard
              label={x > 0 ? "Saved by extra payments" : "Total paid"}
              value={x > 0 ? fmtMoney(result.interestSavedByExtra) : fmtMoney(result.totalPaid)}
              tone={x > 0 ? "good" : "default"}
              sub={x > 0 ? `${result.monthsSavedByExtra} months sooner` : undefined}
            />
          </div>

          <Card title="Principal vs interest by year">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={result.yearly}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="year" fontSize={11} tickFormatter={(v) => `Yr ${v}`} />
                <YAxis yAxisId="pay" fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={80} />
                <YAxis yAxisId="bal" orientation="right" fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={80} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(y) => `Year ${y}`} />
                <Legend formatter={legendLabel} />
                {/* Categorical, not semantic. This used to be green principal
                    on crimson interest, which read as "good money / bad money"
                    — but both bars are cash leaving your account on the same
                    day. The only true difference is where it lands: principal
                    becomes equity you own, interest is the lender's fee. Two
                    neutral hues say "these are different" without pretending
                    one of them is income. */}
                <Bar yAxisId="pay" dataKey="principalPaid" name="Principal" stackId="a" fill={c.series[0]} />
                <Bar yAxisId="pay" dataKey="interestPaid" name="Interest" stackId="a" fill={c.series[1]} />
                {/* The outstanding balance is the backdrop the split happens
                    against, so it takes the receding comparator colour rather
                    than a third categorical slot. */}
                <Line yAxisId="bal" type="monotone" dataKey="balance" name="Balance" stroke={c.muted} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-2 text-xs text-slate-400">
              Both bars are money leaving your account — the split is how much of it you keep.
              Early years are mostly interest, so extra principal payments hit hardest at the start.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * 🏔️ Debt payoff — snowball vs avalanche across all your debts at once.
 * Prefills from Net Worth liabilities and credit/loan accounts.
 */
function DebtPayoff() {
  const c = useChartColors();
  const [rows, setRows] = useState<DebtRow[]>([
    { name: "Card 1", balance: 3000, ratePct: 24.99, minPayment: 90 },
    { name: "Card 2", balance: 800, ratePct: 19.99, minPayment: 35 },
  ]);
  const [extra, setExtra] = useState("200");
  const [result, setResult] = useState<ComparisonDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [strategy, setStrategy] = useState<"avalanche" | "snowball">("avalanche");

  // Offer the user's real debts once.
  useEffect(() => {
    api.get<{ debts: (DebtRow & { source: string })[] }>("/api/calc/debt-plan/prefill")
      .then((r) => {
        if (r.debts.length > 0) {
          setRows(r.debts.map(({ name, balance, ratePct, minPayment }) => ({
            name, balance,
            // Sensible starting guesses when we don't know the terms.
            ratePct: ratePct || 22.99,
            minPayment: minPayment || Math.max(25, Math.round(balance * 0.02)),
          })));
          setPrefilled(true);
        }
      })
      .catch(() => {});
  }, []);

  const valid = rows.length > 0 && rows.every((r) => r.name.trim() && r.balance > 0);

  useEffect(() => {
    if (!valid) return;
    const t = setTimeout(() => {
      api.post<ComparisonDTO>("/api/calc/debt-plan", { debts: rows, extraMonthly: Number(extra) || 0 })
        .then((r) => { setResult(r); setError(null); })
        .catch((e: any) => setError(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [JSON.stringify(rows), extra, valid]);

  function update(i: number, patch: Partial<DebtRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  const totalOwed = rows.reduce((s, r) => s + (r.balance || 0), 0);
  const plan = result ? result[strategy] : null;

  return (
    <div className="space-y-4">
      <Card title="Your debts">
        {prefilled && (
          <p className="mb-2 text-xs text-slate-500">
            Prefilled from your accounts and liabilities. Check the rates and minimum payments —
            we can't read those from a statement, so they're estimates until you set them.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                <th className="th">Debt</th>
                <th className="th text-right">Balance</th>
                <th className="th text-right">Rate %</th>
                <th className="th text-right">Min / mo</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="td"><input className="input !py-1 w-36" value={r.name} onChange={(e) => update(i, { name: e.target.value })} /></td>
                  <td className="td text-right"><input type="number" step="any" className="input !py-1 w-28 text-right" value={r.balance} onChange={(e) => update(i, { balance: Number(e.target.value) })} /></td>
                  <td className="td text-right"><input type="number" step="any" className="input !py-1 w-20 text-right" value={r.ratePct} onChange={(e) => update(i, { ratePct: Number(e.target.value) })} /></td>
                  <td className="td text-right"><input type="number" step="any" className="input !py-1 w-24 text-right" value={r.minPayment} onChange={(e) => update(i, { minPayment: Number(e.target.value) })} /></td>
                  <td className="td text-right">
                    <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <button className="btn-ghost !py-1 text-xs" onClick={() => setRows((rs) => [...rs, { name: `Debt ${rs.length + 1}`, balance: 1000, ratePct: 19.99, minPayment: 30 }])}>
            + Add debt
          </button>
          <div>
            <label className="label">Extra $/month (beyond minimums)</label>
            <input type="number" step="any" className="input w-40" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>
          <div className="ml-auto text-sm text-slate-500">
            Total owed <b className="tabular-nums text-slate-900 dark:text-slate-100">{fmtMoney(totalOwed)}</b>
          </div>
        </div>
        {error && <div className="mt-2"><ErrorNote message={error} /></div>}
      </Card>

      {result && plan && (
        <>
          {!plan.feasible ? (
            <ErrorNote message={plan.problem ?? "This plan can't pay the debts off."} />
          ) : (
            <>
              <div className="flex w-fit gap-1 bg-slate-100 p-1 dark:bg-slate-800">
                {(["avalanche", "snowball"] as const).map((s) => (
                  <button
                    key={s}
                    className={`px-4 py-1.5 text-sm font-semibold capitalize ${
                      strategy === s ? "bg-white shadow dark:bg-slate-700" : "text-slate-500"
                    }`}
                    onClick={() => setStrategy(s)}
                  >
                    {s === "avalanche" ? "🏔️ Avalanche (highest rate)" : "❄️ Snowball (smallest first)"}
                    {result.cheaper === s && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">✓ cheaper</span>}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Debt-free" value={fmtMonth(plan.payoffDate)} sub={`${plan.months} months`} tone="good" />
                <StatCard label="Total interest" value={fmtMoney(plan.totalInterest)} tone="bad" />
                <StatCard label="Monthly outlay" value={fmtMoney(plan.monthlyOutlay)} sub="minimums + extra" />
                <StatCard
                  label={`vs ${strategy === "avalanche" ? "snowball" : "avalanche"}`}
                  value={result.interestSaved === 0 ? "same" : `${result.cheaper === strategy ? "−" : "+"}${fmtMoney(result.interestSaved)}`}
                  sub={result.monthsSaved ? `${result.monthsSaved} mo difference` : "same finish date"}
                  tone={result.cheaper === strategy ? "good" : "default"}
                />
              </div>

              <Card title="Where your spare money goes, in order">
                <ol className="space-y-1.5 text-sm">
                  {plan.focusOrder.map((name, i) => {
                    const d = plan.debts.find((x) => x.name === name);
                    return (
                      <li key={name} className="flex items-center gap-3">
                        <span className={`grid h-6 w-6 place-items-center text-xs font-bold ${i === 0 ? "bg-brand-600 text-white" : "bg-slate-200 dark:bg-slate-700"}`}>{i + 1}</span>
                        <span className="font-medium">{name}</span>
                        {i === 0 && <span className="text-xs font-semibold text-brand-700 dark:text-brand-400">← attack this one</span>}
                        {d && <span className="ml-auto text-xs text-slate-500">clear by {fmtMonth(d.payoffDate)} · {fmtMoney(d.interestPaid)} interest</span>}
                      </li>
                    );
                  })}
                </ol>
                <p className="mt-3 text-xs text-slate-400">
                  Keep paying every minimum. Everything spare goes to #1 until it's gone, then rolls to #2 —
                  which is why the last debts fall fastest.
                </p>
              </Card>

              <Card title="Balance over time">
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={plan.schedule}>
                    <defs>
                      {/* Crimson is right here and stays: a debt balance is
                          money owed, the same thing liabilities mean on Net
                          Worth. Semantic use, not decoration. */}
                      <linearGradient id="debtFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={c.out} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={c.out} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                    <XAxis dataKey="month" fontSize={11} tickFormatter={(m) => `m${m}`} />
                    <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={80} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(m) => `Month ${m}`} />
                    <Area type="monotone" dataKey="remaining" name="Still owed" stroke={c.out} fill="url(#debtFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <Card title="📋 What this means">
                <ul className="space-y-2 text-sm">
                  {result.advice.map((a, i) => (
                    <li key={i} className="flex gap-2"><span className="text-brand-600">▸</span><span>{a}</span></li>
                  ))}
                </ul>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Fire({ initial, onSave }: CalcProps) {
  const c = useChartColors();
  const [age, setAge] = useState(init(initial, "currentAge", "30"));
  const [balance, setBalance] = useState(init(initial, "currentBalance", "50000"));
  const [monthly, setMonthly] = useState(init(initial, "monthlyContribution", "1500"));
  const [spending, setSpending] = useState(init(initial, "annualSpending", "40000"));
  const [ratePct, setRatePct] = useState(init(initial, "ratePct", "5"));
  const [swrPct, setSwrPct] = useState(init(initial, "swrPct", "4"));

  const a = Number(age);
  const b = Number(balance) || 0;
  const m = Number(monthly) || 0;
  const s = Number(spending);
  const r = Number(ratePct);
  const w = Number(swrPct);
  const valid = a >= 10 && a <= 90 && s > 0 && r >= 0 && r <= 50 && w >= 1 && w <= 20;

  const { result, error } = useCalc<FireResult>(
    "/api/calc/fire",
    valid ? { currentAge: a, currentBalance: b, monthlyContribution: m, annualSpending: s, ratePct: r, swrPct: w } : null,
  );

  return (
    <div className="space-y-4">
      <Card
        title="Your numbers"
        action={
          <SaveButton
            disabled={!valid}
            onClick={() =>
              onSave(
                { currentAge: a, currentBalance: b, monthlyContribution: m, annualSpending: s, ratePct: r, swrPct: w },
                `FIRE · ${fmtMoney(s)}/yr @ ${w}% SWR`,
              )
            }
          />
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <NumField label="Current age" value={age} onChange={setAge} />
          <NumField label="Invested so far ($)" value={balance} onChange={setBalance} />
          <NumField label="Monthly investing ($)" value={monthly} onChange={setMonthly} />
          <NumField label="Yearly spending in retirement ($)" value={spending} onChange={setSpending} />
          <NumField label="Real return (%, after inflation)" value={ratePct} onChange={setRatePct} />
          <NumField label="Safe withdrawal rate (%)" value={swrPct} onChange={setSwrPct} />
        </div>
        <div className="mt-2 text-xs text-slate-400">
          FIRE number = yearly spending ÷ withdrawal rate. Using a real (after-inflation) return keeps
          everything in today's dollars — 5% real ≈ 8% nominal. The classic 4% rule comes from the Trinity study.
        </div>
        {error && <div className="mt-2"><ErrorNote message={error} /></div>}
      </Card>

      {result && valid && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="FIRE number" value={fmtMoney(result.fireNumber)} sub={`${result.swrPct}% withdrawal rate`} />
            <StatCard
              label="FIRE age"
              value={result.alreadyFire ? "Now 🎉" : result.fireAge != null ? `${result.fireAge}` : "—"}
              tone={result.achievable ? "good" : "bad"}
              sub={result.alreadyFire ? "you're already there" : result.achievable ? undefined : "not reached by age 100"}
            />
            <StatCard
              label="Years away"
              value={result.monthsToFire != null ? `${Math.round((result.monthsToFire / 12) * 10) / 10}` : "—"}
              sub={result.fireDate ? fmtMonth(result.fireDate) : undefined}
            />
            <StatCard label="Retirement income" value={`${fmtMoney(Number(spending) / 12)}/mo`} sub="in today's dollars" />
          </div>

          <Card title="Path to your FIRE number">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={result.series}>
                <defs>
                  <linearGradient id="fireBal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.series[0]} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={c.series[0]} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="age" fontSize={11} tickFormatter={(v) => `${Math.round(v)}`} />
                <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={85} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(v) => `Age ${v}`} />
                <Legend formatter={legendLabel} />
                {/* The FIRE number is a target you are trying to reach. It was
                    drawn in the money-out crimson, which framed the goal as a
                    warning. Annotation colour instead. */}
                <ReferenceLine
                  y={result.fireNumber}
                  stroke={c.reference}
                  strokeDasharray="6 4"
                  label={{ value: "FIRE number", fill: c.reference, fontSize: 11, position: "insideTopRight" }}
                />
                <Area type="monotone" dataKey="balance" name="Portfolio" stroke={c.series[0]} fill="url(#fireBal)" strokeWidth={2} />
                <Area type="monotone" dataKey="contributed" name="Contributed" stroke={c.muted} fill="none" strokeWidth={1.5} strokeDasharray="4 3" />
              </AreaChart>
            </ResponsiveContainer>
            {!result.achievable && !result.alreadyFire && (
              <div className="mt-2 text-xs text-rose-500 dark:text-rose-400">
                At this pace the FIRE number isn't reached by age 100 — try a higher monthly contribution,
                lower retirement spending, or check the Coast FIRE tab for a longer-horizon plan.
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Coast({ initial, onSave }: CalcProps) {
  const c = useChartColors();
  const [age, setAge] = useState(init(initial, "currentAge", "30"));
  const [retireAge, setRetireAge] = useState(init(initial, "retireAge", "65"));
  const [balance, setBalance] = useState(init(initial, "currentBalance", "50000"));
  const [monthly, setMonthly] = useState(init(initial, "monthlyContribution", "1000"));
  const [spending, setSpending] = useState(init(initial, "annualSpending", "40000"));
  const [ratePct, setRatePct] = useState(init(initial, "ratePct", "5"));
  const [swrPct, setSwrPct] = useState(init(initial, "swrPct", "4"));

  const a = Number(age);
  const ra = Number(retireAge);
  const b = Number(balance) || 0;
  const m = Number(monthly) || 0;
  const s = Number(spending);
  const r = Number(ratePct);
  const w = Number(swrPct);
  const valid = a >= 10 && a <= 90 && ra > a && ra <= 100 && s > 0 && r >= 0 && r <= 50 && w >= 1 && w <= 20;

  const { result, error } = useCalc<CoastResult>(
    "/api/calc/coast",
    valid
      ? { currentAge: a, retireAge: ra, currentBalance: b, monthlyContribution: m, annualSpending: s, ratePct: r, swrPct: w }
      : null,
  );

  return (
    <div className="space-y-4">
      <Card
        title="Your numbers"
        action={
          <SaveButton
            disabled={!valid}
            onClick={() =>
              onSave(
                { currentAge: a, retireAge: ra, currentBalance: b, monthlyContribution: m, annualSpending: s, ratePct: r, swrPct: w },
                `Coast to ${ra} · ${fmtMoney(s)}/yr`,
              )
            }
          />
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumField label="Current age" value={age} onChange={setAge} />
          <NumField label="Retirement age" value={retireAge} onChange={setRetireAge} />
          <NumField label="Invested so far ($)" value={balance} onChange={setBalance} />
          <NumField label="Monthly investing ($)" value={monthly} onChange={setMonthly} />
          <NumField label="Yearly spending in retirement ($)" value={spending} onChange={setSpending} />
          <NumField label="Real return (%, after inflation)" value={ratePct} onChange={setRatePct} />
          <NumField label="Safe withdrawal rate (%)" value={swrPct} onChange={setSwrPct} />
        </div>
        <div className="mt-2 text-xs text-slate-400">
          Coast FIRE = the amount that grows to your FIRE number by retirement with <b>zero further
          contributions</b>. Reach it, and working only needs to cover your living costs.
        </div>
        {!valid && <div className="mt-2 text-xs text-slate-400">Retirement age must be after your current age.</div>}
        {error && <div className="mt-2"><ErrorNote message={error} /></div>}
      </Card>

      {result && valid && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Coast number (today)" value={fmtMoney(result.coastNumber)} sub={`grows to ${fmtMoney(result.fireNumber)} by ${ra}`} />
            <StatCard
              label={result.alreadyCoasting ? "Status" : "Gap"}
              value={result.alreadyCoasting ? "Coasting 🏖️" : fmtMoney(-result.surplus)}
              tone={result.alreadyCoasting ? "good" : "bad"}
              sub={result.alreadyCoasting ? `${fmtMoney(result.surplus)} ahead` : "still to invest"}
            />
            <StatCard
              label="Coast age"
              value={result.coastAge != null ? `${result.coastAge}` : "—"}
              sub={
                result.alreadyCoasting
                  ? "already reached"
                  : result.coastDate
                    ? `${fmtMonth(result.coastDate)} at ${fmtMoney(m)}/mo`
                    : `not reached by ${ra} at ${fmtMoney(m)}/mo`
              }
              tone={result.coastAge != null ? "good" : "bad"}
            />
            <StatCard
              label={`Balance at ${ra}`}
              value={fmtMoney(result.balanceAtRetirement)}
              sub={result.coastAge != null ? "contribute until coast, then stop" : "at current pace"}
              tone={result.balanceAtRetirement >= result.fireNumber ? "good" : "default"}
            />
          </div>

          <Card title="Portfolio vs the (rising) coast threshold">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={result.series}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="age" fontSize={11} tickFormatter={(v) => `${Math.round(v)}`} />
                <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={85} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(v) => `Age ${v}`} />
                <Legend formatter={legendLabel} />
                {result.coastAge != null && !result.alreadyCoasting && (
                  <ReferenceLine
                    x={result.series.reduce((best, pt) => (Math.abs(pt.age - result.coastAge!) < Math.abs(best - result.coastAge!) ? pt.age : best), result.series[0].age)}
                    stroke={c.reference}
                    strokeDasharray="6 4"
                    label={{ value: "coast!", fill: c.reference, fontSize: 11, position: "insideTopLeft" }}
                  />
                )}
                <Line type="monotone" dataKey="balance" name="Portfolio" stroke={c.series[0]} strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="coastNumber" name="Coast threshold" stroke={c.series[1]} strokeWidth={2} strokeDasharray="5 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-2 text-xs text-slate-400">
              Where the blue line crosses the amber one, you can stop contributing — compounding does the rest.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Compound({ initial, onSave }: CalcProps) {
  const c = useChartColors();
  const [principal, setPrincipal] = useState(init(initial, "principal", "10000"));
  const [monthly, setMonthly] = useState(init(initial, "monthly", "500"));
  const [ratePct, setRatePct] = useState(init(initial, "ratePct", "7"));
  const [years, setYears] = useState(init(initial, "years", "20"));

  const p = Number(principal) || 0;
  const m = Number(monthly) || 0;
  const r = Number(ratePct);
  const y = Number(years);
  const valid = p >= 0 && (p > 0 || m > 0) && r >= 0 && r <= 50 && y >= 1 && y <= 80;

  const { result, error } = useCalc<CompoundResult>(
    "/api/calc/compound",
    valid ? { principal: p, monthly: m, ratePct: r, years: y } : null,
  );

  return (
    <div className="space-y-4">
      <Card
        title="Investment details"
        action={
          <SaveButton
            disabled={!valid}
            onClick={() =>
              onSave(
                { principal: p, monthly: m, ratePct: r, years: y },
                `${fmtMoney(m)}/mo @ ${r}% · ${y}y`,
              )
            }
          />
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumField label="Starting amount ($)" value={principal} onChange={setPrincipal} />
          <NumField label="Monthly contribution ($)" value={monthly} onChange={setMonthly} />
          <NumField label="Annual return (%)" value={ratePct} onChange={setRatePct} />
          <NumField label="Years" value={years} onChange={setYears} />
        </div>
        {!valid && <div className="mt-2 text-xs text-slate-400">Enter an amount or contribution, a return (0–50%), and 1–80 years.</div>}
        {error && <div className="mt-2"><ErrorNote message={error} /></div>}
      </Card>

      {result && valid && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label={`Balance in ${y} years`} value={fmtMoney(result.finalBalance)} tone="good" />
            <StatCard label="You contribute" value={fmtMoney(result.totalContributed)} />
            <StatCard
              label="Growth"
              value={fmtMoney(result.totalInterest)}
              sub={result.totalContributed > 0
                ? `${Math.round((result.totalInterest / result.totalContributed) * 100)}% on top of contributions`
                : undefined}
            />
          </div>

          <Card title="Contributions vs growth">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={result.series}>
                <defs>
                  <linearGradient id="cgBal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.series[0]} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={c.series[0]} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="cgCon" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.muted} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={c.muted} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="year" fontSize={11} tickFormatter={(v) => `Yr ${v}`} />
                <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={80} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(y) => `Year ${y}`} />
                <Legend formatter={legendLabel} />
                <Area type="monotone" dataKey="balance" name="Balance" stroke={c.series[0]} fill="url(#cgBal)" strokeWidth={2} />
                <Area type="monotone" dataKey="contributed" name="Contributed" stroke={c.muted} fill="url(#cgCon)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-2 text-xs text-slate-400">
              Interest compounds monthly; contributions are added at the end of each month.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
