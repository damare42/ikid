import { describe, expect, it } from "vitest";
import {
  amortization, coastFire, compoundGrowth, fireProjection, loanPayment, loanPayoff,
} from "../services/finmath.js";

describe("loanPayment", () => {
  it("matches the standard formula", () => {
    // Well-known reference: $320,000 at 6.5% for 30 years ≈ $2,022.62/mo
    expect(loanPayment(320000, 6.5, 30)).toBeCloseTo(2022.62, 1);
    // $200,000 at 5% for 15 years ≈ $1,581.59/mo
    expect(loanPayment(200000, 5, 15)).toBeCloseTo(1581.59, 1);
  });
  it("handles zero interest", () => {
    expect(loanPayment(12000, 0, 1)).toBe(1000);
  });
});

describe("amortization", () => {
  it("pays the loan to zero over the full term", () => {
    const a = amortization(320000, 6.5, 30);
    expect(a.months).toBe(360);
    expect(a.yearly).toHaveLength(30);
    expect(a.yearly[29].balance).toBe(0);
    // total principal across years ≈ principal
    const principalSum = a.yearly.reduce((s, y) => s + y.principalPaid, 0);
    expect(principalSum).toBeCloseTo(320000, 0);
    // 30y at 6.5% roughly doubles the cost — interest ≈ $408k
    expect(a.totalInterest).toBeGreaterThan(390000);
    expect(a.totalInterest).toBeLessThan(420000);
  });

  it("extra payments cut months and interest", () => {
    const base = amortization(320000, 6.5, 30);
    const extra = amortization(320000, 6.5, 30, 300);
    expect(extra.months).toBeLessThan(base.months);
    expect(extra.totalInterest).toBeLessThan(base.totalInterest);
    expect(extra.interestSavedByExtra).toBeCloseTo(base.totalInterest - extra.totalInterest, 1);
    expect(extra.monthsSavedByExtra).toBe(base.months - extra.months);
  });
});

describe("loanPayoff", () => {
  it("projects an existing balance to zero", () => {
    const p = loanPayoff(20000, 7, 500);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.months).toBeGreaterThan(36);
      expect(p.months).toBeLessThan(60);
      expect(p.totalInterest).toBeGreaterThan(0);
    }
  });

  it("rejects payments that don't cover interest", () => {
    const p = loanPayoff(100000, 12, 900); // interest = $1,000/mo
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.minPayment).toBeGreaterThan(1000);
  });
});

describe("fireProjection", () => {
  it("computes the FIRE number from spending and SWR", () => {
    // $40k/yr at a 4% SWR = $1M
    const f = fireProjection({
      currentAge: 30, currentBalance: 100000, monthlyContribution: 2000,
      annualSpending: 40000, ratePct: 5,
    });
    expect(f.fireNumber).toBe(1_000_000);
    expect(f.achievable).toBe(true);
    expect(f.fireAge).toBeGreaterThan(30);
    expect(f.balanceAtFire).toBeGreaterThanOrEqual(1_000_000);
  });

  it("matches contribution-only math at 0% return", () => {
    // Need $900k more at $2k/mo = 450 months → age 67.5
    const f = fireProjection({
      currentAge: 30, currentBalance: 100000, monthlyContribution: 2000,
      annualSpending: 40000, ratePct: 0,
    });
    expect(f.monthsToFire).toBe(450);
    expect(f.fireAge).toBeCloseTo(67.5, 1);
  });

  it("detects already-FIRE and unreachable cases", () => {
    const done = fireProjection({
      currentAge: 50, currentBalance: 2_000_000, monthlyContribution: 0,
      annualSpending: 40000, ratePct: 5,
    });
    expect(done.alreadyFire).toBe(true);
    expect(done.monthsToFire).toBe(0);

    const never = fireProjection({
      currentAge: 50, currentBalance: 10000, monthlyContribution: 0,
      annualSpending: 40000, ratePct: 0,
    });
    expect(never.achievable).toBe(false);
    expect(never.fireAge).toBeNull();
  });
});

describe("coastFire", () => {
  it("discounts the FIRE number back to today", () => {
    // $1M in 30 years at 7% (monthly compounding): 1M / (1+0.07/12)^360
    const c = coastFire({
      currentAge: 30, retireAge: 60, currentBalance: 0, monthlyContribution: 0,
      annualSpending: 40000, ratePct: 7,
    });
    expect(c.fireNumber).toBe(1_000_000);
    expect(c.coastNumber).toBeCloseTo(1_000_000 / Math.pow(1 + 0.07 / 12, 360), 0);
    expect(c.coastNumber).toBeGreaterThan(120_000);
    expect(c.coastNumber).toBeLessThan(126_000);
    expect(c.alreadyCoasting).toBe(false);
  });

  it("recognizes an already-coasting balance and grows it to the FIRE number", () => {
    const c = coastFire({
      currentAge: 30, retireAge: 60, currentBalance: 200_000, monthlyContribution: 0,
      annualSpending: 40000, ratePct: 7,
    });
    expect(c.alreadyCoasting).toBe(true);
    expect(c.surplus).toBeGreaterThan(0);
    expect(c.coastAge).toBe(30);
    expect(c.balanceAtRetirement).toBeGreaterThan(c.fireNumber);
  });

  it("finds the coast age against the rising threshold", () => {
    const c = coastFire({
      currentAge: 30, retireAge: 65, currentBalance: 50_000, monthlyContribution: 1500,
      annualSpending: 40000, ratePct: 6,
    });
    expect(c.alreadyCoasting).toBe(false);
    expect(c.coastAge).not.toBeNull();
    expect(c.coastAge!).toBeGreaterThan(30);
    expect(c.coastAge!).toBeLessThan(65);
    // Contributing until coast age then stopping still lands the FIRE number
    expect(c.balanceAtRetirement).toBeGreaterThanOrEqual(c.fireNumber - 1);
    expect(c.series[0].coastNumber).toBeLessThan(c.series[c.series.length - 1].coastNumber);
  });
});

describe("compoundGrowth", () => {
  it("matches contribution-only math at 0%", () => {
    const c = compoundGrowth(1000, 100, 0, 10);
    expect(c.finalBalance).toBe(1000 + 100 * 120);
    expect(c.totalInterest).toBe(0);
  });

  it("compounds a lump sum correctly", () => {
    // $10,000 at 12% monthly compounding for 1 year = 10000 * 1.01^12 ≈ 11268.25
    const c = compoundGrowth(10000, 0, 12, 1);
    expect(c.finalBalance).toBeCloseTo(11268.25, 0);
  });

  it("interest grows over time with contributions", () => {
    const c = compoundGrowth(0, 500, 7, 20);
    expect(c.series).toHaveLength(21);
    expect(c.totalContributed).toBe(500 * 240);
    expect(c.finalBalance).toBeGreaterThan(c.totalContributed);
    // interest share increases monotonically
    for (let i = 2; i < c.series.length; i++) {
      expect(c.series[i].interest).toBeGreaterThan(c.series[i - 1].interest);
    }
  });
});
