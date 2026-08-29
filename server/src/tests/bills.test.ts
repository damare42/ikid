/**
 * Bills & renewal calendar — projection engine.
 *
 * Every test here runs against the pure functions in services/billsService.ts:
 * no Prisma, no ambient clock. Dates are passed in explicitly, so a test that
 * passes today passes in 2031, and the assertions are exact values rather than
 * "is defined".
 */
import { describe, expect, it } from "vitest";
import {
  addMonthsClamped,
  averageMonthlySurplus,
  buildBill,
  buildBillsSummary,
  calendarJitter,
  classifyStatus,
  clusterDaysOfMonth,
  daysBetween,
  detectPriceChanges,
  disambiguateFortnightly,
  fromDayNumber,
  graceDays,
  inferCadence,
  isVariableAmount,
  median,
  priceLevels,
  priceTolerance,
  projectOccurrences,
  spread,
  toDayNumber,
  type BuildBillOptions,
  type Charge,
  type MerchantCharges,
  type MonthlyNetPoint,
} from "../services/billsService.js";

// --------------------------------------------------------------- fixtures

let nextId = 1;
/** Build a charge list from [date, amount] pairs, with stable ids. */
const charges = (rows: [string, number][]): Charge[] =>
  rows.map(([date, amount]) => ({ id: nextId++, date, amount }));

/** Same amount on a run of dates. */
const flat = (dates: string[], amount: number): Charge[] =>
  charges(dates.map((d) => [d, amount] as [string, number]));

const OPTS = (over: Partial<BuildBillOptions> = {}): BuildBillOptions => ({
  today: "2025-06-20",
  observedThrough: "2025-06-20",
  horizonDays: 30,
  ...over,
});

/** Northbrook Streaming: monthly on the 12th, repriced twice. */
const NORTHBROOK: MerchantCharges = {
  merchant: "Northbrook Streaming",
  merchantId: 7,
  charges: charges([
    ["2025-01-12", 15.49],
    ["2025-02-12", 15.49],
    ["2025-03-12", 17.99],
    ["2025-04-12", 17.99],
    ["2025-05-12", 17.99],
    ["2025-06-12", 19.99],
  ]),
};

// --------------------------------------------------------------- date maths

