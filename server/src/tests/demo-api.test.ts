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
