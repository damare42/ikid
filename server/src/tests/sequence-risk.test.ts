/**
 * Sequence-of-returns testing, checked against the published literature.
 *
 * These aren't self-consistency checks. Where a number is known from outside
 * this codebase — Bengen 1994, the Trinity study, Kitces on long horizons — the
 * test asserts against the published result. If the history table gets a year
 * wrong or the withdrawal loop drifts, the reproduction breaks and says so.
 *
 * Where this implementation deliberately differs from a published one, the test
 * says which way and why, so a future reader isn't left wondering whether a
 * near-miss is a bug.
 */
import { describe, expect, it } from "vitest";
import {
  MARKET_HISTORY, FIRST_YEAR, LAST_YEAR, blendedReturn, realReturn, startYears, window,
} from "../services/marketHistory.js";
import {
  maxSafeWithdrawalPct, runCohort, safeRateForHorizon, testSequences,
} from "../services/sequenceRisk.js";

const M = 1_000_000;

describe("the historical record itself", () => {
  it("is continuous, with no gaps or duplicate years", () => {
    for (let i = 1; i < MARKET_HISTORY.length; i++) {
      expect(MARKET_HISTORY[i].year).toBe(MARKET_HISTORY[i - 1].year + 1);
    }
    expect(FIRST_YEAR).toBe(1926);
    expect(LAST_YEAR).toBeGreaterThanOrEqual(2024);
  });

  it("has the crashes and the inflation where they actually happened", () => {
    const at = (y: number) => MARKET_HISTORY.find((m) => m.year === y)!;
    expect(at(1931).stocks).toBeLessThan(-40);   // the worst year in the series
    expect(at(2008).stocks).toBeCloseTo(-37, 0); // the one everyone remembers
    expect(at(1974).stocks).toBeLessThan(-25);
    expect(at(1946).inflation).toBeGreaterThan(15); // post-war price controls ending
    expect(at(1979).inflation).toBeGreaterThan(13);
    // 2022: stocks and bonds fell together, which 60/40 assumes is unlikely.
    expect(at(2022).stocks).toBeLessThan(0);
    expect(at(2022).bonds).toBeLessThan(0);
  });

  it("produces long-run averages in the range the literature reports", () => {
    const n = MARKET_HISTORY.length;
    const avg = (f: (m: (typeof MARKET_HISTORY)[number]) => number) =>
      MARKET_HISTORY.reduce((s, m) => s + f(m), 0) / n;
    // ~10% nominal stocks, ~5% bonds, ~3% inflation over the century.
    expect(avg((m) => m.stocks)).toBeGreaterThan(8);
    expect(avg((m) => m.stocks)).toBeLessThan(13);
    expect(avg((m) => m.bonds)).toBeGreaterThan(3);
    expect(avg((m) => m.bonds)).toBeLessThan(7);
    expect(avg((m) => m.inflation)).toBeGreaterThan(2);
    expect(avg((m) => m.inflation)).toBeLessThan(4);
  });

  it("converts to real returns by Fisher, not subtraction", () => {
    // 1946: 18.1% inflation. Subtraction and division differ by more than a
    // point here, which is exactly when it matters.
    const naive = 10 - 18.1;
    const proper = realReturn(10, 18.1);
    expect(proper).toBeCloseTo(-6.86, 1);
    expect(Math.abs(proper - naive)).toBeGreaterThan(1);
  });

  it("blends stocks and bonds by weight", () => {
    const y = { year: 2000, stocks: -9.1, bonds: 16.7, inflation: 3.4 };
    expect(blendedReturn(y, 100)).toBeCloseTo(-9.1, 6);
    expect(blendedReturn(y, 0)).toBeCloseTo(16.7, 6);
    expect(blendedReturn(y, 60)).toBeCloseTo(-9.1 * 0.6 + 16.7 * 0.4, 6);
  });

  it("refuses a window that runs off the end rather than truncating", () => {
    expect(() => window(2020, 30)).toThrow(/No 30-year window/);
    expect(window(1926, 30)).toHaveLength(30);
    expect(startYears(30).length).toBe(LAST_YEAR - FIRST_YEAR - 30 + 2);
  });
});

