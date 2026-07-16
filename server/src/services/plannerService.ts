/**
 * Planner orchestration: builds a financial profile from real data, runs the
 * deterministic scenario engine, and (optionally) uses a local Ollama LLM for
 * freeform questions. The LLM never does the math — it only talks about
 * numbers the engine or profile provides.
 */
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { monthlySeries, categoryBreakdown } from "./analyticsService.js";
import {
  buyHouse, buyCar, bigEvent, stopWork, incomeChange, expenseChange, emergencyFund, investGrowth,
  parseIntent, parseStatsIntent, parseWindowMonths, type Profile, type ScenarioResult,
} from "./scenarios.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1";

export async function buildProfile(windowMonths = 12): Promise<Profile> {
  // Fetch one extra month so the current (partial) month can be dropped and
  // the window still covers `windowMonths` complete months.
  const series = await monthlySeries(Math.min(25, windowMonths + 1));
  const complete = series.slice(0, -1);
  // Ignore months with no activity (before the user's data starts) so they
  // don't drag the averages toward zero.
  const active = complete.filter((p) => p.income > 0 || p.expenses > 0);
  const src = active.length > 0 ? active : complete.length > 0 ? complete : series;
  const n = Math.max(1, src.length);
  const avgIncome = src.reduce((s, p) => s + p.income, 0) / n;
  const avgExpenses = src.reduce((s, p) => s + p.expenses, 0) / n;

  // Current housing cost: average Housing/Rent/Mortgage spend over the window
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - n, 1);
  const cats = await categoryBreakdown(from, now);
  const housingTotal = cats
    .filter((c) => ["housing", "rent", "mortgage"].includes(c.name.toLowerCase()))
    .reduce((s, c) => s + c.total, 0);

  // Liquid savings proxy: what the user tracks across goals
  const goals = await prisma.goal.findMany();
  const liquid = goals.reduce((s, g) => s + g.currentSaved, 0);

  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    avgMonthlyIncome: r2(avgIncome),
    avgMonthlyExpenses: r2(avgExpenses),
    avgMonthlySavings: r2(avgIncome - avgExpenses),
    savingsRate: avgIncome > 0 ? r2((avgIncome - avgExpenses) / avgIncome) : 0,
    avgHousingCost: r2(housingTotal / n),
    liquidSavings: r2(liquid),
    monthsOfData: n,
  };
}

/** Answer plain data questions ("what are my expenses last 6 months") with real totals. */
export async function statsAnswer(text: string): Promise<ScenarioResult | null> {
  const intent = parseStatsIntent(text);
  if (!intent) return null;
  const series = await monthlySeries(intent.months);
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const totalIncome = series.reduce((s, p) => s + p.income, 0);
  const totalExpenses = series.reduce((s, p) => s + p.expenses, 0);
  const complete = series.length > 1 ? series.slice(0, -1) : series;
  const avgExpenses = complete.reduce((s, p) => s + p.expenses, 0) / Math.max(1, complete.length);
  const avgIncome = complete.reduce((s, p) => s + p.income, 0) / Math.max(1, complete.length);
  const lines = [
    `Totals: income ${fmt(totalIncome)}, expenses ${fmt(totalExpenses)}, net saved ${fmt(totalIncome - totalExpenses)}.`,
    `Monthly average (complete months): income ${fmt(avgIncome)}, expenses ${fmt(avgExpenses)}, savings ${fmt(avgIncome - avgExpenses)}.`,
    "",
    ...series.map((p) => `${p.month}:  income ${fmt(p.income)} · expenses ${fmt(p.expenses)} · saved ${fmt(p.savings)}`),
  ];
  return { title: `📊 Your last ${series.length} months`, lines };
}

export function runScenario(profile: Profile, text: string): ScenarioResult | null {
  const intent = parseIntent(text);
  if (!intent) return null;
  switch (intent.kind) {
    case "house":
      return buyHouse(profile, intent.params as any);
    case "car":
      return buyCar(profile, intent.params as any);
    case "event":
      return bigEvent(profile, intent.params as any);
    case "stopwork":
      return stopWork(profile, intent.params as any);
    case "emergency":
      return emergencyFund(profile, intent.params as any);
    case "income": {
      const amount = Number(intent.params.amount);
      // Treat small numbers as monthly, big ones as yearly salary
      const monthly = amount > 20_000 ? amount / 12 : amount;
      return incomeChange(profile, Math.round(monthly * 100) / 100);
    }
    case "expense":
      return expenseChange(profile, Number(intent.params.delta));
    case "invest":
      return investGrowth(profile, intent.params as any);
  }
}

