/**
 * The standard rules of thumb.
 *
 * Each of these encodes published guidance, so the tests check the guidance is
 * actually implemented — not merely that the function returns a number. Where
 * the app previously had a cruder version, a test pins the difference so the
 * crude one can't come back.
 */
import { describe, expect, it } from "vitest";
import {
  BACK_END_LIMIT, FRONT_END_LIMIT, affordability, emergencyFund, investVsPrepay,
  yearsToIndependence,
} from "../services/planningRules.js";

describe("emergency fund", () => {
  it("sizes on essential spending, not total — the correction that matters", () => {
    // The app previously used avgMonthlyExpenses × 6. For a household spending
    // $5,000 of which $3,200 is essential, that is a $30,000 target where
    // $19,200 is the right one — $10,800 of extra cash held against an
    // emergency that would not include restaurants.
    const r = emergencyFund({
      essentialMonthlyExpenses: 3_200,
      liquidSavings: 0,
      stability: "single-stable",
    });
    expect(r.targetMonths).toBe(6);
    expect(r.targetAmount).toBe(19_200);
    expect(r.targetAmount).toBeLessThan(5_000 * 6);
  });

  it("asks a dual-income household for less and a freelancer for more", () => {
    const base = { essentialMonthlyExpenses: 3_000, liquidSavings: 0 } as const;
    const dual = emergencyFund({ ...base, stability: "dual-stable" }).targetMonths;
    const single = emergencyFund({ ...base, stability: "single-stable" }).targetMonths;
    const variable = emergencyFund({ ...base, stability: "variable" }).targetMonths;
    const owner = emergencyFund({ ...base, stability: "self-employed" }).targetMonths;
    expect(dual).toBeLessThan(single);
    expect(single).toBeLessThan(variable);
    expect(variable).toBeLessThan(owner);
    // "Three to six months" compresses this range; the range is the point.
    expect(dual).toBe(3);
    expect(owner).toBe(12);
  });

  it("tracks progress and how long the gap takes to close", () => {
    const r = emergencyFund({
      essentialMonthlyExpenses: 2_000,
      liquidSavings: 6_000,
      stability: "single-stable",
      monthlySavingsCapacity: 750,
    });
    expect(r.monthsCovered).toBe(3);
    expect(r.status).toBe("building");
    expect(r.shortfall).toBe(6_000);
    expect(r.monthsToTarget).toBe(8);
    expect(r.progress).toBe(0.5);
  });

  it("says when there is too much sitting in cash, not just too little", () => {
    // Over-saving is a real cost that never shows up as a loss, so nothing
    // prompts you to notice it.
    const r = emergencyFund({
      essentialMonthlyExpenses: 2_000, liquidSavings: 40_000, stability: "dual-stable",
    });
    expect(r.status).toBe("beyond");
    expect(r.notes.join(" ")).toMatch(/more than you need|costs you/i);
  });

  it("treats nothing saved as its own situation", () => {
    const r = emergencyFund({
      essentialMonthlyExpenses: 2_500, liquidSavings: 0, stability: "variable",
    });
    expect(r.status).toBe("none");
    expect(r.progress).toBe(0);
    expect(r.notes.join(" ")).toMatch(/becomes debt/i);
  });
});

describe("mortgage affordability", () => {
  const base = {
    grossAnnualIncome: 120_000,
    otherMonthlyDebt: 400,
    downPayment: 80_000,
    homePrice: 400_000,
    annualRatePct: 6.5,
  };

  it("counts the whole cost of owning, not just principal and interest", () => {
    const r = affordability(base);
    // Tax and insurance commonly add 30–40% on top of P&I, and the old scenario
    // engine omitted them entirely when deciding whether a house was affordable.
    expect(r.monthlyTax).toBeGreaterThan(0);
    expect(r.monthlyInsurance).toBeGreaterThan(0);
    expect(r.totalPiti).toBeGreaterThan(r.monthlyPrincipalInterest * 1.2);
  });

  it("adds PMI below 20% down and drops it at 20%", () => {
    const under = affordability({ ...base, downPayment: 40_000 }); // 10%
    const at20 = affordability({ ...base, downPayment: 80_000 }); // 20%
    expect(under.monthlyPmi).toBeGreaterThan(0);
    expect(at20.monthlyPmi).toBe(0);
    expect(under.notes.join(" ")).toMatch(/PMI/);
  });

  it("applies 28/36 against gross income", () => {
    const r = affordability(base);
    const grossMonthly = base.grossAnnualIncome / 12;
    expect(r.frontEndPct).toBeCloseTo((r.totalPiti / grossMonthly) * 100, 1);
    expect(r.backEndPct).toBeCloseTo(
      ((r.totalPiti + base.otherMonthlyDebt) / grossMonthly) * 100, 1,
    );
    expect(r.passesFrontEnd).toBe(r.frontEndPct <= FRONT_END_LIMIT);
    expect(r.passesBackEnd).toBe(r.backEndPct <= BACK_END_LIMIT);
  });

  it("finds a ceiling that itself passes both tests", () => {
    const r = affordability(base);
    const atMax = affordability({ ...base, homePrice: r.maxAffordablePrice });
    expect(atMax.passesFrontEnd).toBe(true);
    expect(atMax.passesBackEnd).toBe(true);
    // And a little more than the ceiling should fail one of them.
    const over = affordability({ ...base, homePrice: r.maxAffordablePrice + 50_000 });
    expect(over.passesFrontEnd && over.passesBackEnd).toBe(false);
  });

  it("lets other debt reduce what the house can cost", () => {
    const clean = affordability({ ...base, otherMonthlyDebt: 0 });
    const loaded = affordability({ ...base, otherMonthlyDebt: 1_500 });
    expect(loaded.maxAffordablePrice).toBeLessThan(clean.maxAffordablePrice);
  });

  it("says what the rule doesn't know", () => {
    // Gross-income underwriting ignores your tax rate and every other goal you
    // have. A number this consequential should carry its own caveat.
    expect(affordability(base).notes.join(" ")).toMatch(/gross income|tax rate|other goals/i);
  });
});

