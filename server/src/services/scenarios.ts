/**
 * Deterministic what-if scenario engine. All math lives here (pure,
 * unit-tested); the optional local LLM only handles language, never numbers.
 */

import { compoundGrowth } from "./finmath.js";

export interface Profile {
  avgMonthlyIncome: number;
  avgMonthlyExpenses: number;
  avgMonthlySavings: number;
  savingsRate: number; // 0..1
  avgHousingCost: number; // current rent/housing spend per month
  liquidSavings: number; // proxy: sum of goal balances (user can override in chat)
  monthsOfData: number;
}

export interface ScenarioResult {
  title: string;
  lines: string[];
  /** 24-month projection of liquid savings: baseline vs scenario. */
  chart?: { month: string; baseline: number; scenario: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Standard amortized mortgage/loan payment. */
export function loanMonthly(principal: number, annualRatePct: number, years: number): number {
  if (principal <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return round2(principal / n);
  return round2((principal * r) / (1 - Math.pow(1 + r, -n)));
}

function monthLabel(offset: number): string {
  const d = new Date();
  const m = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
}

/** Project liquid savings for 24 months: baseline vs scenario (one-time hit at month `hitMonth`, then new monthly savings). */
function project(
  p: Profile,
  oneTimeCost: number,
  newMonthlySavings: number,
  hitMonth: number,
): ScenarioResult["chart"] {
  const out: NonNullable<ScenarioResult["chart"]> = [];
  let base = p.liquidSavings;
  let scen = p.liquidSavings;
  for (let i = 0; i <= 24; i++) {
    out.push({ month: monthLabel(i), baseline: round2(base), scenario: round2(scen) });
    base += p.avgMonthlySavings;
    scen += i < hitMonth ? p.avgMonthlySavings : newMonthlySavings;
    if (i === hitMonth - 1) scen -= oneTimeCost; // cost lands at start of hitMonth
  }
  return out;
}

export interface HouseParams {
  price: number;
  downPct?: number; // default 20
  ratePct?: number; // default 6.5
  years?: number; // default 30
}

export function buyHouse(p: Profile, params: HouseParams): ScenarioResult {
  const downPct = params.downPct ?? 20;
  const ratePct = params.ratePct ?? 6.5;
  const years = params.years ?? 30;
  const down = params.price * (downPct / 100);
  const closing = params.price * 0.03;
  const upfront = down + closing;
  const mortgage = loanMonthly(params.price - down, ratePct, years);
  const taxInsurance = round2((params.price * 0.015) / 12); // ~1.5%/yr property tax + insurance
  const totalHousing = round2(mortgage + taxInsurance);
  const newExpenses = round2(p.avgMonthlyExpenses - p.avgHousingCost + totalHousing);
  const newSavings = round2(p.avgMonthlyIncome - newExpenses);

  const gap = Math.max(0, upfront - p.liquidSavings);
  const monthsToSave =
    gap === 0 ? 0 : p.avgMonthlySavings > 0 ? Math.ceil(gap / p.avgMonthlySavings) : null;

  const lines = [
    `Upfront cash needed: ${fmt(upfront)} (${downPct}% down ${fmt(down)} + ~3% closing ${fmt(closing)}).`,
    monthsToSave === 0
      ? `You already have enough set aside (${fmt(p.liquidSavings)}).`
      : monthsToSave != null
        ? `At your current ${fmt(p.avgMonthlySavings)}/mo savings pace, you'd have it in ~${monthsToSave} months (${monthLabel(monthsToSave)}).`
        : `You're not currently saving monthly, so the ${fmt(gap)} gap won't close without changes.`,
    `Monthly payment: ${fmt(mortgage)} mortgage (${ratePct}% / ${years}yr) + ~${fmt(taxInsurance)} tax & insurance = ${fmt(totalHousing)}.`,
    `That replaces your current ~${fmt(p.avgHousingCost)}/mo housing: expenses go ${fmt(p.avgMonthlyExpenses)} → ${fmt(newExpenses)}.`,
    `Monthly savings after buying: ${fmt(p.avgMonthlySavings)} → ${fmt(newSavings)}${newSavings < 0 ? " — you'd be underwater each month" : ` (${Math.round((newSavings / Math.max(1, p.avgMonthlyIncome)) * 100)}% savings rate)`}.`,
  ];
  const hit = monthsToSave ?? 24;
  return {
    title: `🏠 Buying a ${fmt(params.price)} house`,
    lines,
    chart: project(p, upfront, newSavings, Math.min(Math.max(hit, 1), 23)),
  };
}

export interface CarParams {
  price: number;
  downPct?: number; // default 20
  ratePct?: number; // default 7
  years?: number; // default 5
}

export function buyCar(p: Profile, params: CarParams): ScenarioResult {
  const downPct = params.downPct ?? 20;
  const ratePct = params.ratePct ?? 7;
  const years = params.years ?? 5;
  const down = params.price * (downPct / 100);
  const payment = loanMonthly(params.price - down, ratePct, years);
  const running = 150; // insurance + maintenance estimate
  const newSavings = round2(p.avgMonthlySavings - payment - running);
  const lines = [
    `Down payment: ${fmt(down)} (${downPct}%). Loan payment: ${fmt(payment)}/mo (${ratePct}% / ${years}yr).`,
    `With ~${fmt(running)}/mo insurance & maintenance, the true monthly cost is ~${fmt(payment + running)}.`,
    `Monthly savings: ${fmt(p.avgMonthlySavings)} → ${fmt(newSavings)}${newSavings < 0 ? " — this car would put you cash-flow negative" : ""}.`,
    `Paying cash instead would take ${p.avgMonthlySavings > 0 ? `~${Math.ceil(Math.max(0, params.price - p.liquidSavings) / p.avgMonthlySavings)} months of saving` : "longer than your current savings pace allows"}.`,
  ];
  return {
    title: `🚗 Buying a ${fmt(params.price)} car`,
    lines,
    chart: project(p, down, newSavings, 1),
  };
}

export interface EventParams {
  cost: number;
  monthsUntil?: number; // default 12
  label?: string;
  emoji?: string;
}

export function bigEvent(p: Profile, params: EventParams): ScenarioResult {
  const months = Math.max(1, params.monthsUntil ?? 12);
  const label = params.label ?? "event";
  const required = round2(params.cost / months);
  const feasibleMonths = p.avgMonthlySavings > 0 ? Math.ceil(params.cost / p.avgMonthlySavings) : null;
  const lines = [
    `To cover ${fmt(params.cost)} in ${months} months you'd need to set aside ${fmt(required)}/mo.`,
    p.avgMonthlySavings >= required
      ? `That fits: you currently save ${fmt(p.avgMonthlySavings)}/mo, leaving ${fmt(p.avgMonthlySavings - required)}/mo for everything else.`
      : `You currently save ${fmt(p.avgMonthlySavings)}/mo — a shortfall of ${fmt(required - p.avgMonthlySavings)}/mo. Either cut spending by that much, or push the date: at today's pace it takes ~${feasibleMonths ?? "∞"} months.`,
    `Paying from savings today would leave ${fmt(p.liquidSavings - params.cost)} of your ${fmt(p.liquidSavings)} cushion${p.liquidSavings - params.cost < 0 ? " — not enough on hand" : ""}.`,
  ];
  return {
    title: `${params.emoji ?? "🎉"} ${label.charAt(0).toUpperCase() + label.slice(1)} costing ${fmt(params.cost)}`,
    lines,
    chart: project(p, params.cost, p.avgMonthlySavings, Math.min(months, 23)),
  };
}

export interface StopWorkParams {
  months?: number; // planned time off, default 6
  liquidOverride?: number;
}

export function stopWork(p: Profile, params: StopWorkParams): ScenarioResult {
  const months = Math.max(1, params.months ?? 6);
  const liquid = params.liquidOverride ?? p.liquidSavings;
  const burn = p.avgMonthlyExpenses;
  const runway = burn > 0 ? round2(liquid / burn) : Infinity;
  const needed = round2(burn * months);
  const gap = Math.max(0, needed - liquid);
  const lines = [
    `Your spending is ~${fmt(burn)}/mo, so ${fmt(liquid)} of savings = ~${runway} months of runway.`,
    gap === 0
      ? `${months} months off costs ${fmt(needed)} — covered, with ${fmt(liquid - needed)} left over.`
      : `${months} months off costs ${fmt(needed)} — you're short ${fmt(gap)}. At ${fmt(p.avgMonthlySavings)}/mo saved, that's ~${p.avgMonthlySavings > 0 ? Math.ceil(gap / p.avgMonthlySavings) : "∞"} more months of working first.`,
    `Cutting guilt-free spending ~25% while off would stretch the runway to ~${burn > 0 ? round2(liquid / (burn * 0.85)) : "∞"} months.`,
  ];
  // scenario: no income for `months`, then back to normal
  const chart: NonNullable<ScenarioResult["chart"]> = [];
  let base = liquid;
  let scen = liquid;
  for (let i = 0; i <= 24; i++) {
    chart.push({ month: monthLabel(i), baseline: round2(base), scenario: round2(scen) });
    base += p.avgMonthlySavings;
    scen += i < months ? -burn : p.avgMonthlySavings;
  }
  return { title: `🛑 Stopping work for ${months} months`, lines, chart };
}

export function emergencyFund(p: Profile, params: { months?: number }): ScenarioResult {
  const months = Math.max(1, params.months ?? 6);
  const target = round2(p.avgMonthlyExpenses * months);
  const gap = Math.max(0, target - p.liquidSavings);
  const monthsToReach =
    gap === 0 ? 0 : p.avgMonthlySavings > 0 ? Math.ceil(gap / p.avgMonthlySavings) : null;
  const lines = [
    `A ${months}-month emergency fund at your ~${fmt(p.avgMonthlyExpenses)}/mo spending (average of your last ${p.monthsOfData} active months) = ${fmt(target)}.`,
    gap === 0
      ? `Your tracked savings (${fmt(p.liquidSavings)}) already cover it, with ${fmt(p.liquidSavings - target)} to spare.`
      : `You have ${fmt(p.liquidSavings)} tracked — ${fmt(gap)} to go.`,
    ...(gap > 0
      ? [
          monthsToReach != null
            ? `At your current ${fmt(p.avgMonthlySavings)}/mo pace you'd reach it in ~${monthsToReach} months (${monthLabel(monthsToReach)}).`
            : `You're not saving monthly right now, so the gap won't close without changes.`,
          `To get there within 12 months, set aside ${fmt(gap / 12)}/mo; within 24 months, ${fmt(gap / 24)}/mo.`,
        ]
      : []),
  ];
  return { title: `🛟 ${months}-month emergency fund`, lines };
}

export interface InvestParams {
  monthly?: number; // default: current monthly savings
  ratePct?: number; // default 7
  years?: number; // default 10
  principal?: number; // default 0
}

export function investGrowth(p: Profile, params: InvestParams): ScenarioResult {
  const monthly = params.monthly ?? Math.max(0, p.avgMonthlySavings);
  const ratePct = params.ratePct ?? 7;
  const years = Math.min(80, Math.max(1, params.years ?? 10));
  const principal = params.principal ?? 0;
  const g = compoundGrowth(principal, monthly, ratePct, years);
  const affordable = monthly <= p.avgMonthlySavings;
  const lines = [
    `Investing ${fmt(monthly)}/mo${principal > 0 ? ` (starting with ${fmt(principal)})` : ""} at ${ratePct}%/yr grows to ${fmt(g.finalBalance)} in ${years} years.`,
    `You put in ${fmt(g.totalContributed)}; compounding adds ${fmt(g.totalInterest)} on top.`,
    affordable
      ? `That fits your current ~${fmt(p.avgMonthlySavings)}/mo savings pace${monthly < p.avgMonthlySavings ? `, leaving ${fmt(p.avgMonthlySavings - monthly)}/mo unallocated` : ""}.`
      : `Heads up: you currently save ~${fmt(p.avgMonthlySavings)}/mo, so ${fmt(monthly)}/mo would need ${fmt(monthly - p.avgMonthlySavings)}/mo of cuts or extra income.`,
    `See the Calculators page (📐) to tweak rate, years, and contributions interactively.`,
  ];
  // Chart: baseline = what you put in, scenario = what it becomes.
  const chart = g.series.map((s) => ({
    month: monthLabel(s.year * 12),
    baseline: s.contributed,
    scenario: s.balance,
  }));
  return { title: `📈 Investing ${fmt(monthly)}/mo at ${ratePct}% for ${years} years`, lines, chart };
}

export function incomeChange(p: Profile, newMonthlyIncome: number): ScenarioResult {
  const newSavings = round2(newMonthlyIncome - p.avgMonthlyExpenses);
  const rate = newMonthlyIncome > 0 ? Math.round((newSavings / newMonthlyIncome) * 100) : 0;
  return {
    title: `💵 Income ${newMonthlyIncome >= p.avgMonthlyIncome ? "up" : "down"} to ${fmt(newMonthlyIncome)}/mo`,
    lines: [
      `Income: ${fmt(p.avgMonthlyIncome)} → ${fmt(newMonthlyIncome)}/mo; expenses stay ~${fmt(p.avgMonthlyExpenses)}.`,
      `Monthly savings: ${fmt(p.avgMonthlySavings)} → ${fmt(newSavings)} (${rate}% savings rate).`,
      `Over a year that's ${fmt(newSavings * 12)} saved vs ${fmt(p.avgMonthlySavings * 12)} today.`,
    ],
    chart: project(p, 0, newSavings, 1),
  };
}

export function expenseChange(p: Profile, deltaMonthly: number): ScenarioResult {
  const newExpenses = round2(p.avgMonthlyExpenses + deltaMonthly);
  const newSavings = round2(p.avgMonthlyIncome - newExpenses);
  return {
    title: `${deltaMonthly >= 0 ? "📈" : "📉"} Expenses ${deltaMonthly >= 0 ? "+" : "−"}${fmt(Math.abs(deltaMonthly))}/mo`,
    lines: [
      `Expenses: ${fmt(p.avgMonthlyExpenses)} → ${fmt(newExpenses)}/mo.`,
      `Monthly savings: ${fmt(p.avgMonthlySavings)} → ${fmt(newSavings)}${newSavings < 0 ? " — you'd be losing money monthly" : ""}.`,
      `Yearly impact: ${fmt(-deltaMonthly * 12)} ${deltaMonthly >= 0 ? "less" : "more"} saved per year.`,
    ],
    chart: project(p, 0, newSavings, 1),
  };
}

// ---------- intent parsing (built-in, no LLM required) ----------

export interface ParsedIntent {
  kind: "house" | "car" | "event" | "stopwork" | "income" | "expense" | "emergency" | "invest";
  params: Record<string, number | string>;
}

/**
 * Parse "$400k", "400,000", "1.2m" style amounts; returns the first found.
 * Deliberately strict: a bare small number ("6" in "6 months") is NOT money —
 * it must have a $ sign, a k/m suffix, or be a 3+ digit figure not followed
 * by a time unit or %.
 */
export function parseMoney(text: string): number | null {
  // (k|m) suffix only counts when standalone — the "m" in "months" doesn't.
  const re = /(\$)?\s*([\d][\d,]*(?:\.\d+)?)(?:\s*(k|m)\b)?/gi;
  for (const m of text.matchAll(re)) {
    const hasDollar = m[1] === "$";
    const suffix = m[3]?.toLowerCase();
    let n = parseFloat(m[2].replace(/,/g, ""));
    if (isNaN(n)) continue;
    if (suffix === "k") n *= 1_000;
    if (suffix === "m") n *= 1_000_000;
    // Reject when followed by a time unit or percent ("6 months", "30 yr", "10%")
    const after = text.slice((m.index ?? 0) + m[0].length).trimStart();
    if (/^(months?|mos?|years?|yrs?|%)/i.test(after)) continue;
    if (hasDollar || suffix || n >= 100) return n;
  }
  return null;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * Detect an explicit averaging window: "use the last six months", "past 3
 * months", "year to date". Returns months or null (caller defaults to 12).
 */
export function parseWindowMonths(text: string): number | null {
  const t = text.toLowerCase();
  const m = t.match(/\b(?:last|past|previous|trailing)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*months?/);
  if (m) {
    const n = WORD_NUMBERS[m[1]] ?? parseInt(m[1]);
    if (!isNaN(n) && n >= 1) return Math.min(24, n);
  }
  if (/(year to date|ytd|this year)/.test(t)) return new Date().getMonth() + 1;
  return null;
}

/**
 * Detect plain data questions ("what did I spend last 6 months", "how much do
 * I save") — these get answered with real totals, not modeled as scenarios.
 * Returns the month window to report on, or null if it's not a data question.
 */
export function parseStatsIntent(text: string): { months: number } | null {
  const t = text.toLowerCase();
  if (/\bwhat if\b/.test(t)) return null; // that's a scenario
  if (!/\b(what|how much|show|tell me|summar|list)\b/.test(t)) return null;
  if (!/\b(spend|spent|expense|expenses|income|earn|earned|save|saving|savings)\b/.test(t)) return null;
  // Don't steal purchase/emergency phrasings
  if (/\b(house|home|car|wedding|cover|emergency|stop work|quit|invest|compound)\b/.test(t)) return null;
  const m = t.match(/last\s+(\d+)\s*month/);
  if (m) return { months: Math.min(24, Math.max(1, parseInt(m[1]))) };
  if (/(year to date|ytd|this year)/.test(t)) return { months: new Date().getMonth() + 1 };
  return { months: 6 };
}

export function parseIntent(text: string): ParsedIntent | null {
  const t = text.toLowerCase();
  const money = parseMoney(text);
  const monthsMatch = t.match(/(\d+)\s*(?:months?|mos?)\b/);
  const months = monthsMatch ? parseInt(monthsMatch[1]) : undefined;
  const downMatch = t.match(/(\d+(?:\.\d+)?)\s*%\s*down/);
  const downPct = downMatch ? parseFloat(downMatch[1]) : undefined;

  if (/\b(house|home|mortgage|condo|townhouse)\b/.test(t)) {
    return { kind: "house", params: { price: money ?? 400_000, ...(downPct !== undefined && { downPct }) } };
  }
  if (/\b(car|vehicle|truck|suv|tesla)\b/.test(t)) {
    return { kind: "car", params: { price: money ?? 30_000, ...(downPct !== undefined && { downPct }) } };
  }
  if (/\b(wedding|marry|marriage)\b/.test(t)) {
    return { kind: "event", params: { cost: money ?? 25_000, label: "wedding", emoji: "💍", ...(months !== undefined && { monthsUntil: months }) } };
  }
  if (/\b(mov(e|ing)|relocat)/.test(t)) {
    return { kind: "event", params: { cost: money ?? 5_000, label: "move", emoji: "📦", ...(months !== undefined && { monthsUntil: months }) } };
  }
  if (/\b(vacation|trip|travel)\b/.test(t)) {
    return { kind: "event", params: { cost: money ?? 3_000, label: "trip", emoji: "✈️", ...(months !== undefined && { monthsUntil: months }) } };
  }
  // (data questions like "what are my expenses for the last 6 months" are
  // handled by parseStatsIntent before this runs)
  // "cover 6 months of expenses", "emergency fund", "6 month cushion/runway"
  if (
    /\bemergency fund\b/.test(t) ||
    (/\b(cover|cushion|runway|safety net|set aside)\b/.test(t) && /\bmonths?\b/.test(t) && /\b(expense|spending|cost|living)/.test(t))
  ) {
    return { kind: "emergency", params: { ...(months !== undefined && { months }) } };
  }
  if (/\b(stop work|quit|sabbatical|unemployed|laid off|career break|time off|not work)/.test(t)) {
    return { kind: "stopwork", params: { ...(months !== undefined && { months }) } };
  }
  // "invest $500 a month at 7% for 20 years", "compound growth", "put $200/mo in index funds"
  if (/\b(invest|compound|index fund|401k|roth|ira|brokerage|stock market)\b/.test(t)) {
    const rateMatch = t.match(/(?:at\s*)?(\d+(?:\.\d+)?)\s*%(?!\s*down)/);
    const yearsMatch = t.match(/(\d+)\s*(?:years?|yrs?)\b/);
    const perMonth = /\b(a|per|each|\/)\s*(month|mo)\b|\/mo\b/.test(t);
    return {
      kind: "invest",
      params: {
        ...(money != null && (perMonth || money <= 10_000) && { monthly: money }),
        ...(money != null && !perMonth && money > 10_000 && { principal: money }),
        ...(rateMatch && { ratePct: parseFloat(rateMatch[1]) }),
        ...(yearsMatch && { years: parseInt(yearsMatch[1]) }),
      },
    };
  }
  // Income/expense changes need a real dollar amount AND change wording —
  // otherwise the question falls through to the LLM instead of guessing.
  const changeWords = /\b(go(es)?\s*(up|down)|up|down|increase|decrease|cut|reduce|extra|more|less|rise|drop|raise)\b/;
  if (/\b(raise|income|salary|earn|paid)\b/.test(t) && money != null) {
    return { kind: "income", params: { amount: money } };
  }
  if (/\b(expense|spend(ing)?|cost)s?\b/.test(t) && money != null && changeWords.test(t)) {
    const negative = /\b(cut|reduce|less|drop|decrease|down)\b/.test(t);
    return { kind: "expense", params: { delta: negative ? -money : money } };
  }
  return null;
}
