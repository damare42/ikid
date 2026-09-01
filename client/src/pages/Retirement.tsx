import { useEffect, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { SavedCalcDTO } from "@shared/types";
import { api } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { fmtMoney } from "../lib/format";
import { Card, ErrorNote, FoldingCard, StatCard } from "../components/ui";
import { legendLabel, useChartColors } from "../lib/chartColors";

/**
 * 🧭 Retirement — methodical early-retirement planning across account types.
 * All math runs in the server's deterministic, unit-tested engine
 * (services/retirement.ts + tax.ts). This page only collects inputs and
 * renders results.
 */

interface YearRow {
  age: number;
  phase: "accumulate" | "retired";
  trad: number;
  roth: number;
  rothBasisAvailable: number;
  brokerage: number;
  hsa: number;
  total: number;
  spendFromHsa: number;
  spendFromBrokerage: number;
  spendFromRothBasis: number;
  spendFromTrad: number;
  spendFromRothEarnings: number;
  conversion: number;
  rmd: number;
  ordinaryIncome: number;
  capitalGains: number;
  tax: number;
  penalty: number;
  shortfall: number;
}

interface SimResult {
  taxYear: number;
  success: boolean;
  depletionAge: number | null;
  endingBalance: number;
  totalTax: number;
  totalPenalties: number;
  totalConversions: number;
  bridgeYears: number;
  bridgeNeeded: number;
  bridgeAvailableAtRetirement: number;
  bridgePlan: {
    needed: boolean;
    bridgeYears: number;
    yearsToFund: number;
    ladder: boolean;
    targetPot: number;
    haveAtRetirement: number;
    gap: number;
    monthsToRetire: number;
    monthlyToClose: number | null;
    lumpTodayToClose: number | null;
  };
  warnings: string[];
  guidance: string[];
  years: YearRow[];
}

function Num({ label, value, onChange, hint }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="number" step="any" className="input w-full" value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <div className="mt-0.5 text-[12px] text-slate-400">{hint}</div>}
    </div>
  );
}

/** Small "ⓘ" that reveals rich help in a hover/focus popover (no page growth). */
function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label="More info"
        className="grid h-4 w-4 cursor-help place-items-center rounded-full bg-slate-200 text-[12px] font-bold leading-none text-slate-600 dark:bg-slate-700 dark:text-slate-300"
      >
        i
      </button>
      <span
        role="tooltip"
        // Fixed to the viewport on a phone, anchored to the icon from `sm` up.
        //
        // A 288px popover centred on its icon (`left-1/2 -translate-x-1/2`)
        // runs off a 375px screen whenever the icon sits right of centre — and
        // it did so while still `invisible`, because visibility doesn't remove
        // an element from layout, dragging the whole page 39px sideways with
        // nothing visible to explain why. Pinning it between the screen edges
        // can't overflow at any width, and the flip happens at `sm`, where
        // there is finally room to point at the thing being explained.
        className="pointer-events-none invisible fixed inset-x-4 bottom-4 z-50 rounded-lg border border-slate-200 bg-white p-3 text-left text-[11px] font-normal leading-5 text-slate-600 opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-6 sm:w-72 sm:-translate-x-1/2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      >
        {children}
      </span>
    </span>
  );
}

