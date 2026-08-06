import { describe, expect, it } from "vitest";
import { computeBridgePlan, simulateRetirement, type RetirementParams } from "../services/retirement.js";
import { STANDARD_DEDUCTION } from "../services/tax.js";

/** A well-funded early retiree at 45 with a fat bridge. */
function baseParams(): RetirementParams {
  return {
    currentAge: 40,
    retireAge: 45,
    endAge: 90,
    filingStatus: "single",
    annualSpending: 40_000,
    ratePct: 5,
    accounts: {
      trad: { balance: 500_000, contribution: 20_000 },
      roth: { balance: 150_000, basis: 100_000, contribution: 7_000 },
      brokerage: { balance: 300_000, basisPct: 70, contribution: 20_000 },
      hsa: { balance: 40_000, contribution: 4_000, annualMedical: 3_000 },
    },
    ladder: true,
    fillBracket: 12,
    rmdAge: 75,
    };
}

describe("simulateRetirement", () => {
  it("succeeds with a funded bridge — no penalties, money lasts", () => {
    const r = simulateRetirement(baseParams());
    expect(r.success).toBe(true);
    expect(r.totalPenalties).toBe(0);
    expect(r.depletionAge).toBeNull();
    expect(r.endingBalance).toBeGreaterThan(0);
    expect(r.years[0].phase).toBe("accumulate");
    expect(r.years.at(-1)!.age).toBe(90);
  });

  it("sizes ladder conversions to fill the deduction + 12% bracket", () => {
    const r = simulateRetirement(baseParams());
    const firstRetired = r.years.find((y) => y.phase === "retired")!;
    // No other ordinary income that year → conversion = 16,100 + 50,400
    expect(firstRetired.conversion).toBe(STANDARD_DEDUCTION.single + 50_400);
  });

  it("deduction-only ladder pays zero tax on conversions", () => {
    const p = baseParams();
    p.fillBracket = 0;
    p.accounts.brokerage.basisPct = 100; // no gains → isolate conversion tax
    const r = simulateRetirement(p);
    const y = r.years.find((x) => x.phase === "retired")!;
    expect(y.conversion).toBe(STANDARD_DEDUCTION.single);
    expect(y.tax).toBe(0);
  });

  it("penalizes early Traditional raids when the bridge is empty", () => {
    const p = baseParams();
    p.accounts.roth = { balance: 0, basis: 0, contribution: 0 };
    p.accounts.brokerage = { balance: 0, basisPct: 100, contribution: 0 };
    p.accounts.hsa = { balance: 0, contribution: 0, annualMedical: 0 };
    p.ladder = false;
    const r = simulateRetirement(p);
    expect(r.totalPenalties).toBeGreaterThan(0);
    expect(r.success).toBe(false);
    expect(r.warnings.some((w) => w.includes("penalty"))).toBe(true);
  });

  it("no penalties when retiring after 59½ regardless of bridge", () => {
    const p = baseParams();
    p.currentAge = 55;
    p.retireAge = 62;
    p.accounts.roth = { balance: 0, basis: 0, contribution: 0 };
    p.accounts.brokerage = { balance: 0, basisPct: 100, contribution: 0 };
    const r = simulateRetirement(p);
    expect(r.totalPenalties).toBe(0);
    expect(r.bridgeYears).toBe(0);
  });

  it("forces RMDs from rmdAge and taxes them as ordinary income", () => {
    const p = baseParams();
    p.ladder = false; // keep trad big so RMDs bite
    const r = simulateRetirement(p);
    const atRmd = r.years.find((y) => y.age === p.rmdAge)!;
    expect(atRmd.rmd).toBeGreaterThan(0);
    expect(atRmd.ordinaryIncome).toBeGreaterThanOrEqual(atRmd.rmd);
    const before = r.years.find((y) => y.age === p.rmdAge - 1)!;
    expect(before.rmd).toBe(0);
  });

  it("ladder drains Traditional before RMD age, cutting forced income", () => {
    const withLadder = simulateRetirement(baseParams());
    const p = baseParams();
    p.ladder = false;
    const without = simulateRetirement(p);
    const ladderRmdYear = withLadder.years.find((y) => y.age === 75)!;
    const noLadderRmdYear = without.years.find((y) => y.age === 75)!;
    expect(ladderRmdYear.rmd).toBeLessThan(noLadderRmdYear.rmd);
    expect(withLadder.totalConversions).toBeGreaterThan(0);
  });

  it("ladder conversions season 5 years before joining spendable basis", () => {
    const p = baseParams();
    // Tiny starting Roth basis so maturation is visible
    p.accounts.roth = { balance: 10_000, basis: 5_000, contribution: 0 };
    const r = simulateRetirement(p);
    const conv = r.years.find((y) => y.age === p.retireAge)!.conversion;
    expect(conv).toBeGreaterThan(0);
    const at49 = r.years.find((y) => y.age === p.retireAge + 4)!;
    const at50 = r.years.find((y) => y.age === p.retireAge + 5)!;
    // Basis jumps when the first conversion matures at retireAge + 5
    expect(at50.rothBasisAvailable).toBeGreaterThan(at49.rothBasisAvailable);
  });

  it("reports the bridge math", () => {
    const r = simulateRetirement(baseParams());
    expect(r.bridgeYears).toBe(15); // 60 − 45
    expect(r.bridgeNeeded).toBe(15 * 40_000);
    expect(r.bridgeAvailableAtRetirement).toBeGreaterThan(0);
    expect(r.guidance.length).toBeGreaterThan(2);
  });

  it("produces a bridge plan sized to the ladder seasoning window", () => {
    const withLadder = simulateRetirement(baseParams());
    expect(withLadder.bridgePlan.needed).toBe(true);
    expect(withLadder.bridgePlan.bridgeYears).toBe(15); // 60 − 45
    expect(withLadder.bridgePlan.yearsToFund).toBe(5); // ladder → only 5 yrs self-funded

    const p = baseParams();
    p.ladder = false;
    const noLadder = simulateRetirement(p);
    expect(noLadder.bridgePlan.yearsToFund).toBe(15); // must self-fund the whole gap
    // No-ladder target pot is larger (more years of spending to cover)
    expect(noLadder.bridgePlan.targetPot).toBeGreaterThan(withLadder.bridgePlan.targetPot);
  });
});

