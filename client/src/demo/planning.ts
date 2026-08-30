/**
 * Net worth, bills, reconcile, calculators, retirement and the planner.
 *
 * These are the cheapest handlers in the demo, because the engines behind them
 * were already pure: `finmath`, `retirement`, `debtPayoff`, `scenarios`,
 * `billsCore` and `reconcileCore` all run unchanged in a browser. This file is
 * mostly shape-shuffling between the store and functions the server calls with
 * the same arguments.
 */
import type { AssetDTO, NetWorthPoint, NetWorthSummary } from "@shared/types";
import { amortization, coastFire, compoundGrowth, fireProjection, loanPayoff } from "@engine/finmath.js";
import { comparePayoff } from "@engine/debtPayoff.js";
import { simulateRetirement } from "@engine/retirement.js";
import { buildBillsSummary, type MerchantCharges } from "@engine/billsCore.js";
import { buildReconciliation, type ReconcileTxn } from "@engine/reconcileCore.js";
import {
  fallbackReply, parseStatsIntent, parseWindowMonths, profileAverages, runScenario,
  statsFromSeries, type Profile,
} from "@engine/scenarios.js";
import { DemoHttpError, num, route, str } from "./router.js";
import { db, find, insert, remove } from "./store.js";
import { allTxns, asDate, categoryDTO, latestDate, merchantDTO, round2, ymd } from "./data.js";
import { categoryBreakdown, monthlySeries } from "./analytics.js";

const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ---------------------------------------------------------------------------
// Net worth
// ---------------------------------------------------------------------------