export default function Retirement() {
  const c = useChartColors();
  // About you
  const [currentAge, setCurrentAge] = useState("35");
  const [retireAge, setRetireAge] = useState("45");
  const [endAge, setEndAge] = useState("90");
  const [filing, setFiling] = useState<"single" | "married">("single");
  const [spending, setSpending] = useState("48000");
  const [ratePct, setRatePct] = useState("5");
  // Accounts
  const [tradBal, setTradBal] = useState("200000");
  const [tradCon, setTradCon] = useState("23000");
  const [rothBal, setRothBal] = useState("80000");
  const [rothBasis, setRothBasis] = useState("55000");
  const [rothCon, setRothCon] = useState("7000");
  const [brokBal, setBrokBal] = useState("120000");
  const [brokBasisPct, setBrokBasisPct] = useState("75");
  const [brokCon, setBrokCon] = useState("12000");
  const [hsaBal, setHsaBal] = useState("25000");
  const [hsaCon, setHsaCon] = useState("4300");
  const [hsaMed, setHsaMed] = useState("2500");
  // Strategy
  const [ladder, setLadder] = useState(true);
  const [fillBracket, setFillBracket] = useState<"0" | "10" | "12" | "22">("12");
  const [rmdAge, setRmdAge] = useState<"73" | "75">("75");

  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const BRACKET_HINT: Record<string, string> = {
    "0": "Converts only up to the standard deduction each year, so the conversion is taxed at 0%. Smallest, slowest ladder — best if you have almost no other taxable income.",
    "10": "Fills the deduction plus the 10% bracket. Still very cheap tax, a bit more converted per year.",
    "12": "The popular choice: fill the deduction + 10% + 12% brackets (single: up to ~$66,500 of conversions/yr in 2026). Moves a lot of money at low rates before RMDs hit.",
    "22": "Aggressive: also fills the 22% bracket. Empties Traditional faster (great if it's large and RMDs would otherwise be taxed higher), but you pay 22% on the top slice now.",
  };

  // Saved plans (shared store with the calculators, kind "retirement")
  const { data: allSaved, refresh: refreshSaved } = useFetch<SavedCalcDTO[]>("/api/calc/saved");
  const savedPlans = allSaved?.filter((c) => c.kind === "retirement") ?? [];

  /** Flatten the whole form into the numeric record the save API stores. */
  function planInputs(): Record<string, number> {
    return {
      currentAge: Number(currentAge), retireAge: Number(retireAge), endAge: Number(endAge),
      married: filing === "married" ? 1 : 0,
      annualSpending: Number(spending), ratePct: Number(ratePct),
      tradBal: Number(tradBal) || 0, tradCon: Number(tradCon) || 0,
      rothBal: Number(rothBal) || 0, rothBasis: Number(rothBasis) || 0, rothCon: Number(rothCon) || 0,
      brokBal: Number(brokBal) || 0, brokBasisPct: Number(brokBasisPct) || 0, brokCon: Number(brokCon) || 0,
      hsaBal: Number(hsaBal) || 0, hsaCon: Number(hsaCon) || 0, hsaMed: Number(hsaMed) || 0,
      ladder: ladder ? 1 : 0, fillBracket: Number(fillBracket), rmdAge: Number(rmdAge),
    };
  }

  function loadPlan(c: SavedCalcDTO) {
    const i = c.inputs;
    const s = (k: string, set: (v: string) => void) => { if (i[k] != null) set(String(i[k])); };
    s("currentAge", setCurrentAge); s("retireAge", setRetireAge); s("endAge", setEndAge);
    setFiling(i.married === 1 ? "married" : "single");
    s("annualSpending", setSpending); s("ratePct", setRatePct);
    s("tradBal", setTradBal); s("tradCon", setTradCon);
    s("rothBal", setRothBal); s("rothBasis", setRothBasis); s("rothCon", setRothCon);
    s("brokBal", setBrokBal); s("brokBasisPct", setBrokBasisPct); s("brokCon", setBrokCon);
    s("hsaBal", setHsaBal); s("hsaCon", setHsaCon); s("hsaMed", setHsaMed);
    setLadder(i.ladder !== 0);
    if (i.fillBracket != null) setFillBracket(String(i.fillBracket) as any);
    if (i.rmdAge != null) setRmdAge(String(i.rmdAge) as any);
  }

  async function savePlan() {
    const name = prompt(
      "Name this plan:",
      `Retire at ${retireAge} · ${fmtMoney(Number(spending))}/yr${ladder ? " · ladder" : ""}`,
    );
    if (!name?.trim()) return;
    try {
      await api.post("/api/calc/saved", { kind: "retirement", name: name.trim().slice(0, 80), inputs: planInputs() });
      refreshSaved();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deletePlan(id: number) {
    try {
      await api.delete(`/api/calc/saved/${id}`);
      refreshSaved();
    } catch (e: any) {
      setError(e.message);
    }
  }

  // Prefill spending from the user's real 12-month average, once.
  useEffect(() => {
    api.get<{ annualSpending: number; monthsOfData: number }>("/api/retirement/prefill")
      .then((p) => { if (p.annualSpending > 0) setSpending(String(p.annualSpending)); })
      .catch(() => {});
  }, []);

  const body = {
    currentAge: Number(currentAge),
    retireAge: Number(retireAge),
    endAge: Number(endAge),
    filingStatus: filing,
    annualSpending: Number(spending),
    ratePct: Number(ratePct),
    accounts: {
      trad: { balance: Number(tradBal) || 0, contribution: Number(tradCon) || 0 },
      roth: { balance: Number(rothBal) || 0, basis: Number(rothBasis) || 0, contribution: Number(rothCon) || 0 },
      brokerage: { balance: Number(brokBal) || 0, basisPct: Number(brokBasisPct) || 0, contribution: Number(brokCon) || 0 },
      hsa: { balance: Number(hsaBal) || 0, contribution: Number(hsaCon) || 0, annualMedical: Number(hsaMed) || 0 },
    },
    ladder,
    fillBracket: Number(fillBracket),
    rmdAge: Number(rmdAge),
  };
  const valid =
    body.currentAge >= 18 && body.retireAge >= body.currentAge &&
    body.endAge > body.retireAge && body.annualSpending > 0 &&
    body.ratePct >= 0 && body.ratePct <= 15 &&
    body.accounts.roth.basis <= body.accounts.roth.balance;

  useEffect(() => {
    if (!valid) return;
    const t = setTimeout(() => {
      api.post<SimResult>("/api/retirement/simulate", body)
        .then((r) => { setResult(r); setError(null); })
        .catch((e: any) => setError(e.message));
    }, 350);
    return () => clearTimeout(t);
  }, [JSON.stringify(body)]);

  const retiredYears = result?.years.filter((y) => y.phase === "retired") ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">Retirement Planner</h1>
        <button
          className="btn-ghost text-sm disabled:opacity-40"
          disabled={!valid}
          onClick={savePlan}
          title="Save this plan to reload later"
        >
          💾 Save plan
        </button>
      </div>

      {savedPlans.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400">📁 Saved plans:</span>
          {savedPlans.map((c) => (
            <span
              key={c.id}
              className="group inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 dark:bg-slate-800"
            >
              <button className="font-medium hover:text-brand-600" onClick={() => loadPlan(c)} title={`Saved ${c.createdAt} — click to load`}>
                🧭 {c.name}
              </button>
              <button
                className="rounded-full px-1 text-slate-400 opacity-0 transition-opacity hover:text-rose-500 dark:text-rose-400 group-hover:opacity-100"
                onClick={() => deletePlan(c.id)}
                title="Delete"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Inputs */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card title="👤 About you">
          <div className="grid grid-cols-2 gap-2">
            <Num label="Current age" value={currentAge} onChange={setCurrentAge} />
            <Num label="Retire at" value={retireAge} onChange={setRetireAge} />
            <Num label="Plan to age" value={endAge} onChange={setEndAge} />
            <div>
              <label className="label">Filing status</label>
              <select className="input w-full" value={filing} onChange={(e) => setFiling(e.target.value as any)}>
                <option value="single">Single</option>
                <option value="married">Married (joint)</option>
              </select>
            </div>
            <Num label="Spending ($/yr)" value={spending} onChange={setSpending} hint="after-tax, today's dollars" />
            <Num label="Real return (%)" value={ratePct} onChange={setRatePct} hint="after inflation; 5% ≈ 8% nominal" />
          </div>
        </Card>

        <FoldingCard
          title="🏦 Accounts"
          summary={`${fmtMoney(Number(tradBal) + Number(rothBal) + Number(brokBal) + Number(hsaBal))} invested · ${fmtMoney(Number(tradCon) + Number(rothCon) + Number(brokCon) + Number(hsaCon))}/yr going in`}
        >
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Num label="401k + Trad IRA" value={tradBal} onChange={setTradBal} />
              <Num label="Contribution /yr" value={tradCon} onChange={setTradCon} hint="incl. employer match" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Num label="Roth balance" value={rothBal} onChange={setRothBal} />
              <Num label="…of which basis" value={rothBasis} onChange={setRothBasis} hint="your contributions" />
              <Num label="Contribution /yr" value={rothCon} onChange={setRothCon} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Num label="Brokerage" value={brokBal} onChange={setBrokBal} />
              <Num label="Cost basis %" value={brokBasisPct} onChange={setBrokBasisPct} hint="unrealized-gain share" />
              <Num label="Contribution /yr" value={brokCon} onChange={setBrokCon} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Num label="HSA" value={hsaBal} onChange={setHsaBal} />
              <Num label="Contribution /yr" value={hsaCon} onChange={setHsaCon} />
              <Num label="Medical $/yr" value={hsaMed} onChange={setHsaMed} hint="qualified expenses" />
            </div>
          </div>
        </FoldingCard>

        <FoldingCard
          title="🧠 Strategy"
          summary={`${ladder ? "Roth ladder on" : "No ladder"} · fill to ${fillBracket}% bracket · RMDs at ${rmdAge}`}
        >
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ladder} onChange={(e) => setLadder(e.target.checked)} />
              <span><b>Roth conversion ladder</b></span>
              <InfoTip>
                <p className="mb-1.5"><b>What it is.</b> Each year in early retirement, move a slice of pre-tax Traditional money into your Roth. You pay income tax on that slice now (while your income is low); 5 years later that exact slice is withdrawable with no tax and no 10% early-withdrawal penalty — even before 59½.</p>
                <p className="mb-1.5"><b>The problem it solves.</b> Traditional 401k/IRA money is locked until 59½ — take it out early and you owe tax plus a 10% penalty. Retire at 45 and that's a ~14-year gap.</p>
                <p className="mb-1.5"><b>The trick.</b> A conversion isn't a withdrawal, so there's no penalty at any age. After 5 years of seasoning each converted "rung" comes out tax- and penalty-free. Convert yearly and you build a ladder of rungs.</p>
                <p><b>The catch.</b> The first 5 years can't be funded by the ladder yet — you cover them from bridge assets (brokerage, existing Roth contributions, HSA). The plan checks whether your bridge is big enough.</p>
              </InfoTip>
            </label>

            <div>
              <label className="label inline-flex items-center gap-1">
                Convert how much each year?
                <InfoTip>
                  <p className="mb-1.5">Tax brackets are marginal — each layer of income is taxed at its own rate. In early retirement your wages are gone, so the low layers sit empty. This picks how many of them to deliberately fill with conversions each year — cheaper now than the 22–24%+ you'd pay when RMDs force withdrawals later.</p>
                  <p><b>Selected:</b> {BRACKET_HINT[fillBracket]}</p>
                </InfoTip>
              </label>
              <select className="input w-full" value={fillBracket} onChange={(e) => setFillBracket(e.target.value as any)} disabled={!ladder}>
                <option value="0">Standard deduction only — 0% tax on conversions</option>
                <option value="10">Through the 10% bracket</option>
                <option value="12">Through the 12% bracket (classic)</option>
                <option value="22">Through the 22% bracket (aggressive)</option>
              </select>
            </div>

            <div>
              <label className="label inline-flex items-center gap-1">
                RMDs begin at
                <InfoTip>
                  Required Minimum Distributions — the age the IRS forces you to start withdrawing from Traditional accounts (taxed as income). A ladder shrinks the balance beforehand, so these forced withdrawals, and their tax, stay small. Age 73 if born 1951–1959; 75 if born 1960 or later.
                </InfoTip>
              </label>
              <select className="input w-full" value={rmdAge} onChange={(e) => setRmdAge(e.target.value as any)}>
                <option value="73">73 (born 1951–1959)</option>
                <option value="75">75 (born 1960 or later)</option>
              </select>
            </div>

            <div className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              Withdrawal order each year
              <InfoTip>
                Each year the plan draws in this tax-smart order: HSA (against medical expenses) → brokerage → Roth contributions and matured ladder rungs → Traditional after 59½ → Roth earnings. Dipping into Traditional before 59½ (10% penalty) is a last resort — the plan flags it if your bridge falls short.
              </InfoTip>
            </div>
          </div>
        </FoldingCard>
      </div>

      {!valid && (
        <Card>
          <div className="text-sm text-slate-500">
            Check the inputs: retire age ≥ current age, plan horizon past retirement, spending &gt; 0,
            return 0–15%, and Roth basis can't exceed the Roth balance.
          </div>
        </Card>
      )}
      {error && <ErrorNote message={error} />}

      {result && valid && (
        <>
          {/* Verdict */}
          <div
            className={`rounded-surface border p-4 text-sm ${
              result.success
                ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
            }`}
          >
            {result.success ? (
              <>✅ <b>The plan works.</b> Retiring at {retireAge}, money lasts to {endAge} with {fmtMoney(result.endingBalance)} left — no early-withdrawal penalties.</>
            ) : result.depletionAge != null ? (
              <>⚠️ <b>Falls short at age {result.depletionAge}.</b> Adjust spending, retirement age, or contributions — the guidance below shows the levers.</>
            ) : (
              <>⚠️ <b>Works only by raiding Traditional early</b> — {fmtMoney(result.totalPenalties)} in 10% penalties. Fatten the bridge (brokerage / Roth basis) to avoid them.</>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label={`Bridge (${retireAge}→59½)`}
              value={result.bridgeYears > 0 ? fmtMoney(result.bridgeAvailableAtRetirement) : "n/a"}
              sub={result.bridgeYears > 0 ? `of ${fmtMoney(result.bridgeNeeded)} needed` : "retiring after 59½"}
              tone={result.bridgeYears === 0 || result.bridgeAvailableAtRetirement >= result.bridgeNeeded ? "good" : "bad"}
            />
            <StatCard label="Lifetime federal tax" value={fmtMoney(result.totalTax)} sub={`${result.taxYear} tables, real $`} />
            <StatCard label="Ladder conversions" value={fmtMoney(result.totalConversions)} sub={ladder ? `filling ${fillBracket === "0" ? "deduction" : `${fillBracket}% bracket`}` : "ladder off"} />
            <StatCard
              label={`Balance at ${endAge}`}
              value={fmtMoney(result.endingBalance)}
              tone={result.endingBalance > 0 ? "good" : "bad"}
            />
          </div>

          {/* Bridge plan — how to avoid the 10% early-withdrawal penalty */}
          {result.bridgePlan.needed && (
            <Card title="🌉 Penalty-free bridge plan">
              {(() => {
                const bp = result.bridgePlan;
                const funded = bp.gap <= 0;
                return (
                  <div className="space-y-3 text-sm">
                    <p className="text-slate-600 dark:text-slate-300">
                      Retiring at {retireAge} leaves <b>{bp.bridgeYears} years</b> before penalty-free access to Traditional at 59½.
                      {bp.ladder
                        ? <> With the ladder you only need to self-fund the first <b>{bp.yearsToFund} years</b> (the conversion seasoning window) from penalty-free accounts; matured ladder rungs cover the rest.</>
                        : <> Without a ladder, every one of those <b>{bp.yearsToFund} years</b> must come from penalty-free accounts.</>}
                    </p>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <StatCard label={`Penalty-free pot needed at ${retireAge}`} value={fmtMoney(bp.targetPot)} sub={`${bp.yearsToFund} yrs spending + conversion tax`} />
                      <StatCard label="On track to have" value={fmtMoney(bp.haveAtRetirement)} sub="brokerage + Roth basis + HSA" tone={funded ? "good" : "default"} />
                      <StatCard label={funded ? "Surplus" : "Shortfall"} value={fmtMoney(funded ? bp.haveAtRetirement - bp.targetPot : bp.gap)} tone={funded ? "good" : "bad"} />
                    </div>

                    {funded ? (
                      <div className="rounded-lg bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                        ✅ Your bridge is funded — you can retire at {retireAge} without ever paying the 10% early-withdrawal penalty.
                      </div>
                    ) : bp.monthlyToClose != null ? (
                      <div className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        To close the {fmtMoney(bp.gap)} gap by age {retireAge}, invest about{" "}
                        <b>{fmtMoney(bp.monthlyToClose)}/mo</b> more for the next {Math.round(bp.monthsToRetire / 12 * 10) / 10} years
                        (at {ratePct}% real){bp.lumpTodayToClose != null && <> — or <b>{fmtMoney(bp.lumpTodayToClose)}</b> invested once today</>}.
                      </div>
                    ) : (
                      <div className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        You're {fmtMoney(bp.gap)} short and already at/near retirement — cover it with a lump sum, trim early-retirement spending, or push the date out.
                      </div>
                    )}

                    <p className="text-xs text-slate-400">
                      Put bridge money in a <b>taxable brokerage</b> first (accessible any age, often 0% long-term gains early on), then <b>Roth contributions</b> (your basis is always penalty-free) and your <b>HSA</b> for medical. Traditional 401k/IRA dollars don't help the bridge — that's exactly what the ladder converts out of.
                    </p>
                  </div>
                );
              })()}
            </Card>
          )}

          {/* Balances chart */}
          <Card title="Account balances by age">
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={result.years} stackOffset="none">
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="age" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={85} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(a) => `Age ${a}`} />
                <Legend formatter={legendLabel} />
                {/* Three annotations, one annotation colour. They were amber, cool
                    grey and purple — three hues that looked like three more series
                    on a chart that already has four. They are labelled and sit at
                    different ages; they don't need to be told apart by hue. */}
                <ReferenceLine x={Number(retireAge)} stroke={c.reference} strokeDasharray="5 4" label={{ value: "retire", fontSize: 10, fill: c.reference }} />
                <ReferenceLine x={60} stroke={c.reference} strokeDasharray="5 4" label={{ value: "59½", fontSize: 10, fill: c.reference }} />
                <ReferenceLine x={Number(rmdAge)} stroke={c.reference} strokeDasharray="5 4" label={{ value: "RMD", fontSize: 10, fill: c.reference }} />
                {/* Four account types are four categories, not four verdicts — Roth
                    was green only because Roth is the one people like. Colours are
                    taken from the ramp in stack order, which is what keeps the one
                    confusable pair (slots 0 and 2) from ending up adjacent. */}
                <Area type="monotone" stackId="1" dataKey="trad" name="Traditional" stroke={c.series[0]} fill={c.series[0]} fillOpacity={0.5} />
                <Area type="monotone" stackId="1" dataKey="roth" name="Roth" stroke={c.series[1]} fill={c.series[1]} fillOpacity={0.5} />
                <Area type="monotone" stackId="1" dataKey="brokerage" name="Brokerage" stroke={c.series[2]} fill={c.series[2]} fillOpacity={0.5} />
                <Area type="monotone" stackId="1" dataKey="hsa" name="HSA" stroke={c.series[3]} fill={c.series[3]} fillOpacity={0.5} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          {/* Tax chart */}
          {retiredYears.length > 0 && (
            <Card title="Federal tax + penalties per retirement year (conversions shown for context)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={retiredYears}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                  <XAxis dataKey="age" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(v)} width={80} />
                  <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(a) => `Age ${a}`} />
                  <Legend formatter={legendLabel} />
                  {/* Tax and penalty really are money out, so crimson is correct and
                      stays; the two stack, so the penalty takes the deeper stop of
                      the same colour rather than a different meaning. The Roth
                      conversion is an amount moved, not income — it loses the green. */}
                  <Bar dataKey="tax" name="Federal tax" stackId="t" fill={c.out} />
                  <Bar dataKey="penalty" name="10% penalty" stackId="t" fill={c.outAlt} />
                  <Bar dataKey="conversion" name="Roth conversion" fill={c.series[0]} fillOpacity={0.35} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Guidance */}
          <Card title="📋 What this plan says to do">
            <ul className="space-y-2 text-sm">
              {result.guidance.map((g, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-brand-600">▸</span>
                  <span>{g}</span>
                </li>
              ))}
              {result.warnings.map((w, i) => (
                <li key={`w${i}`} className="flex gap-2 text-rose-600 dark:text-rose-400">
                  <span>⚠️</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Year-by-year table */}
          <Card
            title="Year-by-year detail"
            action={
              <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => setShowTable((s) => !s)}>
                {showTable ? "Hide" : "Show"}
              </button>
            }
          >
            {showTable ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                      <th className="th">Age</th>
                      <th className="th text-right">Traditional</th>
                      <th className="th text-right">Roth</th>
                      <th className="th text-right">Brokerage</th>
                      <th className="th text-right">HSA</th>
                      <th className="th text-right">Conversion</th>
                      <th className="th text-right">RMD</th>
                      <th className="th text-right">Tax</th>
                      <th className="th text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {result.years.map((y) => (
                      <tr key={y.age} className={y.penalty > 0 || y.shortfall > 0 ? "bg-rose-50 dark:bg-rose-950/40" : ""}>
                        <td className="td">{y.age}{y.phase === "retired" ? "" : " 💼"}</td>
                        <td className="td text-right tabular-nums">{fmtMoney(y.trad)}</td>
                        <td className="td text-right tabular-nums">{fmtMoney(y.roth)}</td>
                        <td className="td text-right tabular-nums">{fmtMoney(y.brokerage)}</td>
                        <td className="td text-right tabular-nums">{fmtMoney(y.hsa)}</td>
                        <td className="td text-right tabular-nums">{y.conversion > 0 ? fmtMoney(y.conversion) : "—"}</td>
                        <td className="td text-right tabular-nums">{y.rmd > 0 ? fmtMoney(y.rmd) : "—"}</td>
                        <td className="td text-right tabular-nums">{y.tax + y.penalty > 0 ? fmtMoney(y.tax + y.penalty) : "—"}</td>
                        <td className="td text-right font-medium tabular-nums">{fmtMoney(y.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-slate-400">Every age from {currentAge} to {endAge}: balances, conversions, RMDs, and taxes. 💼 = still working.</div>
            )}
          </Card>

          <div className="text-[11px] leading-4 text-slate-400">
            Simplified model: {result.taxYear} federal brackets and standard deduction only (no state tax, NIIT, AMT,
            ACA effects, or dividend drag); age 59½ modeled as the year you turn 60; real (after-inflation) dollars throughout.
            Tax law changes — verify current-year numbers, and treat this as planning support, not tax advice.
          </div>
        </>
      )}
    </div>
  );
}
