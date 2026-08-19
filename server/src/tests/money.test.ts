/**
 * Money arithmetic. These tests exist because a finance app that sums floats
 * accumulates error — the exact issue found by comparing against CashFlux's
 * "money is never a float" principle (docs/COMPETITIVE-NOTES.md).
 */
import { describe, expect, it } from "vitest";
import {
  addMoney, fromCents, moneyEquals, mulMoney, round2, subMoney, sumBy, sumMoney, toCents,
} from "../services/money.js";

describe("the problem these helpers solve", () => {
  it("raw float addition is wrong; sumMoney is exact", () => {
    // The canonical example.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });

  it("float drift grows with volume; sumMoney does not", () => {
    // 1,211 values, matching the size of the real database this was found on:
    // 606 x 18.35 + 605 x -4.11 = 11120.10 - 2486.55 = 8633.55 exactly.
    const amounts = Array.from({ length: 1211 }, (_, i) => (i % 2 ? -4.11 : 18.35));
    let naive = 0;
    for (const a of amounts) naive += a;

    // The exact sum is precisely the arithmetic answer.
    expect(sumMoney(amounts)).toBe(8633.55);

    // The naive float sum drifts off it (tiny, but non-zero and growing)...
    expect(naive).not.toBe(8633.55);
    expect(Math.abs(naive - 8633.55)).toBeGreaterThan(0);
    expect(Math.abs(naive - 8633.55)).toBeLessThan(0.005); // invisible once rounded

    // ...which is why nothing a user sees changes: display rounding hides it.
    expect(round2(naive)).toBe(sumMoney(amounts));
  });
});

describe("toCents / fromCents", () => {
  it("round-trips ordinary amounts", () => {
    for (const v of [0, 1, -1, 12.34, -52.1, 1675.41, 0.05, 999999.99]) {
      expect(fromCents(toCents(v))).toBe(v);
    }
  });

  it("rounds half away from zero, symmetrically for debits and credits", () => {
    expect(toCents(0.005)).toBe(1);
    expect(toCents(-0.005)).toBe(-1);
    expect(toCents(2.675)).toBe(268); // the classic float-rounding trap
  });

  it("treats non-finite input as zero rather than producing NaN money", () => {
    expect(toCents(NaN)).toBe(0);
    expect(toCents(Infinity)).toBe(0);
    expect(sumMoney([1.5, NaN, 2.5])).toBe(4);
  });
});

describe("arithmetic", () => {
  it("adds and subtracts exactly", () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(subMoney(1.1, 1.0)).toBe(0.1); // 1.1 - 1.0 = 0.10000000000000009 raw
    expect(subMoney(100, 99.99)).toBe(0.01);
  });

  it("multiplies by a factor and rounds to cents", () => {
    expect(mulMoney(19.99, 3)).toBe(59.97);
    expect(mulMoney(100, 0.075)).toBe(7.5);
    // units x unit price, as used by investment holdings
    expect(mulMoney(13.7, 145.23)).toBe(1989.65);
  });

  it("compares to the cent instead of by exact float identity", () => {
    expect(0.1 + 0.2 === 0.3).toBe(false);
    expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true);
    expect(moneyEquals(10, 10.004)).toBe(true);   // sub-cent noise
    expect(moneyEquals(10, 10.01)).toBe(false);   // a real cent apart
  });
});

describe("sumBy", () => {
  it("sums a money field across records exactly", () => {
    const txns = [{ amount: -4.11 }, { amount: 1675.41 }, { amount: -20.0 }, { amount: -12.7 }];
    expect(sumBy(txns, (t) => t.amount)).toBe(1638.6);
  });

  it("returns 0 for an empty list", () => {
    expect(sumBy([], (x: { amount: number }) => x.amount)).toBe(0);
    expect(sumMoney([])).toBe(0);
  });

  it("signed amounts net out to exactly zero (a transfer pair)", () => {
    const pair = [{ amount: -1425.0 }, { amount: 1425.0 }];
    expect(sumBy(pair, (t) => t.amount)).toBe(0);
    expect(moneyEquals(sumBy(pair, (t) => t.amount), 0)).toBe(true);
  });
});
