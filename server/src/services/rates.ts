/**
 * Return rates, and which dollars they are measured in.
 *
 * The engine had been mixing two things under one name. `fireProjection`
 * documents its `ratePct` as a REAL (after-inflation) return, which is what
 * keeps the FIRE number in today's dollars. `compoundGrowth` takes a bare
 * `annualRatePct`, and the Compound calculator labels that field "Annual
 * return (%)" — so the same engine was being fed 7% meaning "nominal, what the
 * market did" in one screen and 5% meaning "real, after inflation" in another,
 * with nothing anywhere converting between them.
 *
 * The error that produces is silent and large. Projecting 30 years at 7% when
 * you meant 7% nominal, and then reading the answer as today's money, overstates
 * the result by roughly (1.03)^30 — about 2.4x. Nobody sees a stack trace; they
 * see a retirement that looks a decade closer than it is.
 *
 * So a rate carries its basis. Conversions go through Fisher rather than
 * subtraction, and the results say which dollars they are in.
 */

/**
 * NOMINAL: the number on a fund factsheet. Includes inflation.
 * REAL: purchasing power. What the money will actually buy.
 */
export type RateBasis = "nominal" | "real";

export interface Rate {
  /** Annual percentage, e.g. 7 for 7%. */
  pct: number;
  basis: RateBasis;
}

export const nominal = (pct: number): Rate => ({ pct, basis: "nominal" });
export const real = (pct: number): Rate => ({ pct, basis: "real" });

/**
 * Long-run US CPI inflation, used when a caller gives a nominal rate but needs
 * a real one (or the reverse) and has no view of their own.
 *
 * 3% is the round number the planning literature uses. Actual US CPI averaged
 * about 3.2%/yr from 1926-2024 and about 2.5% over the 30 years to 2024; the
 * difference between 2.5 and 3 compounds to roughly 15% over 30 years, so this
 * is an assumption worth stating rather than burying.
 */
export const DEFAULT_INFLATION_PCT = 3;

/**
 * Fisher, not subtraction.
 *
 *     1 + real = (1 + nominal) / (1 + inflation)
 *
 * The common shortcut `real ≈ nominal − inflation` is off by the cross term.
 * At 7% nominal and 3% inflation it gives 4.00% where the truth is 3.88% — an
 * eighth of a point, which over 30 years is about 3.5% of the final balance.
 * Small enough to be invisible, large enough to be wrong, and free to get right.
 */
export function toReal(r: Rate, inflationPct = DEFAULT_INFLATION_PCT): Rate {
  if (r.basis === "real") return r;
  return { pct: ((1 + r.pct / 100) / (1 + inflationPct / 100) - 1) * 100, basis: "real" };
}

export function toNominal(r: Rate, inflationPct = DEFAULT_INFLATION_PCT): Rate {
  if (r.basis === "nominal") return r;
  return { pct: ((1 + r.pct / 100) * (1 + inflationPct / 100) - 1) * 100, basis: "nominal" };
}

/** Coerce to the basis a calculation needs, converting only if it must. */
export const asBasis = (r: Rate, basis: RateBasis, inflationPct = DEFAULT_INFLATION_PCT): Rate =>
  basis === "real" ? toReal(r, inflationPct) : toNominal(r, inflationPct);

/**
 * How to describe the answer.
 *
 * A projection run on a real return is in today's money and can be compared
 * to today's prices. One run on a nominal return is in future dollars, which
 * look bigger and buy the same amount — a distinction that matters most to the
 * people least likely to know it, so the result says so rather than assuming.
 */
export const dollarsLabel = (basis: RateBasis): string =>
  basis === "real"
    ? "in today's dollars"
    : "in future dollars, before adjusting for inflation";

/** Monthly rate from an annual one, compounded — not `annual / 12`. */
export const monthlyRate = (annualPct: number): number =>
  Math.pow(1 + annualPct / 100, 1 / 12) - 1;

/**
 * Note on `monthlyRate`: the engine's existing calculators use `annual/100/12`,
 * the simple convention a bank uses to quote a monthly payment. That is right
 * for loan amortisation, where the lender's stated APR *is* twelve times the
 * monthly periodic rate by definition. It is wrong for investment growth, where
 * a 7% annual return means the year multiplies by 1.07, not by (1 + 7/12/100)^12
 * = 1.0723. Twenty-three basis points a year is 7% over thirty years.
 *
 * Both are kept, named for what they are, so a caller has to pick.
 */
export const periodicRate = (annualPct: number): number => annualPct / 100 / 12;
