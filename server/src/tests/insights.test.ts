/**
 * The insight heuristics.
 *
 * These exist because the heuristics shipped twice. `generateInsights` was pure
 * below its fetches, so the hosted demo — which can't import Prisma — had
 * written a shorter version, and the two disagreed in ways that quietly made
 * the product look worse than it is:
 *
 *   - the demo asked for a $40 *and* 25% movement; the product asks $25 and 10%
 *   - the demo compared the *running* month against the previous complete one,
 *     so on any day but the last of the month everything read as "down"
 *   - the demo produced only category movements: no merchant movement, no
 *     unused-subscription warnings, no recurring total, no dining opportunity
 *
 * The thresholds below are judgements, not facts. What these tests pin is that
 * they are applied consistently and that each rule fires on the case it was
 * written for — including the boundaries, which is where a "tidy-up" quietly
 * changes behaviour.
 */
import { describe, expect, it } from "vitest";
import { THRESHOLDS, buildInsights, type InsightInputs } from "../services/insightsCore.js";

const empty: InsightInputs = {
  currentCategories: [], previousCategories: [],
  currentMerchants: [], previousMerchants: [],
  series: [], recurring: [],
};
const ids = (i: ReturnType<typeof buildInsights>) => i.map((x) => x.id);

describe("buildInsights", () => {
  it("says nothing when there is nothing to say", () => {
    expect(buildInsights(empty)).toEqual([]);
  });

  it("reports a category movement that clears both bars", () => {
    const out = buildInsights({
      ...empty,
      currentCategories: [{ name: "Dining", total: 200, count: 8 }],
      previousCategories: [{ name: "Dining", total: 100 }],
    });
    expect(ids(out)).toContain("cat-Dining");
    expect(out[0].title).toBe("Dining increased 100%");
    expect(out[0].amount).toBe(100);
  });

  it("ignores a big percentage on a small base", () => {
    // Tripling a $10 category is a 200% rise and $20 of actual money. The
    // percentage bar passes; the cash bar is what stops it being reported.
    const out = buildInsights({
      ...empty,
      currentCategories: [{ name: "Coffee", total: 30, count: 3 }],
      previousCategories: [{ name: "Coffee", total: 10 }],
    });
    expect(ids(out)).not.toContain("cat-Coffee");
  });

  it("ignores a big number on a large base", () => {
    // $30 more rent is real money but a 1.5% move — not news.
    const out = buildInsights({
      ...empty,
      currentCategories: [{ name: "Housing", total: 2030, count: 1 }],
      previousCategories: [{ name: "Housing", total: 2000 }],
    });
    expect(ids(out)).not.toContain("cat-Housing");
  });

  it("skips categories that barely existed last month", () => {
    const out = buildInsights({
      ...empty,
      currentCategories: [{ name: "Travel", total: 500, count: 1 }],
      previousCategories: [{ name: "Travel", total: THRESHOLDS.minPreviousCategory - 1 }],
    });
    expect(ids(out)).not.toContain("cat-Travel");
  });

  it("reports the largest merchant movement, and only that one", () => {
    const out = buildInsights({
      ...empty,
      currentMerchants: [
        { name: "Big Mover", total: 300, count: 4 },
        { name: "Small Mover", total: 90, count: 2 },
      ],
      previousMerchants: [
        { name: "Big Mover", total: 100 },
        { name: "Small Mover", total: 50 },
      ],
    });
    const moves = ids(out).filter((i) => i.startsWith("merch-"));
    expect(moves).toEqual(["merch-Big Mover"]);
  });

  it("flags a subscription that stopped being used but not being charged", () => {
    const out = buildInsights({
      ...empty,
      recurring: [
        { merchant: "Ghost Gym", avgAmount: 40, lastDate: "2026-01-02", active: false, monthlyEstimate: 40 },
      ],
    });
    expect(ids(out)).toContain("stale-Ghost Gym");
    expect(out.find((i) => i.id === "stale-Ghost Gym")!.kind).toBe("warning");
  });

  it("totals active recurring spend as an opportunity, not a warning", () => {
    const out = buildInsights({
      ...empty,
      recurring: [
        { merchant: "A", avgAmount: 10, lastDate: "2026-08-01", active: true, monthlyEstimate: 10 },
        { merchant: "B", avgAmount: 15, lastDate: "2026-08-02", active: true, monthlyEstimate: 15 },
      ],
    });
    const rec = out.find((i) => i.id === "recurring-total")!;
    expect(rec.kind).toBe("opportunity");
    expect(rec.title).toContain("$25");
    expect(rec.detail).toContain("$300/year"); // 25 × 12
  });

  it("only suggests cutting dining once it is worth cutting", () => {
    const under = buildInsights({
      ...empty,
      currentCategories: [{ name: "Dining", total: THRESHOLDS.minDiningTotal, count: 5 }],
    });
    expect(ids(under)).not.toContain("dining-opportunity");
    const over = buildInsights({
      ...empty,
      currentCategories: [
        { name: "Dining", total: 200, count: 9 },
        { name: "Coffee", total: 60, count: 20 },
      ],
    });
    expect(ids(over)).toContain("dining-opportunity");
  });

  it("never treats the running month as a complete one", () => {
    // The last entry of the series is the month in progress. Calling it the
    // highest-spending month, or averaging it in, understates both.
    const out = buildInsights({
      ...empty,
      series: [
        { month: "2026-06", expenses: 3000 },
        { month: "2026-07", expenses: 3200 },
        { month: "2026-08", expenses: 400 }, // three days in
      ],
    });
    expect(out.find((i) => i.id === "highest-month")!.title).toContain("2026-07");
    // Average over the two complete months = 3100, not (3000+3200+400)/3.
    expect(out.find((i) => i.id === "yearly-estimate")!.detail).toContain("$3,100");
  });

  it("needs two complete months before it will talk about trends", () => {
    const out = buildInsights({ ...empty, series: [{ month: "2026-08", expenses: 900 }] });
    expect(ids(out)).not.toContain("highest-month");
    expect(ids(out)).not.toContain("yearly-estimate");
  });
});
