/**
 * US federal tax math — pure, deterministic, unit-tested.
 *
 * Constants are tax year 2026 per IRS Rev. Proc. 2025-32 (post-OBBBA),
 * verified against taxfoundation.org/data/all/federal/2026-tax-brackets.
 * They WILL drift as the IRS adjusts for inflation each year — update the
 * tables below (and the tests) when a new revenue procedure lands.
 *
 * Deliberate simplifications (documented in the UI): federal only (no state
 * tax, no NIIT, no AMT), standard deduction only, no credits.
 */

export type FilingStatus = "single" | "married";

export const TAX_YEAR = 2026;

export const STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 16_100,
  married: 32_200,
};

interface Bracket {
  rate: number; // 0.10, 0.12, …
  upTo: number; // taxable-income ceiling for this rate
}

/** Ordinary income brackets (taxable income, i.e. after deductions). */
export const ORDINARY_BRACKETS: Record<FilingStatus, Bracket[]> = {
  single: [
    { rate: 0.10, upTo: 12_400 },
    { rate: 0.12, upTo: 50_400 },
    { rate: 0.22, upTo: 105_700 },
    { rate: 0.24, upTo: 201_775 },
    { rate: 0.32, upTo: 256_225 },
    { rate: 0.35, upTo: 640_600 },
    { rate: 0.37, upTo: Infinity },
  ],
  married: [
    { rate: 0.10, upTo: 24_800 },
    { rate: 0.12, upTo: 100_800 },
    { rate: 0.22, upTo: 211_400 },
    { rate: 0.24, upTo: 403_550 },
    { rate: 0.32, upTo: 512_450 },
    { rate: 0.35, upTo: 768_700 },
    { rate: 0.37, upTo: Infinity },
  ],
};

/** Long-term capital gains brackets (taxable income thresholds). */
export const LTCG_BRACKETS: Record<FilingStatus, Bracket[]> = {
  single: [
    { rate: 0.00, upTo: 49_450 },
    { rate: 0.15, upTo: 545_500 },
    { rate: 0.20, upTo: Infinity },
  ],
  married: [
    { rate: 0.00, upTo: 98_900 },
    { rate: 0.15, upTo: 613_700 },
    { rate: 0.20, upTo: Infinity },
  ],
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Progressive tax on ordinary TAXABLE income (deduction already applied). */
export function ordinaryTax(taxable: number, status: FilingStatus): number {
  if (taxable <= 0) return 0;
  let tax = 0;
  let floor = 0;
  for (const b of ORDINARY_BRACKETS[status]) {
    const slice = Math.min(taxable, b.upTo) - floor;
    if (slice <= 0) break;
    tax += slice * b.rate;
    floor = b.upTo;
  }
  return r2(tax);
}

/**
 * Tax on long-term gains, which STACK on top of ordinary taxable income:
 * the gain slice from `ordinaryTaxable` to `ordinaryTaxable + gains` is
 * taxed at whichever LTCG rate each threshold band applies.
 */
export function ltcgTax(gains: number, ordinaryTaxable: number, status: FilingStatus): number {
  if (gains <= 0) return 0;
  const start = Math.max(0, ordinaryTaxable);
  const end = start + gains;
  let tax = 0;
  let floor = 0;
  for (const b of LTCG_BRACKETS[status]) {
    const from = Math.max(start, floor);
    const to = Math.min(end, b.upTo);
    if (to > from) tax += (to - from) * b.rate;
    floor = b.upTo;
    if (floor >= end) break;
  }
  return r2(tax);
}

/**
 * Full-year federal tax for a retiree: ordinary income (trad withdrawals,
 * Roth conversions) + long-term gains, applying the standard deduction to
 * ordinary income first, with any leftover deduction absorbing gains.
 */
export function federalTax(
  ordinaryIncome: number,
  capitalGains: number,
  status: FilingStatus,
): { tax: number; ordinaryTaxable: number; gainsTaxable: number } {
  const ded = STANDARD_DEDUCTION[status];
  const ordinaryTaxable = Math.max(0, ordinaryIncome - ded);
  const leftoverDed = Math.max(0, ded - ordinaryIncome);
  const gainsTaxable = Math.max(0, capitalGains - leftoverDed);
  const tax = r2(ordinaryTax(ordinaryTaxable, status) + ltcgTax(gainsTaxable, ordinaryTaxable, status));
  return { tax, ordinaryTaxable, gainsTaxable };
}

/**
 * How much MORE ordinary income (e.g. a Roth conversion) fits before
 * exceeding the bracket whose rate is `throughRate`?
 * throughRate 0 = fill only the standard deduction (a tax-free conversion).
 * Gross amounts (deduction added back), given ordinary income so far.
 */
export function conversionHeadroom(
  ordinaryIncomeSoFar: number,
  status: FilingStatus,
  throughRate: number,
): number {
  const ded = STANDARD_DEDUCTION[status];
  let ceiling = 0; // taxable-income ceiling
  if (throughRate > 0) {
    for (const b of ORDINARY_BRACKETS[status]) {
      if (Math.round(b.rate * 100) <= throughRate) ceiling = b.upTo;
    }
  }
  const grossCeiling = ded + ceiling;
  return r2(Math.max(0, grossCeiling - ordinaryIncomeSoFar));
}

/**
 * IRS Uniform Lifetime Table divisors (2022+ table) for RMDs.
 * Ages outside the table clamp to its edges.
 */
const UNIFORM_LIFETIME: Record<number, number> = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0,
  79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0,
  86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8,
  93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
  101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
  108: 3.9, 109: 3.7, 110: 3.5,
};

export function rmdAmount(balance: number, age: number): number {
  if (balance <= 0) return 0;
  const clamped = Math.min(110, Math.max(72, Math.round(age)));
  return r2(balance / UNIFORM_LIFETIME[clamped]);
}
