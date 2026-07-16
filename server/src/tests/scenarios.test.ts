import { describe, expect, it } from "vitest";
import {
  bigEvent, buyHouse, expenseChange, investGrowth, loanMonthly, parseIntent, parseMoney,
  parseStatsIntent, parseWindowMonths, stopWork, type Profile,
} from "../services/scenarios.js";

const profile: Profile = {
  avgMonthlyIncome: 6800,
  avgMonthlyExpenses: 5000,
  avgMonthlySavings: 1800,
  savingsRate: 0.26,
  avgHousingCost: 1650,
  liquidSavings: 30000,
  monthsOfData: 8,
};

describe("loanMonthly", () => {
  it("matches the standard amortization formula", () => {
    // $320k at 6.5% for 30 years ≈ $2,022.62
    expect(loanMonthly(320000, 6.5, 30)).toBeCloseTo(2022.62, 0);
  });
  it("handles zero interest", () => {
    expect(loanMonthly(12000, 0, 1)).toBe(1000);
  });
});

describe("parseMoney", () => {
  it("parses plain, comma, k and m formats", () => {
    expect(parseMoney("buy a house for $400,000")).toBe(400000);
    expect(parseMoney("a 450k house")).toBe(450000);
    expect(parseMoney("$1.2m home")).toBe(1200000);
    expect(parseMoney("no numbers here")).toBeNull();
  });

  it("does not mistake durations or small bare numbers for money", () => {
    expect(parseMoney("cover 6 months of expenses")).toBeNull();
    expect(parseMoney("over 30 years")).toBeNull();
    expect(parseMoney("save 10%")).toBeNull();
    expect(parseMoney("in 18 months I want $5k")).toBe(5000);
  });
});

describe("parseIntent", () => {
  it("detects scenario kinds and params", () => {
    expect(parseIntent("Buy a house for $450k with 10% down")).toMatchObject({
      kind: "house",
      params: { price: 450000, downPct: 10 },
    });
    expect(parseIntent("wedding costing $20k in 18 months")).toMatchObject({
      kind: "event",
      params: { cost: 20000, monthsUntil: 18 },
    });
    expect(parseIntent("what if I stop working for 8 months")).toMatchObject({
      kind: "stopwork",
      params: { months: 8 },
    });
    expect(parseIntent("hello there")).toBeNull();
  });

  it("detects emergency-fund questions instead of misreading them as expense changes", () => {
    expect(parseIntent("how much do I save to cover 6 month expense")).toMatchObject({
      kind: "emergency",
      params: { months: 6 },
    });
    expect(parseIntent("build an emergency fund")).toMatchObject({ kind: "emergency" });
  });

  it("sends vague money-free questions to the LLM instead of guessing", () => {
    // no dollar amount and no clear scenario → null (falls through to Ollama)
    expect(parseIntent("what should I do about my expenses")).toBeNull();
    expect(parseIntent("how are my spending habits")).toBeNull();
  });
});

describe("parseWindowMonths", () => {
  it("parses digit and word windows", () => {
    expect(parseWindowMonths("use the last six months to estimate")).toBe(6);
    expect(parseWindowMonths("past 3 months")).toBe(3);
    expect(parseWindowMonths("this year so far")).toBe(new Date().getMonth() + 1);
    expect(parseWindowMonths("cover 6 months of expenses")).toBeNull(); // fund size, not a window
  });
});

describe("parseStatsIntent", () => {
  it("detects plain data questions with a month window (typos included)", () => {
    expect(parseStatsIntent("what is my expenses for the last 6 monthes")).toEqual({ months: 6 });
    expect(parseStatsIntent("how much did I spend last 3 months")).toEqual({ months: 3 });
    expect(parseStatsIntent("show my savings year to date")).toEqual({ months: new Date().getMonth() + 1 });
  });

  it("does not steal scenario questions", () => {
    expect(parseStatsIntent("what if my expenses go up $800")).toBeNull();
    expect(parseStatsIntent("how much do I need to cover 6 months of expenses")).toBeNull();
    expect(parseStatsIntent("buy a house for $450k")).toBeNull();
  });
});

describe("invest intent + compound growth", () => {
  it("parses monthly contribution, rate, and years", () => {
    expect(parseIntent("Invest $500 a month at 7% for 20 years")).toMatchObject({
      kind: "invest",
      params: { monthly: 500, ratePct: 7, years: 20 },
    });
    // Large one-off amount without "per month" is a starting principal
    expect(parseIntent("invest $50,000 at 6% for 10 years")).toMatchObject({
      kind: "invest",
      params: { principal: 50000, ratePct: 6, years: 10 },
    });
    // "% down" must not be read as a return rate
    expect(parseIntent("buy a house for $450k with 10% down")).toMatchObject({ kind: "house" });
  });

  it("is not stolen by the stats parser", () => {
    expect(parseStatsIntent("how much will my savings grow if I invest $500 a month")).toBeNull();
  });

  it("computes compound growth with the tested engine", () => {
    const r = investGrowth(profile, { monthly: 500, ratePct: 7, years: 20 });
    // 500/mo at 7%/yr for 20y ≈ $260.5k (end-of-month contributions)
    expect(r.lines[0]).toMatch(/\$2[456]\d,\d{3}/);
    expect(r.lines[1]).toContain("$120,000"); // contributions
    expect(r.chart).toBeDefined();
    expect(r.chart!.length).toBe(21); // year 0..20
    expect(r.chart![20].scenario).toBeGreaterThan(r.chart![20].baseline);
  });
});

describe("buyHouse", () => {
  it("computes upfront cash and post-purchase savings", () => {
    const r = buyHouse(profile, { price: 400000, downPct: 20, ratePct: 6.5, years: 30 });
    // 80k down + 12k closing = 92k upfront; gap 62k / 1800 ≈ 35 months
    expect(r.lines[0]).toContain("$92,000");
    expect(r.lines[1]).toContain("35 months");
    expect(r.chart).toBeDefined();
    expect(r.chart![0].baseline).toBe(30000);
  });
});

describe("stopWork", () => {
  it("computes runway from liquid savings", () => {
    const r = stopWork(profile, { months: 6 });
    expect(r.lines[0]).toContain("6 months of runway"); // 30000/5000
    expect(r.lines[1]).toContain("covered");
  });
});

describe("bigEvent", () => {
  it("flags shortfalls", () => {
    const r = bigEvent(profile, { cost: 60000, monthsUntil: 12, label: "wedding" });
    expect(r.lines[0]).toContain("$5,000/mo");
    expect(r.lines[1]).toContain("shortfall");
  });
});

describe("expenseChange", () => {
  it("computes new monthly savings", () => {
    const r = expenseChange(profile, 800);
    expect(r.lines[1]).toContain("$1,000");
  });
});
