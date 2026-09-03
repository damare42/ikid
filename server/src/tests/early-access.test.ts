/**
 * Routes to retirement money before 59½.
 *
 * Added after a Money Guy Show episode ("5 Ways To Retire Early") pointed out
 * two the app had no notion of: the Rule of 55 and 72(t)/SEPP. Both reach
 * Traditional money before 59½, which the bridge planner had been telling
 * people was impossible — it offered the conversion ladder as the only way out
 * and said flatly that Traditional dollars "don't help the bridge at all".
 *
 * That was worst for the people the page is most for. Someone retiring at 56
 * with everything in their 401k was told to build a five-year ladder when the
 * Rule of 55 would have let them draw on it the day they left.
 *
 * Rules verified against the IRS, not recalled.
 */
import { describe, expect, it } from "vitest";
import {
  earlyAccessRoutes, lifeExpectancy, ruleOf55, sepp,
} from "../services/earlyAccess.js";

describe("Rule of 55", () => {
  it("qualifies on separating in or after the year you turn 55", () => {
    expect(ruleOf55({ separationAge: 55 }).eligible).toBe(true);
    expect(ruleOf55({ separationAge: 58 }).eligible).toBe(true);
    expect(ruleOf55({ separationAge: 54 }).eligible).toBe(false);
  });

  it("uses 50 for qualified public safety employees", () => {
    expect(ruleOf55({ separationAge: 51, publicSafety: true }).eligible).toBe(true);
    expect(ruleOf55({ separationAge: 51 }).eligible).toBe(false);
  });

  it("warns that rolling to an IRA destroys it — the expensive default", () => {
    // Rolling a 401k to an IRA on leaving a job is the standard advice and is
    // usually right. At 55+ with plans to spend it, it forfeits the exception
    // permanently, which makes this the most costly piece of autopilot in the
    // whole area.
    const kept = ruleOf55({ separationAge: 56 });
    expect(kept.warnings.join(" ")).toMatch(/do not roll|forfeit/i);

    const rolled = ruleOf55({ separationAge: 56, rolledToIra: true });
    expect(rolled.eligible).toBe(false);
    expect(rolled.warnings.join(" ")).toMatch(/permanently|ends this/i);
  });

  it("says it covers only the employer you left", () => {
    const r = ruleOf55({ separationAge: 57 });
    expect(r.warnings.join(" ")).toMatch(/previous jobs|only the plan/i);
    expect(r.warnings.join(" ")).toMatch(/IRA/);
  });

  it("does not pretend the tax goes away too", () => {
    expect(ruleOf55({ separationAge: 56 }).reasons.join(" ")).toMatch(/income tax still applies/i);
  });
});

describe("72(t) / SEPP", () => {
  it("pays more under amortization than under the RMD method", () => {
    const amort = sepp({ balance: 500_000, age: 50, method: "amortization" });
    const rmd = sepp({ balance: 500_000, age: 50, method: "rmd" });
    expect(amort.annualPayment).toBeGreaterThan(rmd.annualPayment);
    // RMD method is balance ÷ life expectancy, exactly.
    expect(rmd.annualPayment).toBeCloseTo(500_000 / lifeExpectancy(50), 0);
  });

  it("leads with the commitment, because that is the actual decision", () => {
    const r = sepp({ balance: 400_000, age: 45 });
    // Longer of five years or until 59½ — at 45 that is 14.5 years.
    expect(r.commitmentYears).toBeCloseTo(14.5, 1);
    expect(r.endsAtAge).toBeCloseTo(59.5, 1);
    expect(r.warnings[0]).toMatch(/locked in/i);
    expect(r.warnings.join(" ")).toMatch(/recapture/i);
    expect(r.warnings.join(" ")).toMatch(/retroactively/i);
  });

  it("uses five years when that is the longer period", () => {
    // Starting at 58, 59½ is only 1.5 years away, so the five-year floor binds.
    const r = sepp({ balance: 300_000, age: 58 });
    expect(r.commitmentYears).toBe(5);
    expect(r.endsAtAge).toBe(63);
  });

  it("suggests splitting the account to limit the blast radius", () => {
    // Running the series on a partial IRA leaves the rest flexible, which is
    // the standard mitigation for an irreversible commitment.
    expect(sepp({ balance: 800_000, age: 48 }).warnings.join(" ")).toMatch(/split/i);
  });

  it("scales with the balance and falls with age", () => {
    const small = sepp({ balance: 100_000, age: 50 });
    const big = sepp({ balance: 200_000, age: 50 });
    expect(big.annualPayment).toBeCloseTo(small.annualPayment * 2, 0);
    // Older start, shorter life expectancy, bigger payment per dollar.
    const older = sepp({ balance: 100_000, age: 58 });
    expect(older.annualPayment).toBeGreaterThan(small.annualPayment);
  });

  it("interpolates life expectancy between table rows", () => {
    expect(lifeExpectancy(50)).toBe(36.2);
    expect(lifeExpectancy(55)).toBe(31.6);
    const between = lifeExpectancy(52);
    expect(between).toBeLessThan(36.2);
    expect(between).toBeGreaterThan(31.6);
  });
});