// ---------- optional Ollama ----------

export async function ollamaStatus(): Promise<{ available: boolean; model: string; reason?: string }> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return { available: false, model: OLLAMA_MODEL, reason: `Ollama responded ${res.status}` };
    }
    const data: any = await res.json();
    const models: string[] = (data.models ?? []).map((m: any) => String(m.name));
    if (models.length === 0) {
      return { available: false, model: OLLAMA_MODEL, reason: "Ollama is running but has no models — run: ollama pull llama3.1" };
    }
    const model = models.find((m) => m.startsWith(OLLAMA_MODEL)) ?? models[0];
    return { available: true, model };
  } catch (e) {
    return {
      available: false,
      model: OLLAMA_MODEL,
      reason: `Cannot reach Ollama at ${OLLAMA_URL} (${(e as Error).message}). Is "ollama serve" running?`,
    };
  }
}

export async function ollamaChat(
  history: { role: "user" | "assistant"; content: string }[],
  profile: Profile,
  engineResult: ScenarioResult | null,
): Promise<string | null> {
  const status = await ollamaStatus();
  if (!status.available) return null;

  const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const system = [
    "You are Ikid's financial planning assistant, running fully locally on the user's machine.",
    "Be concise (under 150 words), practical, and honest. You are not a licensed financial advisor; for big decisions suggest verifying with a professional.",
    "NEVER invent numbers. Only use the figures provided below. If asked for math beyond them, explain what the scenario engine supports (house, car, wedding/moving/trip, stopping work, income or expense changes, investing with compound growth) and suggest phrasing.",
    "",
    "User's actual finances (monthly averages from their imported data):",
    `- Take-home income: ${fmt(profile.avgMonthlyIncome)}/mo`,
    `- Expenses: ${fmt(profile.avgMonthlyExpenses)}/mo (housing portion ${fmt(profile.avgHousingCost)})`,
    `- Savings: ${fmt(profile.avgMonthlySavings)}/mo (${Math.round(profile.savingsRate * 100)}% rate)`,
    `- Tracked savings balance: ${fmt(profile.liquidSavings)}`,
    engineResult
      ? `\nThe deterministic engine already computed this scenario — summarize/answer using ONLY these results:\n${engineResult.title}\n${engineResult.lines.join("\n")}`
      : "",
  ].join("\n");

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: status.model,
        stream: false,
        messages: [{ role: "system", content: system }, ...history.slice(-8)],
      }),
      signal: AbortSignal.timeout(120_000), // cold model loads can be slow
    });
    if (!res.ok) {
      logger.warn("Ollama chat HTTP error", { status: res.status });
      return null;
    }
    const data: any = await res.json();
    return data?.message?.content ?? null;
  } catch (e) {
    logger.warn("Ollama chat failed", { message: (e as Error).message });
    return null;
  }
}

export function fallbackReply(profile: Profile, ollamaReason?: string): string {
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  return [
    `Here's where you stand: you take home ~${fmt(profile.avgMonthlyIncome)}/mo, spend ~${fmt(profile.avgMonthlyExpenses)}/mo, and save ~${fmt(profile.avgMonthlySavings)}/mo (${Math.round(profile.savingsRate * 100)}%).`,
    "",
    "I can model these scenarios exactly — try:",
    '• "Buy a house for $450k with 10% down"',
    '• "Buy a $30k car"',
    '• "Wedding costing $20k in 18 months"',
    '• "Moving, about $6k"',
    '• "How much do I need to cover 6 months of expenses?"',
    '• "Invest $500 a month at 7% for 20 years"',
    '• "Stop working for 8 months"',
    '• "What if my expenses go up $800"  ·  "What if I earn $95k"',
    "",
    ollamaReason
      ? `⚠️ Local AI unavailable: ${ollamaReason}`
      : "Tip: install Ollama (ollama.com) and run `ollama pull llama3.1` to unlock freeform questions here — still 100% local.",
  ].join("\n");
}