describe("computeBridgePlan (pure)", () => {
  const base = {
    currentAge: 35, retireAge: 45, annualSpending: 40_000,
    ladder: true, realRatePct: 5, haveAtRetirement: 0, bridgeTaxes: 0,
  };

  it("targets 5 years of spending with a ladder", () => {
    const plan = computeBridgePlan({ ...base, haveAtRetirement: 0 });
    expect(plan.yearsToFund).toBe(5);
    expect(plan.targetPot).toBe(200_000); // 5 × 40k
    expect(plan.gap).toBe(200_000);
    expect(plan.monthsToRetire).toBe(120);
  });

  it("solves the monthly investment to close the gap (annuity FV)", () => {
    const plan = computeBridgePlan({ ...base, haveAtRetirement: 0 });
    // Reinvest the PMT for 120 months at 5%/yr → should reach ~targetPot
    const r = 5 / 100 / 12;
    const fv = plan.monthlyToClose! * (Math.pow(1 + r, 120) - 1) / r;
    expect(fv).toBeCloseTo(plan.targetPot, -1); // within ~$10
    expect(plan.lumpTodayToClose).toBeCloseTo(plan.gap / Math.pow(1 + r, 120), -1);
  });

  it("reports no gap when the bridge is already funded", () => {
    const plan = computeBridgePlan({ ...base, haveAtRetirement: 250_000 });
    expect(plan.gap).toBe(0);
    expect(plan.monthlyToClose).toBeNull();
  });

  it("needs no bridge when retiring at/after 59½", () => {
    const plan = computeBridgePlan({ ...base, retireAge: 62 });
    expect(plan.needed).toBe(false);
    expect(plan.bridgeYears).toBe(0);
    expect(plan.targetPot).toBe(0);
    expect(plan.gap).toBe(0);
  });

  it("with zero real return, monthly is a simple split", () => {
    const plan = computeBridgePlan({ ...base, realRatePct: 0, haveAtRetirement: 0 });
    expect(plan.monthlyToClose).toBeCloseTo(200_000 / 120, 2);
  });
});

describe("Medicare IRMAA + withdrawal-strategy guidance", () => {
  it("always includes a tax-optimal withdrawal-order tip", () => {
    const r = simulateRetirement(baseParams());
    expect(r.guidance.some((g) => /withdrawal order/i.test(g))).toBe(true);
  });

  it("flags IRMAA when big conversions push MAGI over the tier after 63", () => {
    const p = baseParams();
    p.filingStatus = "single";
    p.fillBracket = 22; // large conversions → MAGI can top ~$109k
    p.accounts.trad.balance = 3_000_000; // plenty to convert late
    const r = simulateRetirement(p);
    expect(r.guidance.some((g) => /IRMAA/.test(g) && /premiums/.test(g))).toBe(true);
  });

  it("reassures when conversions stay under the IRMAA threshold", () => {
    const p = baseParams();
    p.fillBracket = 12; // single 12% bracket top ~$66.5k << $109k
    const r = simulateRetirement(p);
    const irmaaLine = r.guidance.find((g) => /IRMAA/.test(g));
    expect(irmaaLine).toBeDefined();
    expect(irmaaLine).toMatch(/under the first Medicare surcharge/);
  });
});

describe("depletion", () => {
  it("flags depletion when spending is unsustainable", () => {
    const p = baseParams();
    p.annualSpending = 200_000;
    const r = simulateRetirement(p);
    expect(r.success).toBe(false);
    expect(r.depletionAge).not.toBeNull();
    expect(r.guidance.some((g) => g.includes("runs out"))).toBe(true);
  });
});
