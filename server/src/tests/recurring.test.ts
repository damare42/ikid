/**
 * Recurring-payment detection.
 *
 * The rule used to be about amounts: at least three charges within 15% of the
 * median. On two years of realistic data that was wrong in both directions, and
 * the visible symptom was a demo reporting **$4,071/month of recurring
 * payments against $4,790/month of total spending** — 85%, a number no reader
 * would believe, attached to a feature whose only job is to be believed.
 *
 * Wrong inwards: a grocery shop visited twice a month for two years is 46
 * charges, and three of them landing near the median is arithmetic, not
 * evidence. Groceries, fuel, dining and transit were all being called
 * subscriptions.
 *
 * Wrong outwards: an electricity bill tracks the weather (38% of its charges
 * near the median) and a streaming service that raises its price straddles two
 * values (58%). Both are unarguably recurring and both were excluded.
 *
 * The signal is *when*, not *how much*. These tests are written around that
 * claim, so they fail if anyone reaches for amount similarity again.
 */
import { describe, expect, it } from "vitest";
import { RECURRING, findRecurring, type RecurringCharge } from "../services/recurringCore.js";

const AS_OF = new Date("2026-08-31");

/** `n` charges every `everyDays`, ending `endedDaysAgo` before AS_OF. */
function series(
  amount: number | number[],
  { n = 12, everyDays = 30, jitterDays = 0, endedDaysAgo = 0 } = {},
): RecurringCharge[] {
  const out: RecurringCharge[] = [];
  for (let i = 0; i < n; i++) {
    const back = endedDaysAgo + (n - 1 - i) * everyDays;
    // Deterministic alternating jitter — no randomness in a test that pins a
    // threshold, or the threshold is what gets flaky.
    const wobble = jitterDays === 0 ? 0 : (i % 2 === 0 ? jitterDays : -jitterDays);
    const d = new Date(AS_OF.getTime() - (back + wobble) * 86_400_000);
    out.push({
      amount: Array.isArray(amount) ? amount[i % amount.length] : amount,
      date: d.toISOString().slice(0, 10),
    });
  }
  return out;
}

const run = (groups: Record<string, RecurringCharge[]>) =>
  findRecurring(new Map(Object.entries(groups)), AS_OF);
const names = (groups: Record<string, RecurringCharge[]>) => run(groups).map((r) => r.merchant);

describe("findRecurring", () => {
  it("finds a plain monthly subscription", () => {
    const out = run({ Lumenflix: series(15.99) });
    expect(out).toHaveLength(1);
    expect(out[0].monthlyEstimate).toBeCloseTo(16.22, 1); // 15.99 × 30.44/30
    expect(out[0].active).toBe(true);
    expect(out[0].intervalDays).toBeCloseTo(30, 0);
  });

  it("keeps a bill whose amount moves — the case the old amount test dropped", () => {
    // An electricity bill through a year: same day each month, wildly different
    // totals. Only 2 of 12 charges sit within 15% of the median.
    const power = series([60, 210, 75, 190, 65, 240, 80, 205, 70, 230, 62, 195]);
    expect(names({ "Cindermill Power": power })).toEqual(["Cindermill Power"]);
  });

  it("keeps a subscription across a price rise", () => {
    const before = series(9.99, { n: 6, everyDays: 30, endedDaysAgo: 180 });
    const after = series(15.99, { n: 6, everyDays: 30 });
    expect(names({ Streamly: [...before, ...after] })).toEqual(["Streamly"]);
  });

  it("rejects a shop visited regularly but not on a schedule", () => {
    // 46 charges over two years at irregular intervals — the shape that was
    // producing "Northbrook Grocers: recurring payment".
    const groceries: RecurringCharge[] = [];
    const gaps = [4, 21, 9, 30, 6, 17, 11, 25, 3, 14, 8, 19];
    let back = 0;
    for (let i = 0; i < 46; i++) {
      back += gaps[i % gaps.length];
      groceries.push({
        amount: 40 + ((i * 37) % 90),
        date: new Date(AS_OF.getTime() - back * 86_400_000).toISOString().slice(0, 10),
      });
    }
    expect(names({ "Northbrook Grocers": groceries })).toEqual([]);
  });

  it("rejects a merchant whose charges only happen to cluster", () => {
    // Three charges near the median among many — enough for the old rule.
    const noise = series([5, 500, 5, 5, 900, 40, 5, 300], { n: 24, everyDays: 11, jitterDays: 7 });
    expect(names({ "Owl & Kettle": noise })).toEqual([]);
  });

  it("tolerates the drift of a real billing date", () => {
    // Billed "on the 1st", landing anywhere across a weekend.
    expect(names({ Fibre: series(64.99, { jitterDays: 3 }) })).toEqual(["Fibre"]);
  });

  it("needs more than two charges before a gap has any spread", () => {
    expect(names({ Twice: series(20, { n: 2 }) })).toEqual([]);
    expect(names({ Thrice: series(20, { n: 3 }) })).toEqual(["Thrice"]);
  });

  it("ignores cadences too fast or too slow to be a subscription", () => {
    expect(names({ Daily: series(4, { n: 30, everyDays: 1 }) })).toEqual([]);
    expect(names({ Rare: series(400, { n: 4, everyDays: 200 }) })).toEqual([]);
  });

  it("scales the estimate by the real cadence, not a capped guess", () => {
    // Weekly $25 is ~$109/month. The old `median × min(perMonth, 1.5)` capped
    // this at $37.50 while inflating a twice-monthly grocery run.
    const weekly = run({ Cleaner: series(25, { n: 20, everyDays: 7 }) });
    expect(weekly[0].monthlyEstimate).toBeCloseTo(108.7, 0);

    const quarterly = run({ Insurance: series(300, { n: 8, everyDays: 91 }) });
    expect(quarterly[0].monthlyEstimate).toBeCloseTo(100.3, 0);
  });

  it("calls a stopped subscription inactive, relative to the data not to today", () => {
    // The dataset ends in August 2026. Judged against a real clock this would
    // be years stale and everything would read as cancelled.
    const stopped = run({ Gym: series(39, { endedDaysAgo: RECURRING.activeWithinDays + 30 }) });
    expect(stopped[0].active).toBe(false);
    const current = run({ Gym: series(39, { endedDaysAgo: 5 }) });
    expect(current[0].active).toBe(true);
  });

  it("orders by what it costs you", () => {
    expect(names({
      Small: series(9.99),
      Mortgage: series(1940),
      Medium: series(120),
    })).toEqual(["Mortgage", "Medium", "Small"]);
  });

  it("totals to something a reader can believe", () => {
    // The regression this file exists for. A plausible fixed-cost set: the sum
    // should look like fixed costs, not like all of someone's spending.
    const out = run({
      Mortgage: series(1940), Car: series(385), Insurance: series(142),
      Power: series([60, 130, 70, 120, 65, 140, 75, 125, 68, 135, 62, 128]),
      Fibre: series(65), Mobile: series(38), Gym: series(39), Stream: series(15.99),
      // …alongside the everyday spending that must not be counted.
      Groceries: series([48, 92, 61, 130, 55], { n: 40, everyDays: 9, jitterDays: 5 }),
      Coffee: series([4.5, 5.25, 4.75], { n: 80, everyDays: 3, jitterDays: 2 }),
    });
    expect(out.map((r) => r.merchant)).not.toContain("Groceries");
    expect(out.map((r) => r.merchant)).not.toContain("Coffee");
    const total = out.reduce((s, r) => s + r.monthlyEstimate, 0);
    expect(total).toBeGreaterThan(2600);
    expect(total).toBeLessThan(2900);
  });
});
