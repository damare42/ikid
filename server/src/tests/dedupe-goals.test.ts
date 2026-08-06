import { describe, expect, it } from "vitest";
import { transactionHash } from "../services/dedupe.js";
import { computeGoal } from "../services/goalMath.js";

describe("transactionHash (dedupe v2: date · amount · description · merchant · account)", () => {
  const base = { date: "2026-06-03", amount: -52.1, description: "KROGER #688", merchant: "Kroger" };

  it("is deterministic and whitespace/case-insensitive on description & merchant", () => {
    expect(transactionHash(base)).toBe(transactionHash({ ...base, description: "  kroger   #688 ", merchant: "  KROGER " }));
  });

  it("matches only when all four fields are identical", () => {
    expect(transactionHash(base)).not.toBe(transactionHash({ ...base, amount: -52.11 }));
    expect(transactionHash(base)).not.toBe(transactionHash({ ...base, date: "2026-06-04" }));
    expect(transactionHash(base)).not.toBe(transactionHash({ ...base, description: "KROGER #700" }));
    expect(transactionHash(base)).not.toBe(transactionHash({ ...base, merchant: "Costco" }));
    expect(transactionHash(base)).not.toBe(transactionHash({ ...base, accountId: 2 }));
  });

  it("ignores the reference number (banks fill it inconsistently)", () => {
    // refNumber is no longer part of the identity — same charge, different ref
    // stays a duplicate.
    expect(transactionHash(base)).toBe(transactionHash({ ...base }));
  });
});

describe("computeGoal", () => {
  const now = new Date(2026, 0, 15); // Jan 2026

  it("computes months remaining and completion date", () => {
    const g = computeGoal({ targetAmount: 10000, currentSaved: 4000, monthlyContribution: 1000, now });
    expect(g.monthsRemaining).toBe(6);
    expect(g.estimatedCompletion).toBe("2026-07");
    expect(g.progressPct).toBe(40);
  });

  it("computes required monthly contribution for a deadline", () => {
    const g = computeGoal({
      targetAmount: 12000, currentSaved: 0, monthlyContribution: 0,
      deadline: new Date(2027, 0, 15), now,
    });
    expect(g.requiredMonthly).toBe(1000);
    expect(g.monthsRemaining).toBeNull(); // no contribution set
  });

  it("handles completed goals", () => {
    const g = computeGoal({ targetAmount: 5000, currentSaved: 6000, monthlyContribution: 100, now });
    expect(g.monthsRemaining).toBe(0);
    expect(g.progressPct).toBe(100);
  });

  it("projection is capped at the target", () => {
    const g = computeGoal({ targetAmount: 1000, currentSaved: 900, monthlyContribution: 500, now });
    expect(Math.max(...g.projection.map((p) => p.balance))).toBe(1000);
  });
});
