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
  parseStatsIntent, profileAverages, statsFromSeries, type Profile, type ScenarioResult,
} from "./scenarios.js";

// The dispatch itself is pure and lives in the engine, so the hosted demo can
// run the same code in a browser. Re-exported here because this is where the
// rest of the server expects to find it.
export { runScenario } from "./scenarios.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1";

export async function buildProfile(windowMonths = 12): Promise<Profile> {
  // Fetch one extra month so the current (partial) month can be dropped and
  // the window still covers `windowMonths` complete months.
  const series = await monthlySeries(Math.min(25, windowMonths + 1));
  // Dropping the partial month and ignoring inactive ones is arithmetic the
  // demo has to do identically, so it lives in the engine.
  const averages = profileAverages(series);
  const n = averages.monthsOfData;

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
    ...averages,
    avgHousingCost: r2(housingTotal / n),
    liquidSavings: r2(liquid),
  };
}

/** Answer plain data questions ("what are my expenses last 6 months") with real totals. */
export async function statsAnswer(text: string): Promise<ScenarioResult | null> {
  const intent = parseStatsIntent(text);
  if (!intent) return null;
  return statsFromSeries(text, await monthlySeries(intent.months));
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

// The suggestion list is pure text over a profile, and the demo needs it for
// exactly the same reason — so it lives in the engine and is re-exported here.
export { fallbackReply } from "./scenarios.js";
