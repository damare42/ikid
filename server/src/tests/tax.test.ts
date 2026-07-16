import { describe, expect, it } from "vitest";
import {
  conversionHeadroom, federalTax, ltcgTax, ordinaryTax, rmdAmount, STANDARD_DEDUCTION,
} from "../services/tax.js";

describe("ordinaryTax (2026 brackets)", () => {
  it("computes progressive tax at bracket edges", () => {
    // Single, top of 12% bracket: 12,400×10% + 38,000×12% = 1,240 + 4,560
    expect(ordinaryTax(50_400, "single")).toBe(5_800);
    // Married, top of 10% bracket
    expect(ordinaryTax(24_800, "married")).toBe(2_480);
    expect(ordinaryTax(0, "single")).toBe(0);
    expect(ordinaryTax(-5, "single")).toBe(0);
  });

  it("crosses into the 22% bracket correctly", () => {
    // Single, $60,000 taxable: 5,800 + (60,000−50,400)×22% = 5,800 + 2,112
    expect(ordinaryTax(60_000, "single")).toBe(7_912);
  });
});

describe("ltcgTax (stacking)", () => {
  it("is 0% when total income stays under the threshold", () => {
    expect(ltcgTax(30_000, 10_000, "single")).toBe(0); // 40k < 49,450
    expect(ltcgTax(90_000, 0, "married")).toBe(0); // 90k < 98,900
  });

  it("taxes only the slice above the 0% threshold at 15%", () => {
    // Single: ordinary 40,000 + gains 20,000 → 9,450 in 0%, 10,550 at 15%
    expect(ltcgTax(20_000, 40_000, "single")).toBe(r2(10_550 * 0.15));
  });
});

const r2 = (n: number) => Math.round(n * 100) / 100;

describe("federalTax", () => {
  it("applies the standard deduction to ordinary income first", () => {
    const { tax, ordinaryTaxable } = federalTax(16_100, 0, "single");
    expect(ordinaryTaxable).toBe(0);
    expect(tax).toBe(0);
  });

  it("leftover deduction absorbs capital gains", () => {
    // No ordinary income; deduction covers 16,100 of gains, rest in 0% band
    const { tax, gainsTaxable } = federalTax(0, 40_000, "single");
    expect(gainsTaxable).toBe(40_000 - 16_100);
    expect(tax).toBe(0);
  });

  it("taxes a mixed retiree year correctly", () => {
    // Married: 60k conversion + 30k gains.
    // Ordinary taxable = 60,000 − 32,200 = 27,800 → 2,480 + 3,000×12% = 2,840
    // Gains stack from 27,800 to 57,800 — all under 98,900 → 0%
    const { tax } = federalTax(60_000, 30_000, "married");
    expect(tax).toBe(2_840);
  });
});

describe("conversionHeadroom", () => {
  it("fills just the deduction at throughRate 0", () => {
    expect(conversionHeadroom(0, "single", 0)).toBe(STANDARD_DEDUCTION.single);
    expect(conversionHeadroom(5_000, "single", 0)).toBe(11_100);
  });

  it("fills through the 12% bracket", () => {
    // Single: 16,100 deduction + 50,400 taxable ceiling = 66,500 gross
    expect(conversionHeadroom(0, "single", 12)).toBe(66_500);
    expect(conversionHeadroom(66_500, "single", 12)).toBe(0);
    // Married: 32,200 + 100,800 = 133,000
    expect(conversionHeadroom(0, "married", 12)).toBe(133_000);
  });
});

describe("rmdAmount", () => {
  it("uses the Uniform Lifetime Table", () => {
    expect(rmdAmount(1_000_000, 75)).toBeCloseTo(1_000_000 / 24.6, 0);
    expect(rmdAmount(500_000, 73)).toBeCloseTo(500_000 / 26.5, 0);
    expect(rmdAmount(0, 80)).toBe(0);
  });
});