describe("reproduces the published results", () => {
  it("Bengen/Trinity: 4% over 30 years survives ~95% of start years", () => {
    // Bengen (1994) and the Trinity study (1998) both land in the mid-90s for a
    // stock-heavy 30-year retirement at 4%. This implementation withdraws at the
    // *start* of each year — more conservative than Trinity's year-end
    // convention — so it should sit at the lower edge of that range, not above.
    const r = testSequences({
      initialBalance: M, annualWithdrawal: 40_000, years: 30, equityPct: 75,
    });
    expect(r.successRate).toBeGreaterThan(0.9);
    expect(r.successRate).toBeLessThan(0.98);
  });

  it("names 1966 as the cohort that sets the limit", () => {
    // The single most-cited fact in this literature: the worst 30-year US
    // retirement start was not 1929 but 1966 — a flat nominal market through
    // 1982 combined with the worst sustained inflation of the century. If the
    // inflation column were wrong, this test would point at 1929 instead.
    const r = testSequences({
      initialBalance: M, annualWithdrawal: 40_000, years: 30, equityPct: 75,
    });
    expect(r.worst.startYear).toBeGreaterThanOrEqual(1964);
    expect(r.worst.startYear).toBeLessThanOrEqual(1969);
  });

  it("Kitces: a longer retirement supports a lower rate", () => {
    const thirty = safeRateForHorizon(30, 75).maxSafePct;
    const fifty = safeRateForHorizon(50, 75).maxSafePct;
    expect(thirty).toBeGreaterThan(fifty);
    // The long-horizon literature converges near 3.25–3.5%.
    expect(fifty).toBeGreaterThan(3);
    expect(fifty).toBeLessThan(3.75);
  });

  it("shows 4% usually leaves you far richer, which is the other half of the story", () => {
    // The median 30-year outcome at 4% is to end with substantially more than
    // you started, in real terms. A success rate alone hides that, and it is why
    // "4% is too risky" and "4% wastes your money" are both common complaints.
    const r = testSequences({
      initialBalance: M, annualWithdrawal: 40_000, years: 30, equityPct: 75,
    });
    expect(r.median.finalBalance).toBeGreaterThan(M);
  });
});

describe("the withdrawal simulation", () => {
  it("depletes a portfolio that cannot possibly last", () => {
    const r = runCohort(
      { initialBalance: 100_000, annualWithdrawal: 50_000, years: 10, equityPct: 0, feePct: 0 },
      window(1926, 10),
    );
    expect(r.survived).toBe(false);
    expect(r.depletedIn).not.toBeNull();
    expect(r.finalBalance).toBe(0);
  });

  it("withdraws before growing, which is the pessimistic reading", () => {
    // One year, no fee, a year with a known return. Withdrawing first means the
    // return applies to what's left, not to the starting balance.
    const y = [{ year: 1995, stocks: 37.6, bonds: 23.5, inflation: 2.5 }];
    const r = runCohort(
      { initialBalance: 100_000, annualWithdrawal: 10_000, years: 1, equityPct: 100, feePct: 0 },
      y,
    );
    const expected = 90_000 * (1 + realReturn(37.6, 2.5) / 100);
    expect(r.finalBalance).toBeCloseTo(Math.round(expected * 100) / 100, 0);
  });

  it("charges fees, because a percent a year is not a rounding error", () => {
    const plan = { initialBalance: M, annualWithdrawal: 40_000, years: 30, equityPct: 75 };
    const cheap = testSequences({ ...plan, feePct: 0.05 });
    const dear = testSequences({ ...plan, feePct: 1.0 });
    expect(dear.successRate).toBeLessThanOrEqual(cheap.successRate);
    expect(dear.median.finalBalance).toBeLessThan(cheap.median.finalBalance * 0.85);
  });

  it("a bigger withdrawal never survives more often", () => {
    let previous = 1;
    for (const w of [30_000, 40_000, 50_000, 60_000, 70_000]) {
      const rate = testSequences({
        initialBalance: M, annualWithdrawal: w, years: 30, equityPct: 75,
      }).successRate;
      expect(rate).toBeLessThanOrEqual(previous);
      previous = rate;
    }
  });

  it("records how close a survivor came, not just that it survived", () => {
    // "Survived" includes finishing with a dollar. The low-water mark is what
    // tells you whether the plan was ever actually in trouble.
    const r = testSequences({
      initialBalance: M, annualWithdrawal: 45_000, years: 30, equityPct: 75,
    });
    const survivorsThatNearlyDidnt = r.cohorts.filter(
      (c) => c.survived && c.lowestBalance < M * 0.25,
    );
    expect(survivorsThatNearlyDidnt.length).toBeGreaterThan(0);
  });
});

describe("maxSafeWithdrawalPct", () => {
  it("finds a rate where every cohort survives, and fails just above it", () => {
    const safe = maxSafeWithdrawalPct(M, 30, 75);
    expect(
      testSequences({ initialBalance: M, annualWithdrawal: M * (safe / 100), years: 30, equityPct: 75 })
        .successRate,
    ).toBe(1);
    expect(
      testSequences({
        initialBalance: M, annualWithdrawal: M * ((safe + 0.25) / 100), years: 30, equityPct: 75,
      }).successRate,
    ).toBeLessThan(1);
  });

  it("is scale-free — the rate doesn't depend on the size of the pot", () => {
    expect(maxSafeWithdrawalPct(100_000, 30, 75)).toBeCloseTo(maxSafeWithdrawalPct(10_000_000, 30, 75), 1);
  });

  it("reports the cohort count, because a long horizon tests fewer of them", () => {
    // The honesty check. A 60-year horizon has only ~40 start years with a full
    // window, and 1966 — the worst cohort — is not among them, so the "safe"
    // rate can tick *up* with horizon. That is a property of the sample, not of
    // retirement, and the count is what lets a reader notice.
    const thirty = testSequences({ initialBalance: M, annualWithdrawal: 35_000, years: 30, equityPct: 75 });
    const sixty = testSequences({ initialBalance: M, annualWithdrawal: 35_000, years: 60, equityPct: 75 });
    expect(sixty.cohortCount).toBeLessThan(thirty.cohortCount / 1.5);
    expect(sixty.lastStart).toBeLessThan(1966);
  });
});
