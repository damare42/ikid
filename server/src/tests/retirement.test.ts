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

/**
 * The bridge plan's advice is only correct for accounts you can reach before
 * 59½, and the whole reason the bridge exists is that Traditional money can't
 * be. "Invest $279/mo more" carried out inside a Traditional 401k closes none
 * of the gap — it grows the pot that is already locked, while looking like
 * progress. So the destination travels with the number rather than sitting in
 * a footnote under it.
 */
describe("the bridge plan says where the money goes", () => {
  const plan = computeBridgePlan({
    currentAge: 35, retireAge: 48, annualSpending: 48_000,
    ladder: true, realRatePct: 7, haveAtRetirement: 120_000, bridgeTaxes: 10_000,
  });

  it("names accounts reachable before 59½", () => {
    expect(plan.gap).toBeGreaterThan(0);
    expect(plan.monthlyToClose).toBeGreaterThan(0);
    const where = plan.fundIn.join(" ").toLowerCase();
    expect(where).toMatch(/taxable|brokerage/);
    expect(where).toMatch(/roth/);
  });

  it("says Roth *contributions*, not Roth generally", () => {
    // Earnings inside a Roth are not penalty-free before 59½; only the basis
    // is. Saying "Roth" without that distinction is the same class of error as
    // omitting the account entirely.
    expect(plan.fundIn.join(" ")).toMatch(/basis|contribution/i);
  });

  it("names Traditional as the account that does NOT help", () => {
    expect(plan.notIn.join(" ")).toMatch(/traditional/i);
    expect(plan.notIn.join(" ")).toMatch(/59|locked|can't reach|cannot reach/i);
    expect(plan.fundIn.join(" ")).not.toMatch(/traditional/i);
  });

  it("carries the guidance whenever it carries an amount", () => {
    // If there is a number to act on, there is a destination beside it.
    for (const opts of [
      { haveAtRetirement: 0, bridgeTaxes: 0 },
      { haveAtRetirement: 50_000, bridgeTaxes: 25_000 },
    ]) {
      const p = computeBridgePlan({
        currentAge: 40, retireAge: 50, annualSpending: 40_000,
        ladder: false, realRatePct: 5, ...opts,
      });
      if (p.monthlyToClose != null || p.lumpTodayToClose != null) {
        expect(p.fundIn.length).toBeGreaterThan(0);
        expect(p.notIn.length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * The HSA's place in the bridge.
 *
 * An HSA is tax- and penalty-free *for qualified medical expenses* at any age.
 * For anything else before 65 it costs income tax plus a 20% additional tax
 * (IRS Pub 969) — twice the 10% on a Traditional account, and note the
 * threshold is 65, not 59½. So only the part you will actually spend on medical
 * costs during the bridge is genuinely reachable, and counting the whole
 * balance would overstate the one number this calculation exists to produce.
 */
describe("the HSA counts toward the bridge only as far as medical spending", () => {
  const base: RetirementParams = {
    currentAge: 40, retireAge: 50, endAge: 90, filingStatus: "single",
    annualSpending: 40_000, ratePct: 0, ladder: false, fillBracket: 12, rmdAge: 75,
    accounts: {
      trad: { balance: 500_000, contribution: 0 },
      roth: { balance: 0, basis: 0, contribution: 0 },
      brokerage: { balance: 100_000, basisPct: 100, contribution: 0 },
      hsa: { balance: 60_000, contribution: 0, annualMedical: 2_000 },
    },
  };

  it("caps the HSA at medical spend across the bridge years, not the balance", () => {
    // Retiring at 50 leaves 10 bridge years to 60. At $2,000/yr of medical
    // costs only $20,000 of a $60,000 HSA is reachable without the 20% tax.
    const r = simulateRetirement(base);
    expect(r.bridgeAvailableAtRetirement).toBeCloseTo(100_000 + 20_000, -2);
    expect(r.bridgeAvailableAtRetirement).toBeLessThan(100_000 + 60_000);
  });

  it("counts nothing from the HSA when there is no medical spending", () => {
    const r = simulateRetirement({
      ...base,
      accounts: { ...base.accounts, hsa: { balance: 60_000, contribution: 0, annualMedical: 0 } },
    });
    expect(r.bridgeAvailableAtRetirement).toBeCloseTo(100_000, -2);
  });

  it("counts the whole balance only when medical spending would exhaust it", () => {
    // $8,000/yr over 10 bridge years is $80,000 of medical costs against a
    // $60,000 balance — all of it gets spent medically, so all of it counts.
    const r = simulateRetirement({
      ...base,
      accounts: { ...base.accounts, hsa: { balance: 60_000, contribution: 0, annualMedical: 8_000 } },
    });
    expect(r.bridgeAvailableAtRetirement).toBeCloseTo(160_000, -2);
  });

  it("shrinks the HSA's contribution as the bridge shortens", () => {
    const early = simulateRetirement({ ...base, retireAge: 45 });
    const late = simulateRetirement({ ...base, retireAge: 57 });
    const hsaEarly = early.bridgeAvailableAtRetirement - 100_000;
    const hsaLate = late.bridgeAvailableAtRetirement - 100_000;
    expect(hsaLate).toBeLessThan(hsaEarly);
  });

  it("does not tell you to put more into an HSA to close the gap", () => {
    // The mistake this guards against is the one already fixed for Traditional:
    // money that cannot close the gap must not appear as advice that it can.
    // Beyond projected medical costs, extra HSA contributions are capped out of
    // the bridge entirely.
    const plan = computeBridgePlan({
      currentAge: 40, retireAge: 50, annualSpending: 40_000,
      ladder: false, realRatePct: 5, haveAtRetirement: 50_000, bridgeTaxes: 0,
    });
    expect(plan.fundIn.join(" ")).not.toMatch(/HSA/i);
    expect(plan.notIn.join(" ")).toMatch(/HSA/i);
    expect(plan.notIn.join(" ")).toMatch(/20%/);
    expect(plan.notIn.join(" ")).toMatch(/\b65\b/);
  });
});
