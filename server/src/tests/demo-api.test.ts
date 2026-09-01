/**
 * The hosted demo's in-browser API.
 *
 * The demo exists so a stranger can drive the real app without installing it.
 * That only holds if every screen it ships actually gets an answer — and a
 * screen that throws in a marketing demo is worse than no demo. These tests
 * call the same handlers the browser calls, for every endpoint the client is
 * known to request, so a broken one fails here rather than in front of a
 * visitor.
 *
 * They also pin the properties that make the demo *honest*: the dataset obeys
 * the app's own accounting invariants, and the operations that genuinely can't
 * work in a web page say so instead of pretending.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DemoHttpError, handle, ready } from "../../../client/src/demo/index.js";

const get = (url: string) => handle("GET", url, undefined);
const post = (url: string, body?: unknown) => handle("POST", url, body);

beforeAll(async () => {
  await ready();
}, 30_000);

// ---------------------------------------------------------------------------

describe("the generated world", () => {
  it("has enough history for every screen to have something to show", async () => {
    const txns = (await get("/api/transactions?pageSize=5000")) as { items: unknown[]; total: number };
    expect(txns.total).toBeGreaterThan(500);

    const monthly = (await get("/api/analytics/monthly?months=12")) as { month: string }[];
    // A demo showing three months of history looks like an abandoned project.
    expect(monthly.length).toBeGreaterThanOrEqual(6);

    const accounts = (await get("/api/accounts")) as unknown[];
    expect(accounts.length).toBeGreaterThan(1);
  });

  // This test failed in CI at 00:58 on the 1st of a month, and it was right to.
  // The generated dataset stops at the day it was built and never invents the
  // future, so the "current month" held nothing — and the dashboard, which
  // asked for the current month, came up blank. Not a flaky test: every visitor
  // on the 1st of a month would have seen an empty first screen.
  //
  // The fix is in periodCore: with no month requested, open on the most recent
  // one that has activity. What this test pins is the consequence — the default
  // dashboard always has numbers on it, whatever day it is run.
  it("opens on a month with something in it, whatever the date", async () => {
    const summary = (await get("/api/analytics/summary")) as {
      month: string; income: number; spending: number;
    };
    expect(summary.income).toBeGreaterThan(0);
    expect(summary.spending).toBeGreaterThan(0);
    // And it must be a real month, not silently something else.
    expect(summary.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("obeys the app's accounting invariants, so no screen quietly lies", async () => {
    const summary = (await get("/api/analytics/summary")) as {
      income: number; spending: number; netSavings: number; savingsRate: number;
    };
    expect(summary.income).toBeGreaterThan(0);
    expect(summary.spending).toBeGreaterThan(0);
    // netSavings must be exactly income - spending, or the dashboard is
    // internally inconsistent.
    expect(summary.netSavings).toBeCloseTo(summary.income - summary.spending, 2);
    // A demo where you spend more than you earn every month sells nothing, and
    // one saving 90% is not believable.
    expect(summary.savingsRate).toBeGreaterThan(0);
    expect(summary.savingsRate).toBeLessThan(0.75);
  });

  it("regenerates identically — the same demo for every visitor", async () => {
    const first = (await get("/api/analytics/monthly?months=6")) as unknown[];
    await post("/api/demo/reset");
    const second = (await get("/api/analytics/monthly?months=6")) as unknown[];
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------

describe("every endpoint the client calls answers", () => {
  // Kept as a list rather than one test each: the failure that matters is
  // "this screen is blank", and the screen name is in the URL.
  const endpoints = [
    "/api/settings",
    "/api/categories",
    "/api/merchants",
    "/api/accounts",
    "/api/accounts/status",
    "/api/rules",
    "/api/tags",
    "/api/imports",
    "/api/budgets",
    "/api/goals",
    "/api/transactions?page=1&pageSize=25",
    "/api/analytics/summary",
    "/api/analytics/monthly?months=12",
    "/api/analytics/weekly?weeks=12",
    "/api/analytics/yearly",
    "/api/analytics/categories",
    "/api/analytics/merchants?limit=10",
    "/api/analytics/largest?limit=5",
    "/api/analytics/recurring",
    "/api/analytics/savings",
    "/api/analytics/insights",
    "/api/analytics/csp",
    "/api/analytics/month-breakdown",
    "/api/networth/summary",
    "/api/networth/history?months=12",
    "/api/networth/assets",
    "/api/bills?horizon=30",
    "/api/bills?horizon=90",
    "/api/calc/saved",
    "/api/calc/debts",
    "/api/retirement/prefill",
    "/api/planner/status",
    "/api/planner/conversations",
    "/api/auth/status",
    "/api/profiles",
    "/api/demo/status",
    "/api/settings/export.json",
  ];

  for (const url of endpoints) {
    it(`GET ${url}`, async () => {
      const body = await get(url);
      expect(body, url).toBeDefined();
      expect(body, url).not.toBeNull();
    });
  }

  it("404s an endpoint that doesn't exist, rather than hanging", async () => {
    await expect(get("/api/nonsense")).rejects.toBeInstanceOf(DemoHttpError);
  });
});

// ---------------------------------------------------------------------------

describe("the screens that need a computed engine", () => {
  it("bills projects real upcoming charges from the generated history", async () => {
    const bills = (await get("/api/bills?horizon=30")) as {
      upcoming?: unknown[]; bills?: unknown[]; total?: number;
    };
    // The generator plants recurring subscriptions on purpose, so the bills
    // screen having nothing to show would mean detection is broken.
    const found = (bills.bills ?? bills.upcoming ?? []) as unknown[];
    expect(Array.isArray(found)).toBe(true);
    expect(found.length).toBeGreaterThan(0);
  });

  it("reconcile decomposes a difference and balances against its own numbers", async () => {
    const accounts = (await get("/api/accounts")) as { id: number; balance: number }[];
    const acct = accounts.find((a) => a.balance !== 0) ?? accounts[0];
    const report = (await get(
      `/api/reconcile/summary?accountId=${acct.id}&statementBalance=0&statementDate=2030-01-01&openingBalance=0`,
    )) as { difference: number; residual: number; clearedBalance: number; statementBalance: number };
    // The identity the whole feature rests on.
    expect(report.residual).toBeCloseTo(report.statementBalance - report.clearedBalance, 2);
  });

  it("the retirement simulator runs on the demo's own spending", async () => {
    const prefill = (await get("/api/retirement/prefill")) as { annualSpending: number; monthsOfData: number };
    expect(prefill.monthsOfData).toBeGreaterThan(0);
    expect(prefill.annualSpending).toBeGreaterThan(0);
  });

  // The planner shipped broken and the suite above didn't notice, because
  // "GET /api/planner/status" only had to return something non-null — and
  // `{ profile: "demo" }` is non-null. The page fed that string into fmtMoney,
  // `undefined.toLocaleString` threw during render, and the whole route came up
  // blank. An endpoint answering is not the same as an endpoint answering in
  // the shape its caller reads, so these check the shape and the behaviour.
  it("planner status returns a profile of numbers, not a placeholder", async () => {
    const status = (await get("/api/planner/status")) as {
      profile: Record<string, unknown>;
      ollama: { available: boolean; reason?: string };
    };
    for (const field of [
      "avgMonthlyIncome", "avgMonthlyExpenses", "avgMonthlySavings",
      "savingsRate", "avgHousingCost", "liquidSavings", "monthsOfData",
    ]) {
      expect(typeof status.profile[field], field).toBe("number");
      expect(Number.isFinite(status.profile[field] as number), field).toBe(true);
    }
    expect(status.profile.avgMonthlyIncome as number).toBeGreaterThan(0);
    // Local AI can't run in a web page, and the demo says so rather than pretending.
    expect(status.ollama.available).toBe(false);
    expect(status.ollama.reason).toMatch(/ollama/i);
  });

  it("the scenario engine answers with real arithmetic and a projection", async () => {
    const reply = (await post("/api/planner/chat", {
      message: "Buy a house for $450k with 20% down",
      history: [],
    })) as { source: string; title: string; reply: string; chart: { baseline: number; scenario: number }[] };
    expect(reply.source).toBe("engine");
    expect(reply.reply.length).toBeGreaterThan(40);
    // 20% of $450k plus ~3% closing — the number a visitor can check by hand.
    expect(reply.reply).toMatch(/\$103,500|\$90,000/);
    expect(reply.chart.length).toBeGreaterThan(0);
    // Buying is the expensive branch, so it must end below carrying on as-is.
    const last = reply.chart[reply.chart.length - 1];
    expect(last.scenario).toBeLessThan(last.baseline);
  });

  it("a question the engine can't parse explains itself instead of going quiet", async () => {
    const reply = (await post("/api/planner/chat", {
      message: "what do you think about my life choices",
      history: [],
    })) as { source: string; reply: string };
    expect(reply.source).toBe("fallback");
    expect(reply.reply).toMatch(/ollama/i);
    // And it still tells you what it *can* do, with your own numbers in it.
    expect(reply.reply).toMatch(/Buy a house/);
  });

  it("planner conversations round-trip: save, list, load, update, delete", async () => {
    const messages = [{ role: "user", content: "Buy a $30k car" }];
    const created = (await post("/api/planner/conversations", { title: "Car", messages })) as { id: number };
    const list = (await get("/api/planner/conversations")) as { id: number; messageCount: number }[];
    expect(list.find((c) => c.id === created.id)?.messageCount).toBe(1);

    const loaded = (await get(`/api/planner/conversations/${created.id}`)) as { messages: unknown[] };
    expect(loaded.messages).toHaveLength(1);

    await handle("PATCH", `/api/planner/conversations/${created.id}`, {
      messages: [...messages, { role: "assistant", content: "..." }],
    });
    const reloaded = (await get(`/api/planner/conversations/${created.id}`)) as { messages: unknown[] };
    expect(reloaded.messages).toHaveLength(2);

    await handle("DELETE", `/api/planner/conversations/${created.id}`, undefined);
    const after = (await get("/api/planner/conversations")) as { id: number }[];
    expect(after.find((c) => c.id === created.id)).toBeUndefined();
  });

  it("calculators compute (the engines are the real ones)", async () => {
    const amort = (await post("/api/calc/amortization", {
      principal: 300000, ratePct: 6, years: 30, extraMonthly: 0,
    })) as { monthlyPayment: number };
    // $300k at 6% over 30 years is about $1,799/mo — a wrong wiring would be
    // off by orders of magnitude, not cents.
    expect(amort.monthlyPayment).toBeGreaterThan(1700);
    expect(amort.monthlyPayment).toBeLessThan(1900);
  });
});

// ---------------------------------------------------------------------------

describe("writes actually write", () => {
  it("marking a transaction cleared is visible to the next read", async () => {
    const page = (await get("/api/transactions?pageSize=1")) as { items: { id: number; cleared: boolean }[] };
    const t = page.items[0];
    await handle("PATCH", `/api/transactions/${t.id}`, { cleared: !t.cleared });
    const after = (await get(`/api/transactions?pageSize=200`)) as { items: { id: number; cleared: boolean }[] };
    expect(after.items.find((x) => x.id === t.id)!.cleared).toBe(!t.cleared);
  });

  it("adding a goal shows up in the list", async () => {
    const before = ((await get("/api/goals")) as unknown[]).length;
    await post("/api/goals", { name: "Test goal", targetAmount: 5000, currentSaved: 100, monthlyContribution: 200 });
    expect(((await get("/api/goals")) as unknown[]).length).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------

describe("what the demo refuses to fake", () => {
  const refusals: [string, RegExp][] = [
    ["/api/settings/backup", /no database file/i],
    ["/api/imports/preview", /pre-filled|demo/i],
    ["/api/auth/login", /no accounts/i],
    ["/api/profiles", /separate database file/i],
  ];

  for (const [url, expected] of refusals) {
    it(`${url} explains itself instead of failing silently`, async () => {
      await expect(post(url, {})).rejects.toThrow(expected);
    });
  }

  it("still exports your data, because that is the whole no-lock-in claim", async () => {
    const doc = (await get("/api/settings/export.json")) as {
      format: string; data: { transactions: unknown[] };
    };
    expect(doc.format).toBe("ikid-export");
    expect(doc.data.transactions.length).toBeGreaterThan(100);
  });
});