function snapshotsFor(assetId: number): { date: string; value: number }[] {
  return db().assetSnapshot
    .filter((s) => s.assetId === assetId)
    .map((s) => ({ date: ymd(s.date), value: s.value as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function assetDTO(a: Record<string, unknown>): AssetDTO {
  const snaps = snapshotsFor(a.id as number);
  const latest = snaps.at(-1);
  const prev = snaps.length > 1 ? snaps.at(-2) : undefined;
  return {
    id: a.id as number,
    name: a.name as string,
    kind: a.kind as AssetDTO["kind"],
    isLiability: Boolean(a.isLiability),
    icon: (a.icon as string) ?? "💰",
    units: (a.units as number | null) ?? null,
    unitPrice: (a.unitPrice as number | null) ?? null,
    ratePct: (a.ratePct as number | null) ?? null,
    monthlyPayment: (a.monthlyPayment as number | null) ?? null,
    notes: (a.notes as string | null) ?? null,
    value: latest?.value ?? 0,
    updatedAt: latest?.date ?? ymd(new Date()),
    previousValue: prev?.value ?? null,
    payoff: null,
  };
}

route("GET /api/networth/summary", () => {
  const assets = db().asset.map(assetDTO);
  const totalAssets = round2(assets.filter((a) => !a.isLiability).reduce((s, a) => s + a.value, 0));
  const totalLiabilities = round2(assets.filter((a) => a.isLiability).reduce((s, a) => s + a.value, 0));
  const byKindMap = new Map<string, { kind: string; total: number; isLiability: boolean }>();
  for (const a of assets) {
    const p = byKindMap.get(a.kind) ?? { kind: a.kind, total: 0, isLiability: a.isLiability };
    p.total = round2(p.total + a.value);
    byKindMap.set(a.kind, p);
  }
  const out: NetWorthSummary = {
    netWorth: round2(totalAssets - totalLiabilities),
    totalAssets,
    totalLiabilities,
    assets,
    byKind: [...byKindMap.values()].sort((a, b) => b.total - a.total),
  };
  return out;
});

route("GET /api/networth/history", ({ query }) => {
  const months = num(query, "months") ?? 24;
  const now = new Date();
  const points: NetWorthPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // month end
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const cutoff = ymd(d);
    let assets = 0;
    let liabilities = 0;
    for (const a of db().asset) {
      // Carry the latest snapshot at or before this month forward, which is
      // what the server does — a value stands until it's updated.
      const snaps = snapshotsFor(a.id).filter((s) => s.date <= cutoff);
      const v = snaps.at(-1)?.value;
      if (v == null) continue;
      if (a.isLiability) liabilities += v;
      else assets += v;
    }
    points.push({
      month: key,
      assets: round2(assets),
      liabilities: round2(liabilities),
      netWorth: round2(assets - liabilities),
    });
  }
  return points;
});

route("GET /api/networth/assets", () => db().asset.map(assetDTO));

route("POST /api/networth/assets", ({ body }) => {
  const b = (body ?? {}) as Record<string, unknown>;
  const created = insert("asset", {
    name: String(b.name ?? "New item"),
    kind: b.kind ?? "cash",
    isLiability: Boolean(b.isLiability),
    icon: b.icon ?? "💰",
    units: b.units ?? null, unitPrice: b.unitPrice ?? null,
    ratePct: b.ratePct ?? null, monthlyPayment: b.monthlyPayment ?? null,
    notes: b.notes ?? null,
  });
  insert("assetSnapshot", {
    assetId: created.id,
    date: new Date(String(b.date ?? today())),
    value: Number(b.value ?? 0),
  });
  return assetDTO(created);
});

route("PATCH /api/networth/assets/:id", ({ params, body }) => {
  const a = find("asset", Number(params.id));
  if (!a) throw new DemoHttpError(404, "Not found");
  Object.assign(a, body ?? {});
  return assetDTO(a);
});

route("POST /api/networth/assets/:id/snapshots", ({ params, body }) => {
  const b = (body ?? {}) as { value?: number; date?: string };
  insert("assetSnapshot", {
    assetId: Number(params.id),
    date: new Date(String(b.date ?? today())),
    value: Number(b.value ?? 0),
  });
  const a = find("asset", Number(params.id));
  return a ? assetDTO(a) : { ok: true };
});

route("GET /api/networth/assets/:id/history", ({ params }) => snapshotsFor(Number(params.id)));

route("DELETE /api/networth/assets/:id", ({ params }) => {
  const id = Number(params.id);
  const store = db();
  store.assetSnapshot = store.assetSnapshot.filter((s) => s.assetId !== id);
  remove("asset", id);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Bills — the real engine, fed from the store instead of SQLite
// ---------------------------------------------------------------------------

route("GET /api/bills", ({ query }) => {
  const horizon = (num(query, "horizon") ?? 30) as 30 | 60 | 90;
  const byMerchant = new Map<string, MerchantCharges>();
  for (const t of allTxns()) {
    if ((t.amount as number) >= 0 || t.isTransfer) continue;
    const cat = categoryDTO(t.categoryId);
    if (cat?.type === "transfer" || cat?.name === "Investment") continue;
    const name = merchantDTO(t.merchantId)?.name;
    if (!name) continue;
    const g = byMerchant.get(name) ?? { merchant: name, merchantId: (t.merchantId as number) ?? null, charges: [] };
    g.charges.push({ id: t.id, date: ymd(t.date), amount: round2(-(t.amount as number)) });
    byMerchant.set(name, g);
  }
  for (const g of byMerchant.values()) g.charges.sort((a, b) => a.date.localeCompare(b.date));

  // Six whole months of surplus, excluding the running month.
  const now = new Date();
  const monthly: { month: string; income: number; expenses: number }[] = [];
  for (let i = 6; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    let income = 0;
    let expenses = 0;
    for (const t of allTxns()) {
      if (ymd(t.date).slice(0, 7) !== key || t.isTransfer) continue;
      const cat = categoryDTO(t.categoryId);
      if (cat?.type === "transfer") continue;
      const amt = t.amount as number;
      if (amt > 0) income += amt;
      else if (cat?.name !== "Investment") expenses += -amt;
    }
    monthly.push({ month: key, income: round2(income), expenses: round2(expenses) });
  }

  const observed = ymd(latestDate());
  return buildBillsSummary([...byMerchant.values()], {
    today: today(),
    observedThrough: observed,
    observedThroughOrNull: observed,
    horizonDays: horizon,
    monthly,
  });
});

// ---------------------------------------------------------------------------
// Reconcile — likewise the real engine
// ---------------------------------------------------------------------------

const reconcileRows = (accountId: number): ReconcileTxn[] =>
  allTxns()
    .filter((t) => t.accountId === accountId)
    .map((t) => ({
      id: t.id,
      date: ymd(t.date),
      amount: t.amount as number,
      description: t.description as string,
      cleared: Boolean(t.cleared),
      isTransfer: Boolean(t.isTransfer),
      merchant: merchantDTO(t.merchantId)?.name ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

route("GET /api/reconcile/summary", ({ query }) => {
  const accountId = num(query, "accountId");
  if (accountId == null) throw new DemoHttpError(400, "Pick an account to reconcile");
  const account = find("account", accountId);
  const statementDate = str(query, "statementDate") ?? ymd(latestDate());
  const statementBalance = num(query, "statementBalance") ?? 0;
  const openingBalance = num(query, "openingBalance") ?? 0;
  return buildReconciliation(reconcileRows(accountId), {
    accountId,
    accountName: (account?.name as string) ?? "Account",
    statementDate,
    statementBalance,
    openingBalance,
  });
});

route("GET /api/reconcile/transactions", ({ query }) => {
  const accountId = num(query, "accountId");
  if (accountId == null) throw new DemoHttpError(400, "Pick an account first");
  const statementDate = str(query, "statementDate") ?? ymd(latestDate());
  const bucket = str(query, "bucket") ?? "uncleared";
  const rows = reconcileRows(accountId).filter((r) => {
    if (bucket === "after") return r.date > statementDate;
    if (bucket === "cleared") return r.date <= statementDate && r.cleared;
    return r.date <= statementDate && !r.cleared;
  });
  return { bucket, total: rows.length, rows: rows.slice(0, 500) };
});

route("POST /api/reconcile/mark", ({ body }) => {
  const b = (body ?? {}) as { ids?: number[]; cleared?: boolean; accountId?: number; upToDate?: string };
  const cleared = Boolean(b.cleared);
  let targets = allTxns();
  if (b.ids) targets = targets.filter((t) => b.ids!.includes(t.id));
  else if (b.accountId != null) {
    targets = targets.filter(
      (t) => t.accountId === b.accountId && (!b.upToDate || ymd(t.date) <= b.upToDate!),
    );
  }
  // Only rows that actually flip, so undo restores exactly the prior state.
  const changing = targets.filter((t) => Boolean(t.cleared) !== cleared);
  for (const t of changing) t.cleared = cleared;
  return { updated: changing.length, undoIds: changing.map((t) => t.id) };
});

// ---------------------------------------------------------------------------
// Calculators — the pure engines, called exactly as the routes call them
// ---------------------------------------------------------------------------

const b = (body: unknown) => (body ?? {}) as Record<string, number & string & never>;

route("POST /api/calc/amortization", ({ body }) => {
  const p = b(body);
  return amortization(Number(p.principal), Number(p.ratePct), Number(p.years), Number(p.extraMonthly ?? 0));
});
route("POST /api/calc/compound", ({ body }) => {
  const p = b(body);
  return compoundGrowth(Number(p.principal), Number(p.monthly), Number(p.ratePct), Number(p.years));
});
route("POST /api/calc/fire", ({ body }) => fireProjection(body as never));
route("POST /api/calc/coast", ({ body }) => coastFire(body as never));
route("POST /api/calc/payoff", ({ body }) => {
  const p = b(body);
  return loanPayoff(Number(p.balance), Number(p.ratePct), Number(p.payment), Number(p.extraMonthly ?? 0));
});
route("POST /api/calc/debt-plan", ({ body }) => {
  const p = (body ?? {}) as { debts?: never[]; extraMonthly?: number };
  return comparePayoff(p.debts ?? [], Number(p.extraMonthly ?? 0));
});

/** Prefill the debt planner from the demo's liabilities, like the server does. */
route("GET /api/calc/debts", () => ({
  debts: db().asset
    .filter((a) => a.isLiability)
    .map((a) => {
      const v = snapshotsFor(a.id).at(-1)?.value ?? 0;
      return {
        name: a.name as string,
        balance: v,
        ratePct: (a.ratePct as number) ?? 0,
        minPayment: (a.monthlyPayment as number) ?? Math.max(25, round2(v * 0.02)),
      };
    })
    .filter((d) => d.balance > 0),
}));

route("GET /api/calc/saved", () =>
  db().savedCalculation.map((c) => ({
    id: c.id,
    kind: c.kind,
    name: c.name,
    inputs: typeof c.inputs === "string" ? JSON.parse(c.inputs as string) : c.inputs,
    createdAt: new Date().toISOString(),
  })));

route("POST /api/calc/saved", ({ body }) => {
  const p = (body ?? {}) as Record<string, unknown>;
  const row = insert("savedCalculation", {
    kind: p.kind, name: p.name, inputs: JSON.stringify(p.inputs ?? {}),
  });
  return { id: row.id, kind: p.kind, name: p.name, inputs: p.inputs, createdAt: new Date().toISOString() };
});

route("DELETE /api/calc/saved/:id", ({ params }) => {
  remove("savedCalculation", Number(params.id));
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Retirement
// ---------------------------------------------------------------------------

route("POST /api/retirement/simulate", ({ body }) => ({
  taxYear: 2026,
  ...simulateRetirement(body as never),
}));

route("GET /api/retirement/prefill", () => {
  // Annual spending from the last twelve whole months, same idea as the server.
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  let spending = 0;
  const months = new Set<string>();
  for (const t of allTxns()) {
    const d = asDate(t.date);
    if (d < from || t.isTransfer) continue;
    const cat = categoryDTO(t.categoryId);
    if (cat?.type === "transfer" || cat?.name === "Investment") continue;
    if ((t.amount as number) < 0) {
      spending += -(t.amount as number);
      months.add(ymd(t.date).slice(0, 7));
    }
  }
  const monthsOfData = months.size;
  return {
    annualSpending: monthsOfData ? round2((spending / monthsOfData) * 12) : 0,
    monthsOfData,
  };
});

// ---------------------------------------------------------------------------
// Planner — the deterministic engine works; the local LLM obviously cannot
// ---------------------------------------------------------------------------

const OLLAMA_REASON =
  "The optional local AI needs Ollama running on your own machine, so it can't be part of a demo in a web page. " +
  "Everything else still works: the scenario engine is deterministic and does all the arithmetic — the model only ever narrates it.";

/**
 * The same profile the server builds, from the demo's own transactions.
 *
 * This used to return the string "demo", which the Planner page fed straight
 * into `fmtMoney` — `undefined.toLocaleString` threw during render and React
 * unmounted the route, so the whole page came up blank. A stub that doesn't
 * match the shape it stands in for isn't a stub, it's a crash.
 */
function demoProfile(windowMonths = 12): Profile {
  const series = monthlySeries(Math.min(25, windowMonths + 1));
  const averages = profileAverages(series);
  const now = latestDate();
  const from = new Date(now.getFullYear(), now.getMonth() - averages.monthsOfData, 1);
  const housing = categoryBreakdown(from, now)
    .filter((c) => ["housing", "rent", "mortgage"].includes(c.name.toLowerCase()))
    .reduce((s, c) => s + c.total, 0);
  const liquid = db().goal.reduce((s, g) => s + ((g.currentSaved as number) ?? 0), 0);
  return {
    ...averages,
    avgHousingCost: round2(housing / Math.max(1, averages.monthsOfData)),
    liquidSavings: round2(liquid),
  };
}

route("GET /api/planner/status", () => ({
  profile: demoProfile(),
  ollama: { available: false, model: "llama3.1", reason: OLLAMA_REASON },
}));

// ---- saved conversations: they really save, for this browser session ----

const convoMessages = (row: Record<string, unknown>): unknown[] => {
  try { return JSON.parse(String(row.messages ?? "[]")); } catch { return []; }
};

route("GET /api/planner/conversations", () =>
  db().conversation
    .map((r) => ({
      id: r.id,
      title: r.title as string,
      updatedAt: asDate(r.updatedAt).toISOString(),
      messageCount: convoMessages(r).length,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));

route("GET /api/planner/conversations/:id", ({ params }) => {
  const row = find("conversation", Number(params.id));
  if (!row) throw new DemoHttpError(404, "Conversation not found");
  return { id: row.id, title: row.title, messages: convoMessages(row) };
});

route("POST /api/planner/conversations", ({ body }) => {
  const b = (body ?? {}) as { title?: string; messages?: unknown[] };
  // Prisma fills createdAt/updatedAt from the schema; the in-memory store only
  // does that for rows inserted through the seeding adapter, so handlers set
  // them themselves.
  const now = new Date();
  const row = insert("conversation", {
    title: String(b.title ?? "New conversation"),
    messages: JSON.stringify(b.messages ?? []),
    createdAt: now,
    updatedAt: now,
  });
  return { id: row.id, title: row.title };
});

route("PATCH /api/planner/conversations/:id", ({ params, body }) => {
  const row = find("conversation", Number(params.id));
  if (!row) throw new DemoHttpError(404, "Conversation not found");
  const b = (body ?? {}) as { title?: string; messages?: unknown[] };
  if (b.title != null) row.title = b.title;
  if (b.messages != null) row.messages = JSON.stringify(b.messages);
  row.updatedAt = new Date();
  return { id: row.id, title: row.title };
});

route("DELETE /api/planner/conversations/:id", ({ params }) => {
  remove("conversation", Number(params.id));
  return { ok: true };
});

// ---- chat ----

/**
 * The same two deterministic paths the server tries, in the same order, using
 * the same engine functions — `statsFromSeries` and `runScenario` are pure and
 * imported, not reimplemented.
 *
 * The third path, a local LLM for freeform questions, is the one thing here a
 * web page genuinely cannot do, so it says so instead of inventing an answer.
 * That refusal is the point: the model never does arithmetic in this app, so a
 * demo without it still shows every number the product would show.
 */
route("POST /api/planner/chat", ({ body }) => {
  const message = String((body as { message?: string })?.message ?? "");
  const windowMonths = parseWindowMonths(message) ?? 12;
  const profile = demoProfile(windowMonths);

  const statsIntent = parseStatsIntent(message);
  const stats = statsIntent ? statsFromSeries(message, monthlySeries(statsIntent.months)) : null;
  if (stats) {
    return { source: "engine", title: stats.title, reply: stats.lines.join("\n"), lines: stats.lines, chart: null };
  }

  const scenario = runScenario(profile, message);
  if (scenario) {
    return {
      source: "engine",
      title: scenario.title,
      reply: scenario.lines.join("\n"),
      lines: scenario.lines,
      chart: scenario.chart ?? null,
    };
  }

  return {
    source: "fallback",
    title: null,
    reply: fallbackReply(profile, OLLAMA_REASON),
    lines: [],
    chart: null,
  };
});