describe("date helpers", () => {
  it("round-trips day numbers", () => {
    expect(fromDayNumber(toDayNumber("2025-06-20"))).toBe("2025-06-20");
    expect(toDayNumber("1970-01-01")).toBe(0);
  });

  it("counts days without being fooled by daylight saving", () => {
    // US clocks changed on 2025-03-09. Local-time arithmetic returns 1.958
    // days here and floors to 1; UTC arithmetic returns 2.
    expect(daysBetween("2025-03-08", "2025-03-10")).toBe(2);
    expect(daysBetween("2025-06-20", "2025-06-12")).toBe(-8);
  });

  it("clamps month arithmetic to the target month's length", () => {
    expect(addMonthsClamped("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29"); // leap year
    expect(addMonthsClamped("2025-01-31", 3)).toBe("2025-04-30");
    expect(addMonthsClamped("2025-12-15", 1)).toBe("2026-01-15"); // year rolls
    expect(addMonthsClamped("2025-03-15", -1)).toBe("2025-02-15");
  });

  it("steps from the original anchor, so a clamp never becomes permanent", () => {
    // Charged on the 31st: February clamps to the 28th, but March must go back
    // to the 31st. Iterating month-by-month from the clamped value would give
    // 2025-03-28 and drift three days earlier every February.
    expect(addMonthsClamped("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonthsClamped("2025-01-31", 2)).toBe("2025-03-31");
  });
});

describe("median / spread", () => {
  it("computes exact values", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("absorbs one outlier — a weekly bill that skipped a week is still weekly", () => {
    expect(spread([7, 7, 14, 7, 7])).toBe(0);
  });

  it("but does notice when most values are off, unlike a median deviation", () => {
    // Days of the month for a bill charged on the 3rd, 9th, 2nd, 10th, 4th.
    // The median absolute deviation is 2, which would read as "±2 days"; the
    // truth is closer to a working week.
    expect(spread([3, 9, 2, 10, 4])).toBe(5);
  });

  it("returns zero for a perfectly regular series", () => {
    expect(spread([12, 12, 12, 12])).toBe(0);
    expect(spread([])).toBe(0);
  });
});

// --------------------------------------------------------------- cadence

describe("inferCadence", () => {
  it("names a clean monthly subscription and gives it a zero-day window", () => {
    const fit = inferCadence([
      "2025-01-12", "2025-02-12", "2025-03-12", "2025-04-12", "2025-05-12", "2025-06-12",
    ]);
    expect(fit.cadence).toBe("monthly");
    expect(fit.medianGapDays).toBe(31);
    expect(fit.jitterDays).toBe(0); // always the 12th
    expect(fit.windowDays).toBe(0);
    expect(fit.confidence).toBe("high");
  });

  it("survives a skipped month — the median gap holds where the mean would not", () => {
    const dates = ["2025-01-05", "2025-02-05", "2025-04-05", "2025-05-05", "2025-06-05"];
    const gaps = [31, 59, 30, 31];
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    expect(mean).toBe(37.75); // a mean-based cycle would be 7 days too long
    const fit = inferCadence(dates);
    expect(fit.cadence).toBe("monthly");
    expect(fit.medianGapDays).toBe(31);
    expect(fit.confidence).toBe("high");
  });

  it("names an annual renewal across a leap year", () => {
    const fit = inferCadence(["2022-03-15", "2023-03-15", "2024-03-15", "2025-03-15"]);
    expect(fit.cadence).toBe("annual");
    expect(fit.medianGapDays).toBe(365);
    // 3 intervals is real evidence but not the 4 we require for "high" — an
    // annual bill simply cannot earn high confidence inside five years.
    expect(fit.confidence).toBe("medium");
  });

  it("tells semimonthly apart from biweekly by structure, not spacing", () => {
    // Both have a ~15-day gap. The 1st-and-15th bill holds two days of the
    // month; the fortnightly one holds a weekday and walks through the month.
    const semi = ["2025-01-01", "2025-01-15", "2025-02-01", "2025-02-15", "2025-03-01", "2025-03-15"];
    const fort = ["2025-01-01", "2025-01-15", "2025-01-29", "2025-02-12", "2025-02-26", "2025-03-12"];
    expect(inferCadence(semi).cadence).toBe("semimonthly");
    expect(inferCadence(fort).cadence).toBe("biweekly");
    expect(disambiguateFortnightly(semi)).toBe("semimonthly");
    expect(disambiguateFortnightly(fort)).toBe("biweekly");
    // Both fixtures have the same median gap, so spacing alone cannot decide.
    expect(inferCadence(semi).medianGapDays).toBe(inferCadence(fort).medianGapDays);
  });

  it("names weekly and quarterly cycles", () => {
    expect(
      inferCadence(["2025-01-06", "2025-01-13", "2025-01-20", "2025-01-27", "2025-02-03"]).cadence,
    ).toBe("weekly");
    expect(
      inferCadence(["2024-01-15", "2024-04-15", "2024-07-15", "2024-10-15", "2025-01-15"]).cadence,
    ).toBe("quarterly");
  });

  it("refuses to name a cycle for scattered spending", () => {
    // A coffee shop. The median gap (8 days) is close enough to "weekly" to
    // match on spacing alone — it's the jitter check that rejects it.
    const fit = inferCadence([
      "2025-01-03", "2025-01-04", "2025-01-19", "2025-02-02", "2025-02-27", "2025-03-01",
    ]);
    expect(fit.cadence).toBe("irregular");
    expect(fit.confidence).toBe("low");
  });

  it("refuses a 21-day gap rather than rounding it to monthly", () => {
    expect(inferCadence(["2025-01-01", "2025-01-22", "2025-02-12", "2025-03-05"]).cadence)
      .toBe("irregular");
  });

  it("drops confidence when the charge date wanders", () => {
    // Same month, but the day moves by up to a week.
    const fit = inferCadence(["2025-01-03", "2025-02-09", "2025-03-02", "2025-04-10", "2025-05-04"]);
    expect(fit.cadence).toBe("monthly");
    expect(fit.confidence).toBe("medium");
    expect(fit.windowDays).toBe(5); // and the UI shows "±5 days", not a date
  });

  it("still gives high confidence to a bill that shifts off one weekend", () => {
    // Charged on the 3rd; May 3rd 2025 was a Saturday, so it posted on the 5th.
    const fit = inferCadence([
      "2025-01-03", "2025-02-03", "2025-03-03", "2025-04-03", "2025-05-05", "2025-06-03",
    ]);
    expect(fit.confidence).toBe("high");
    expect(fit.windowDays).toBe(0);
  });
});

describe("clusterDaysOfMonth / calendarJitter", () => {
  it("groups two anchors and merges the month-end wrap", () => {
    expect(clusterDaysOfMonth([1, 15, 1, 15], 2).map((c) => c.length)).toEqual([2, 2]);
    // 31st and 1st are the same anchor either side of month end.
    expect(clusterDaysOfMonth([31, 1, 31, 1], 2)).toHaveLength(1);
  });

  it("measures semimonthly jitter against the nearer anchor, not the raw spread", () => {
    const semi = ["2025-01-01", "2025-01-15", "2025-02-01", "2025-02-15"];
    // Treated as one anchor, the days-of-month look 7 days apart from centre.
    expect(spread(semi.map((d) => Number(d.slice(8))))).toBe(7);
    expect(calendarJitter(semi, "semimonthly")).toBe(0);
  });
});

// --------------------------------------------------------------- price changes

describe("price tracking", () => {
  it("uses a floor and a ratio so neither small nor large bills mis-flag", () => {
    expect(priceTolerance(9.99)).toBe(0.25); // 2% would be 20c — too twitchy
    expect(priceTolerance(220)).toBeCloseTo(4.4, 6); // a $1 wobble is not news
  });

  it("finds both increases on a subscription that repriced twice", () => {
    const changes = detectPriceChanges(NORTHBROOK.charges);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({
      date: "2025-03-12",
      from: 15.49,
      to: 17.99,
      deltaPct: 16.1,
      chargesAtNewPrice: 3,
    });
    expect(changes[1]).toEqual({
      date: "2025-06-12",
      from: 17.99,
      to: 19.99,
      deltaPct: 11.1,
      chargesAtNewPrice: 1, // brand new — real, but not yet repeated
    });
  });

  it("ignores a one-off purchase from a merchant you also subscribe to", () => {
    // $89 in the middle is a thing you bought, not the plan changing price.
    const c = charges([
      ["2025-01-10", 15.49],
      ["2025-02-10", 15.49],
      ["2025-02-20", 89.0],
      ["2025-03-10", 15.49],
      ["2025-04-10", 15.49],
      ["2025-05-10", 15.49],
    ]);
    expect(detectPriceChanges(c)).toEqual([]);
    expect(priceLevels(c)).toHaveLength(1);
    expect(isVariableAmount(c)).toBe(false);
  });

  it("does not flag rounding-sized wobble", () => {
    const c = flat(["2025-01-10", "2025-02-10", "2025-03-10", "2025-04-10"], 12.0);
    c[2].amount = 12.15; // 15c on a $12 bill
    expect(detectPriceChanges(c)).toEqual([]);
  });

  it("flags a 50c-a-month creep on a small subscription", () => {
    const c = charges([
      ["2025-01-10", 9.99],
      ["2025-02-10", 9.99],
      ["2025-03-10", 10.49],
      ["2025-04-10", 10.49],
    ]);
    expect(detectPriceChanges(c)).toHaveLength(1);
    expect(detectPriceChanges(c)[0].to).toBe(10.49);
  });

  it("calls a utility bill variable rather than reporting five price changes", () => {
    const power = charges([
      ["2025-01-08", 112.4],
      ["2025-02-08", 98.15],
      ["2025-03-08", 143.77],
      ["2025-04-08", 87.02],
      ["2025-05-08", 131.55],
      ["2025-06-08", 105.6],
    ]);
    expect(isVariableAmount(power)).toBe(true);
    const bill = buildBill({ merchant: "City Power", merchantId: 3, charges: power }, OPTS())!;
    expect(bill.variableAmount).toBe(true);
    expect(bill.priceChanges).toEqual([]);
    // No current price exists, so the estimate is the median of the last three.
    expect(bill.expectedAmount).toBe(105.6);
    expect(bill.amountRange).toEqual({ min: 87.02, max: 143.77 });
  });

  it("two changes in six charges is still a fixed-price bill", () => {
    expect(isVariableAmount(NORTHBROOK.charges)).toBe(false);
  });
});

// --------------------------------------------------------------- status

describe("classifyStatus / graceDays", () => {
  it("scales grace with the cycle but floors and caps it", () => {
    expect(graceDays(7)).toBe(5); // weekly: a long weekend, not 1.75 days
    expect(graceDays(365.25)).toBe(30); // annual: capped, or "stopped" is useless
    expect(graceDays(30.4375)).toBeCloseTo(7.609, 3);
  });

  it("moves from active to late to stopped at the cycle boundaries", () => {
    const P = 30.4375; // monthly; grace is 7.61 days
    expect(classifyStatus(0, P)).toBe("active");
    expect(classifyStatus(38, P)).toBe("active");
    expect(classifyStatus(39, P)).toBe("late");
    expect(classifyStatus(68, P)).toBe("late");
    expect(classifyStatus(69, P)).toBe("stopped");
  });

  it("does not call an annual bill stopped three months after it charged", () => {
    // The existing recurringPayments() uses a flat 45-day window, which marks
    // every annual and quarterly bill inactive. Cycle-relative grace does not.
    expect(classifyStatus(97, 365.25)).toBe("active");
    expect(classifyStatus(97, 91.3125)).toBe("active");
    expect(classifyStatus(97, 30.4375)).toBe("stopped");
  });
});

// --------------------------------------------------------------- projection

describe("projectOccurrences", () => {
  const base = {
    cadence: "monthly" as const,
    periodDays: 30.4375,
    windowDays: 0,
    amount: 19.99,
    today: "2025-06-20",
    includeOverdue: false,
  };

  it("projects three monthly charges over 90 days and none beyond", () => {
    const occ = projectOccurrences({
      ...base,
      dates: ["2025-04-12", "2025-05-12", "2025-06-12"],
      horizonDays: 90,
    });
    expect(occ.map((o) => o.date)).toEqual(["2025-07-12", "2025-08-12", "2025-09-12"]);
    expect(occ.every((o) => !o.overdue)).toBe(true);
  });

  it("projects exactly one charge over 30 days", () => {
    const occ = projectOccurrences({
      ...base,
      dates: ["2025-04-12", "2025-05-12", "2025-06-12"],
      horizonDays: 30,
    });
    expect(occ.map((o) => o.date)).toEqual(["2025-07-12"]);
  });

  it("includes the missing charge for a late bill and marks it overdue", () => {
    const occ = projectOccurrences({
      ...base,
      dates: ["2025-03-10", "2025-04-10", "2025-05-10"],
      horizonDays: 30,
      includeOverdue: true,
    });
    expect(occ.map((o) => [o.date, o.overdue])).toEqual([
      ["2025-06-10", true],
      ["2025-07-10", false],
    ]);
  });

  it("drops the overdue occurrence when the caller does not want it", () => {
    const occ = projectOccurrences({
      ...base,
      dates: ["2025-03-10", "2025-04-10", "2025-05-10"],
      horizonDays: 30,
      includeOverdue: false,
    });
    expect(occ.map((o) => o.date)).toEqual(["2025-07-10"]);
  });

  it("projects semimonthly bills onto both of their anchor days", () => {
    const occ = projectOccurrences({
      ...base,
      cadence: "semimonthly",
      periodDays: 365.25 / 24,
      amount: 60,
      today: "2025-04-20",
      dates: [
        "2025-01-01", "2025-01-15", "2025-02-01", "2025-02-15",
        "2025-03-01", "2025-03-15", "2025-04-01", "2025-04-15",
      ],
      horizonDays: 30,
    });
    expect(occ.map((o) => o.date)).toEqual(["2025-05-01", "2025-05-15"]);
  });

  it("keeps a month-end bill on the 31st instead of drifting back", () => {
    const occ = projectOccurrences({
      ...base,
      today: "2025-01-05",
      dates: ["2024-11-30", "2024-12-31"],
      horizonDays: 120,
    });
    expect(occ.map((o) => o.date)).toEqual(["2025-01-31", "2025-02-28", "2025-03-31", "2025-04-30"]);
  });
});

// --------------------------------------------------------------- buildBill

describe("buildBill", () => {
  it("builds the price-change story for Northbrook Streaming", () => {
    const bill = buildBill(NORTHBROOK, OPTS())!;
    expect(bill.cadence).toBe("monthly");
    expect(bill.confidence).toBe("high");
    expect(bill.windowDays).toBe(0);
    expect(bill.status).toBe("active");
    // The NEXT charge costs the current price, not the $17.82 average that
    // recurringPayments() would report.
    expect(bill.expectedAmount).toBe(19.99);
    expect(bill.priceChanges).toHaveLength(2);
    expect(bill.priceChangeSinceStart).toBe(4.5);
    expect(bill.upcoming).toEqual([
      { date: "2025-07-12", amount: 19.99, windowDays: 0, overdue: false },
    ]);
    expect(bill.horizonTotal).toBe(19.99);
    expect(bill.monthlyEquivalent).toBe(19.99);
    expect(bill.chargeCount).toBe(6);
  });

  it("carries every source transaction id so the row is auditable", () => {
    const bill = buildBill(NORTHBROOK, OPTS())!;
    expect(bill.transactionIds).toEqual(NORTHBROOK.charges.map((c) => c.id));
    expect(bill.transactionIds).toHaveLength(bill.chargeCount);
  });

  it("projects three cycles over a 90-day horizon", () => {
    const bill = buildBill(NORTHBROOK, OPTS({ horizonDays: 90 }))!;
    expect(bill.upcoming.map((o) => o.date)).toEqual(["2025-07-12", "2025-08-12", "2025-09-12"]);
    expect(bill.horizonTotal).toBe(59.97);
  });

  it("keeps projecting a subscription that skipped a month", () => {
    const bill = buildBill(
      {
        merchant: "Rowan Gym",
        merchantId: 2,
        charges: flat(
          ["2025-01-05", "2025-02-05", "2025-04-05", "2025-05-05", "2025-06-05"],
          42,
        ),
      },
      OPTS(),
    )!;
    expect(bill.cadence).toBe("monthly");
    expect(bill.status).toBe("active");
    expect(bill.upcoming.map((o) => o.date)).toEqual(["2025-07-05"]);
    expect(bill.horizonTotal).toBe(42);
  });

  it("treats an annual renewal as active and projects it a year out", () => {
    const bill = buildBill(
      {
        merchant: "Fairhaven Domains",
        merchantId: 9,
        charges: charges([
          ["2022-03-15", 14.99],
          ["2023-03-15", 14.99],
          ["2024-03-15", 14.99],
          ["2025-03-15", 16.99],
        ]),
      },
      OPTS(),
    )!;
    expect(bill.cadence).toBe("annual");
    expect(bill.status).toBe("active"); // 97 days since last, on a 365-day cycle
    expect(bill.daysSinceLast).toBe(97);
    expect(bill.upcoming).toEqual([]); // nothing due inside 30 days
    expect(bill.horizonTotal).toBe(0);
    expect(bill.expectedAmount).toBe(16.99);
    expect(bill.monthlyEquivalent).toBe(1.42); // 16.99 / 12, for ranking
    expect(bill.statusNote).toContain("2026-03-15");
  });

  it("handles a merchant that charges twice a month", () => {
    const bill = buildBill(
      {
        merchant: "Ashcombe Cleaners",
        merchantId: 4,
        charges: flat(
          [
            "2025-01-01", "2025-01-15", "2025-02-01", "2025-02-15",
            "2025-03-01", "2025-03-15", "2025-04-01", "2025-04-15",
          ],
          60,
        ),
      },
      OPTS({ today: "2025-04-20", observedThrough: "2025-04-20" }),
    )!;
    expect(bill.cadence).toBe("semimonthly");
    expect(bill.confidence).toBe("high");
    expect(bill.windowDays).toBe(0);
    expect(bill.upcoming.map((o) => o.date)).toEqual(["2025-05-01", "2025-05-15"]);
    expect(bill.horizonTotal).toBe(120);
    // Two $60 charges a month, not one.
    expect(bill.monthlyEquivalent).toBe(120);
  });

  it("marks a bill that stopped three months ago and refuses to project it", () => {
    const bill = buildBill(
      {
        merchant: "Halden Video",
        merchantId: 5,
        charges: flat(
          ["2024-11-10", "2024-12-10", "2025-01-10", "2025-02-10", "2025-03-10"],
          9.99,
        ),
      },
      OPTS(),
    )!;
    expect(bill.status).toBe("stopped");
    expect(bill.daysSinceLast).toBe(102);
    expect(bill.upcoming).toEqual([]);
    expect(bill.horizonTotal).toBe(0);
    // The honest bit: we say it stopped, and say we cannot say why.
    expect(bill.statusNote).toContain("3 cycles");
    expect(bill.statusNote).toMatch(/cancellation, a failed payment and an expired card/);
  });

  it("marks a bill one cycle late without claiming to know why", () => {
    const bill = buildBill(
      {
        merchant: "Ledbury Insurance",
        merchantId: 6,
        charges: flat(["2025-02-10", "2025-03-10", "2025-04-10", "2025-05-10"], 78.4),
      },
      OPTS({ today: "2025-06-25", observedThrough: "2025-06-25" }),
    )!;
    expect(bill.status).toBe("late");
    expect(bill.upcoming.map((o) => [o.date, o.overdue])).toEqual([
      ["2025-06-10", true],
      ["2025-07-10", false],
    ]);
    expect(bill.horizonTotal).toBe(156.8);
    expect(bill.statusNote).toMatch(/cannot tell you which/);
  });

  it("returns null below the three-charge floor", () => {
    expect(
      buildBill(
        { merchant: "Marlow Books", merchantId: 8, charges: flat(["2025-04-02", "2025-05-02"], 11.5) },
        OPTS(),
      ),
    ).toBeNull();
  });

  it("returns null for a merchant with no nameable cycle", () => {
    expect(
      buildBill(
        {
          merchant: "Corner Coffee",
          merchantId: 10,
          charges: flat(
            ["2025-01-03", "2025-01-04", "2025-01-19", "2025-02-02", "2025-02-27", "2025-03-01"],
            4.75,
          ),
        },
        OPTS(),
      ),
    ).toBeNull();
  });

  it("measures staleness against the data, not the calendar", () => {
    // Same bill, same "today". If status were measured from today, a user who
    // last imported in March would see every subscription marked stopped.
    const g: MerchantCharges = {
      merchant: "Northbrook Streaming",
      merchantId: 7,
      charges: NORTHBROOK.charges,
    };
    const asOfData = buildBill(g, OPTS({ today: "2025-10-01", observedThrough: "2025-06-20" }))!;
    const asOfToday = buildBill(g, OPTS({ today: "2025-10-01", observedThrough: "2025-10-01" }))!;
    expect(asOfData.status).toBe("active");
    expect(asOfToday.status).toBe("stopped");
  });
});

// --------------------------------------------------------------- surplus

describe("averageMonthlySurplus", () => {
  const months: MonthlyNetPoint[] = [
    { month: "2025-01", income: 5000, expenses: 3800 },
    { month: "2025-02", income: 5000, expenses: 4200 },
    { month: "2025-03", income: 5600, expenses: 3800 },
    { month: "2025-04", income: 5000, expenses: 3800 },
    { month: "2025-05", income: 5000, expenses: 4000 },
    { month: "2025-06", income: 5000, expenses: 3800 },
  ];

  it("averages income minus expenses over whole months", () => {
    expect(averageMonthlySurplus(months)).toEqual({ average: 1200, monthsUsed: 6 });
  });

  it("uses only the most recent six months", () => {
    const older: MonthlyNetPoint[] = [
      { month: "2024-10", income: 0, expenses: 9000 },
      { month: "2024-11", income: 0, expenses: 9000 },
      { month: "2024-12", income: 0, expenses: 9000 },
      ...months,
    ];
    expect(averageMonthlySurplus(older)).toEqual({ average: 1200, monthsUsed: 6 });
  });

  it("reports zero months when there is no history", () => {
    expect(averageMonthlySurplus([])).toEqual({ average: 0, monthsUsed: 0 });
  });

  it("handles a deficit without special-casing it", () => {
    expect(
      averageMonthlySurplus([{ month: "2025-06", income: 3000, expenses: 3450.5 }]),
    ).toEqual({ average: -450.5, monthsUsed: 1 });
  });
});

// --------------------------------------------------------------- summary

describe("buildBillsSummary", () => {
  const groups: MerchantCharges[] = [
    NORTHBROOK,
    {
      merchant: "Rowan Gym",
      merchantId: 2,
      charges: flat(["2025-03-05", "2025-04-05", "2025-05-05", "2025-06-05"], 42),
    },
    {
      merchant: "Halden Video",
      merchantId: 5,
      charges: flat(["2024-12-10", "2025-01-10", "2025-02-10", "2025-03-10"], 9.99),
    },
    {
      merchant: "Marlow Books",
      merchantId: 8,
      charges: flat(["2025-04-02", "2025-05-02"], 11.5), // below the floor
    },
    {
      merchant: "Corner Coffee",
      merchantId: 10,
      charges: flat(
        ["2025-01-03", "2025-01-04", "2025-01-19", "2025-02-02", "2025-02-27", "2025-03-01"],
        4.75,
      ),
    },
  ];
  const monthly: MonthlyNetPoint[] = [
    { month: "2025-01", income: 5000, expenses: 3800 },
    { month: "2025-02", income: 5000, expenses: 4200 },
    { month: "2025-03", income: 5600, expenses: 3800 },
    { month: "2025-04", income: 5000, expenses: 3800 },
    { month: "2025-05", income: 5000, expenses: 4000 },
    { month: "2025-06", income: 5000, expenses: 3800 },
  ];
  const summary = buildBillsSummary(groups, {
    ...OPTS(),
    monthly,
    observedThroughOrNull: "2025-06-20",
  });

  it("separates bills, stopped bills, below-floor merchants and non-bills", () => {
    expect(summary.bills.map((b) => b.merchant)).toEqual(["Rowan Gym", "Northbrook Streaming"]);
    expect(summary.stopped.map((b) => b.merchant)).toEqual(["Halden Video"]);
    expect(summary.belowFloorMerchants).toEqual(["Marlow Books"]);
    // Corner Coffee is silently absent — it is spending, not a bill.
    expect([...summary.bills, ...summary.stopped].map((b) => b.merchant)).not.toContain(
      "Corner Coffee",
    );
  });

  it("orders bills by the soonest projected charge", () => {
    expect(summary.bills[0].upcoming[0].date).toBe("2025-07-05");
    expect(summary.bills[1].upcoming[0].date).toBe("2025-07-12");
  });

  it("totals the horizon exactly, to the cent", () => {
    // 42.00 (Rowan, Jul 5) + 19.99 (Northbrook, Jul 12). Stopped bills excluded.
    expect(summary.horizonTotal).toBe(61.99);
    expect(summary.overdueTotal).toBe(0);
    expect(summary.monthlyCommitted).toBe(61.99);
  });

  it("excludes stopped bills from the totals", () => {
    const withStopped = summary.horizonTotal + summary.stopped[0].horizonTotal;
    expect(summary.stopped[0].horizonTotal).toBe(0);
    expect(withStopped).toBe(61.99);
  });

  it("sets the horizon total against the surplus for the same window", () => {
    expect(summary.avgMonthlySurplus).toBe(1200);
    expect(summary.surplusMonths).toBe(6);
    // 1200 a month, scaled to 30 days of an average 30.44-day month.
    expect(summary.surplusForHorizon).toBe(1182.75);
    expect(summary.pctOfSurplus).toBe(5.2);
    expect(summary.from).toBe("2025-06-20");
    expect(summary.to).toBe("2025-07-20");
  });

  it("returns null context rather than a fake percentage with no income history", () => {
    const bare = buildBillsSummary(groups, {
      ...OPTS(),
      monthly: [],
      observedThroughOrNull: "2025-06-20",
    });
    expect(bare.surplusForHorizon).toBeNull();
    expect(bare.pctOfSurplus).toBeNull();
    expect(bare.surplusMonths).toBe(0);
  });

  it("triples the horizon total over 90 days", () => {
    const q = buildBillsSummary(groups, {
      ...OPTS({ horizonDays: 90 }),
      monthly,
      observedThroughOrNull: "2025-06-20",
    });
    // Rowan: Jul 5, Aug 5, Sep 5. Northbrook: Jul 12, Aug 12, Sep 12.
    expect(q.horizonTotal).toBe(185.97);
    expect(q.surplusForHorizon).toBe(3548.25);
    expect(q.to).toBe("2025-09-18");
  });

  it("flags stale data, because no imports looks exactly like no charges", () => {
    const stale = buildBillsSummary(groups, {
      ...OPTS({ today: "2025-08-01" }),
      monthly,
      observedThroughOrNull: "2025-06-20",
    });
    expect(stale.dataStale).toBe(true);
    expect(summary.dataStale).toBe(false);
    expect(
      buildBillsSummary([], { ...OPTS(), monthly, observedThroughOrNull: null }).dataStale,
    ).toBe(true);
  });

  it("returns an empty, well-formed summary for an empty database", () => {
    const empty = buildBillsSummary([], {
      ...OPTS(),
      monthly: [],
      observedThroughOrNull: null,
    });
    expect(empty.bills).toEqual([]);
    expect(empty.stopped).toEqual([]);
    expect(empty.horizonTotal).toBe(0);
    expect(empty.monthlyCommitted).toBe(0);
    expect(empty.belowFloorMerchants).toEqual([]);
  });

  it("sums many awkward cents without float drift", () => {
    // Three bills whose amounts are the kind that make raw float sums land on
    // ...9999996. Every total here goes through services/money.ts.
    const cents: MerchantCharges[] = [0.07, 0.29, 1.13, 2.71, 9.97].map((amount, i) => ({
      merchant: `Bill ${i}`,
      merchantId: i,
      charges: flat(["2025-03-15", "2025-04-15", "2025-05-15", "2025-06-15"], amount),
    }));
    const s = buildBillsSummary(cents, {
      ...OPTS({ horizonDays: 90 }),
      monthly: [],
      observedThroughOrNull: "2025-06-20",
    });
    // Each bill charges 3 times in the window (Jul/Aug/Sep 15).
    expect(s.bills).toHaveLength(5);
    expect(s.bills.every((b) => b.upcoming.length === 3)).toBe(true);
    expect(s.horizonTotal).toBe(42.51); // (0.07+0.29+1.13+2.71+9.97) * 3
  });

  it("counts an overdue charge in the horizon total and calls it out", () => {
    const late = buildBillsSummary(
      [
        {
          merchant: "Ledbury Insurance",
          merchantId: 6,
          charges: flat(["2025-02-10", "2025-03-10", "2025-04-10", "2025-05-10"], 78.4),
        },
      ],
      {
        ...OPTS({ today: "2025-06-25", observedThrough: "2025-06-25" }),
        monthly,
        observedThroughOrNull: "2025-06-25",
      },
    );
    expect(late.horizonTotal).toBe(156.8);
    expect(late.overdueTotal).toBe(78.4);
  });
});
