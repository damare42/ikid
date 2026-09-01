/**
 * Which month a screen opens on.
 *
 * Written after CI failed at 00:58 on the 1st of a month. The demo's dataset
 * stops at the day it was generated, so the current month held nothing, and the
 * dashboard — which asked for the current month — came up blank with $0 in every
 * card. The test that caught it was asserting income > 0 and was entirely
 * correct to fail: any visitor on the 1st would have seen the same screen, and
 * so would any real user who imports statements monthly rather than daily.
 *
 * `today` is injected rather than mocked, so these cases are ordinary function
 * calls and the awkward dates — the 1st, a gap, the future — are cheap to state.
 */
import { describe, expect, it } from "vitest";
import { monthKeyOfDate, resolveMonth, type MonthActivity } from "../services/periodCore.js";

/** A month with both sides of the ledger — one you'd want to open on. */
const full = (key: string): MonthActivity => ({ key, hasIncome: true, hasSpending: true });
/** A month with expenses but no income yet: the 1st-of-the-month case. */
const spendOnly = (key: string): MonthActivity => ({ key, hasIncome: false, hasSpending: true });

/**
 * The 1st of September, local time, wherever this runs.
 *
 * Deliberately not `new Date("2026-09-01T00:58:00Z")`. That instant is the 31st
 * of August in New York and the 1st of September in London, so the fixture
 * would assert different things on different machines — and a timezone
 * disagreement between CI and a laptop is exactly what produced the failure
 * these tests exist for. The month-selection rule is about local calendar days,
 * so the fixture is a local calendar day.
 */
const SEPT_1 = new Date(2026, 8, 1, 0, 58);

describe("resolveMonth", () => {
  it("shows the current month as soon as anything has happened in it", () => {
    expect(resolveMonth(undefined, [full("2026-07"), full("2026-08"), full("2026-09")], SEPT_1)).toBe("2026-09");
  });

  it("falls back to the last month with activity when this one is empty", () => {
    // The exact case CI hit: data through August, opened on 1 September.
    expect(resolveMonth(undefined, [full("2026-07"), full("2026-08")], SEPT_1)).toBe("2026-08");
  });

  it("skips a month holding two coffees and no salary", () => {
    // The hole in the first version of this fix. September had a couple of
    // expenses and no income, which counted as "active" — and the dashboard
    // opened on it showing $0 income, a 0% savings rate and every spending-plan
    // bucket at 0%, because all of those are ratios of income.
    expect(resolveMonth(undefined, [full("2026-08"), spendOnly("2026-09")], SEPT_1)).toBe("2026-08");
  });

  it("still shows something when no month has both sides", () => {
    // Between jobs, or a half-finished first import. A month of real expenses
    // beats a blank screen.
    expect(resolveMonth(undefined, [spendOnly("2026-08"), spendOnly("2026-09")], SEPT_1)).toBe("2026-09");
  });

  it("honours an explicit choice even when that month is empty", () => {
    // Choosing March and being moved to August without being told would be a
    // worse failure than an empty screen — the screen at least says which month
    // it is showing.
    expect(resolveMonth("2026-03", [full("2026-07"), full("2026-08")], SEPT_1)).toBe("2026-03");
  });

  it("ignores a malformed month rather than trusting it", () => {
    for (const bad of ["", "2026", "2026-13-01", "august", "26-08"]) {
      expect(resolveMonth(bad, [full("2026-08")], SEPT_1)).toBe("2026-08");
    }
  });

  it("never opens on the future because one payment is pencilled in", () => {
    // A scheduled transfer dated next month is legitimate data. Opening the
    // dashboard on October because of it is not.
    expect(resolveMonth(undefined, [full("2026-08"), full("2026-10")], SEPT_1)).toBe("2026-08");
  });

  it("skips a gap rather than showing an empty month between two full ones", () => {
    expect(resolveMonth(undefined, [full("2026-04"), full("2026-08")], SEPT_1)).toBe("2026-08");
  });

  it("falls back to the current month when there is no data at all", () => {
    // A first run, before any import. The empty state belongs to this month.
    expect(resolveMonth(undefined, [], SEPT_1)).toBe("2026-09");
  });

  it("is stable on the last day of a month, which is the other edge", () => {
    const aug31 = new Date(2026, 7, 31, 23, 59); // local, as above
    expect(resolveMonth(undefined, [full("2026-08")], aug31)).toBe("2026-08");
  });

  it("formats months in local time, not UTC", () => {
    // A transaction late on the 31st is not next month because the machine is
    // west of Greenwich — toISOString() would have said otherwise.
    const lateLocal = new Date(2026, 7, 31, 22, 30);
    expect(monthKeyOfDate(lateLocal)).toBe("2026-08");
  });
});