describe("which routes are open", () => {
  const base = {
    currentAge: 45, retireAge: 50, taxableBalance: 200_000,
    rothBasis: 60_000, tradBalance: 600_000,
  };

  it("orders them by how little they cost you in flexibility", () => {
    const routes = earlyAccessRoutes(base);
    const order = routes.map((r) => r.flexibility);
    // Free things first, the binding one last. Nobody should reach for a SEPP
    // while a taxable account is sitting there.
    expect(order[0]).toBe("free");
    expect(order[order.length - 1]).toBe("binding");
    expect(routes[routes.length - 1].key).toBe("sepp");
  });

  it("opens the Rule of 55 for someone leaving at 56, and closes it at 50", () => {
    const early = earlyAccessRoutes({ ...base, retireAge: 50 });
    const later = earlyAccessRoutes({ ...base, retireAge: 56 });
    expect(early.find((r) => r.key === "rule-of-55")!.available).toBe(false);
    expect(later.find((r) => r.key === "rule-of-55")!.available).toBe(true);
  });

  it("puts no dollar figure on the Rule of 55, because it cannot know one", () => {
    // The plan carries a single pre-tax pot — 401k and Traditional IRA merged.
    // The exception reaches only the employer plan. Showing the pot beside the
    // rule would promise IRA money the rule does not reach, and nothing in the
    // inputs says how the balance splits. Better to name the route and say what
    // it excludes than to print a confident wrong number.
    const r55 = earlyAccessRoutes({ ...base, retireAge: 56 }).find((r) => r.key === "rule-of-55")!;
    expect(r55.available).toBe(true);
    expect(r55.amount).toBeNull();
    expect(r55.summary).toMatch(/Traditional IRA is still locked/i);
    expect(r55.summary).toMatch(/rolling.*would forfeit/i);
  });

  it("only offers the ladder when there is time to season it", () => {
    // Five years of seasoning needs more than five years of bridge.
    const tight = earlyAccessRoutes({ ...base, retireAge: 56 });
    const roomy = earlyAccessRoutes({ ...base, retireAge: 45 });
    expect(tight.find((r) => r.key === "conversion-ladder")!.available).toBe(false);
    expect(roomy.find((r) => r.key === "conversion-ladder")!.available).toBe(true);
  });

  it("distinguishes Roth basis from the whole Roth balance", () => {
    const roth = earlyAccessRoutes(base).find((r) => r.key === "roth-basis")!;
    expect(roth.amount).toBe(base.rothBasis);
    expect(roth.summary).toMatch(/earnings do not|earnings.*59/i);
  });

  it("closes everything pre-tax when there is no pre-tax money", () => {
    const routes = earlyAccessRoutes({ ...base, tradBalance: 0, retireAge: 56 });
    for (const key of ["rule-of-55", "conversion-ladder", "sepp"]) {
      expect(routes.find((r) => r.key === key)!.available).toBe(false);
    }
  });
});