describe("invest vs prepay", () => {
  it("clears high-interest debt without hesitation", () => {
    const r = investVsPrepay({
      debtBalance: 8_000, debtRatePct: 22.9, monthlyAmount: 500, expectedReturnPct: 7,
    });
    expect(r.recommendation).toBe("pay-debt");
    expect(r.notes.join(" ")).toMatch(/double-digit/i);
  });

  it("favours investing against a cheap mortgage, while naming the uncertainty", () => {
    const r = investVsPrepay({
      debtBalance: 300_000, debtRatePct: 3.0, monthlyAmount: 500, expectedReturnPct: 7,
    });
    expect(r.recommendation).toBe("invest");
    // The expectation is not a promise, and the note has to say so.
    expect(r.notes.join(" ")).toMatch(/average|not a promise|certainty/i);
  });

  it("refuses to pick a winner inside the margin", () => {
    // 6% debt against a 7% expectation is not a one-point win for investing —
    // it is a coin toss against a guarantee, and saying so is the honest answer.
    const r = investVsPrepay({
      debtBalance: 20_000, debtRatePct: 6, monthlyAmount: 400, expectedReturnPct: 7,
    });
    expect(r.recommendation).toBe("close-call");
    expect(r.notes.join(" ")).toMatch(/certain/i);
  });

  it("compares after-tax to after-tax", () => {
    const taxed = investVsPrepay({
      debtBalance: 20_000, debtRatePct: 5, monthlyAmount: 400,
      expectedReturnPct: 8, investmentTaxPct: 25,
    });
    expect(taxed.effectiveReturnPct).toBe(6);

    const deductible = investVsPrepay({
      debtBalance: 300_000, debtRatePct: 6, monthlyAmount: 400,
      expectedReturnPct: 7, debtInterestDeductible: true, marginalIncomeTaxPct: 24,
    });
    expect(deductible.effectiveDebtRatePct).toBeCloseTo(4.56, 2);
    // …and flags that the deduction only helps if you itemise.
    expect(deductible.notes.join(" ")).toMatch(/itemise/i);
  });

  it("puts an unclaimed employer match ahead of both", () => {
    // A match is not a return, it is a pay rise being declined. Nothing here
    // competes with it, including 22% credit card debt.
    const r = investVsPrepay({
      debtBalance: 5_000, debtRatePct: 22, monthlyAmount: 300,
      expectedReturnPct: 7, employerMatchPct: 50,
    });
    expect(r.notes[0]).toMatch(/match/i);
    expect(r.notes[0]).toMatch(/first/i);
  });
});

describe("savings rate and time to independence", () => {
  it("reproduces the shockingly simple math", () => {
    // The published table everyone quotes: from zero, at a 5% real return and a
    // 4% withdrawal rate, a 50% savings rate takes about 17 years and 75% takes
    // about 7. If these drift, the closed form is wrong.
    expect(yearsToIndependence(50, 5)).toBeGreaterThan(15);
    expect(yearsToIndependence(50, 5)!).toBeLessThan(19);
    expect(yearsToIndependence(75, 5)!).toBeLessThan(9);
    expect(yearsToIndependence(10, 5)!).toBeGreaterThan(45);
  });

  it("depends on the rate saved, not the income — which is the whole point", () => {
    // Two people saving half their income arrive together, whatever they earn.
    // Everything in the formula is a ratio.
    expect(yearsToIndependence(50, 5)).toBe(yearsToIndependence(50, 5));
    // And a cut in spending counts twice: it raises the rate and lowers the
    // target, so the curve is steeper than intuition suggests.
    const at40 = yearsToIndependence(40, 5)!;
    const at50 = yearsToIndependence(50, 5)!;
    const at60 = yearsToIndependence(60, 5)!;
    expect(at40 - at50).toBeGreaterThan(at50 - at60);
  });

  it("counts a portfolio you already have", () => {
    const fromZero = yearsToIndependence(30, 5, 4, 0)!;
    const partway = yearsToIndependence(30, 5, 4, 10)!;
    expect(partway).toBeLessThan(fromZero);
    expect(yearsToIndependence(30, 5, 4, 25)).toBe(0); // 25× spending = done
  });

  it("handles the ends honestly", () => {
    expect(yearsToIndependence(0, 5)).toBeNull();   // saving nothing never arrives
    expect(yearsToIndependence(100, 5)).toBe(0);    // spending nothing, already there
    expect(yearsToIndependence(50, 0)).toBeGreaterThan(0); // no growth still works
  });

  it("takes longer at a lower withdrawal rate, because the target is bigger", () => {
    expect(yearsToIndependence(40, 5, 3)!).toBeGreaterThan(yearsToIndependence(40, 5, 4)!);
  });
});
