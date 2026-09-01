/**
 * A century of US market history, for testing a plan against what actually
 * happened rather than against an average.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 *
 * Every projection in this engine was a single smooth line: pick a return, grow
 * the balance, read off the answer. That is a reasonable way to *size* a goal
 * and a poor way to *test* one, because it assumes the return arrives evenly.
 * It never does, and the order matters enormously once you are withdrawing.
 *
 * Two retirees with the same average return over thirty years, one of whom got
 * the bad years first, do not end up in the same place. Withdrawals during a
 * crash sell more shares to raise the same income, and those shares aren't
 * there for the recovery. This is sequence-of-returns risk, and it is the
 * reason the 4% rule is 4% rather than the ~7% a long-run average would
 * suggest — Bengen (1994) picked the number by finding the worst historical
 * starting year and asking what survived it.
 *
 * So the app was quietly having it both ways: applying a withdrawal rate
 * derived from worst-case sequences, while projecting on an average one.
 *
 * ---------------------------------------------------------------------------
 * Why history and not Monte Carlo
 *
 * A simulation asks you to trust a distribution — usually a normal one, which
 * has thinner tails than markets do, and independent draws, which markets are
 * not. Replaying the record instead means every number here traces to a year
 * that happened. A reader who doubts the output can look up 1966 and check.
 * That fits this project's rule that every figure be auditable, and it removes
 * the RNG from a deterministic engine.
 *
 * The limitation is real and worth stating: 99 years is about three independent
 * 30-year windows, and they are all one country's unusually good century. The
 * result is "no US retiree starting in any year since 1926 ran out", which is
 * evidence, not a guarantee. The functions that consume this say so.
 *
 * ---------------------------------------------------------------------------
 * Sources and construction
 *
 * - Stocks: S&P 500 total return (price plus reinvested dividends).
 * - Bonds: 10-year US Treasury total return (coupon plus price change).
 * - Inflation: US CPI-U, December to December.
 *
 * These are the standard series behind the Trinity study and the FIRE
 * literature (Shiller's dataset, Damodaran's annual returns page, BLS CPI).
 * Values are rounded to one decimal, which is finer than the disagreement
 * between sources. They are nominal; `realReturn` below does the conversion.
 */

export interface MarketYear {
  year: number;
  /** S&P 500 total return, nominal %, e.g. -37.0 for 2008. */
  stocks: number;
  /** 10-year Treasury total return, nominal %. */
  bonds: number;
  /** CPI-U change, %. */
  inflation: number;
}

/**
 * 1926–2024. The full window matters: a table starting in 1950 omits the
 * Depression, and one starting in 1980 omits the 1966–1982 stagflation that
 * produced the worst retirement cohort in the record.
 */
export const MARKET_HISTORY: readonly MarketYear[] = [
  { year: 1926, stocks: 11.6, bonds: 7.8, inflation: -1.1 },
  { year: 1927, stocks: 37.5, bonds: 8.9, inflation: -2.3 },
  { year: 1928, stocks: 43.6, bonds: 0.1, inflation: -1.2 },
  { year: 1929, stocks: -8.4, bonds: 4.2, inflation: 0.6 },
  { year: 1930, stocks: -24.9, bonds: 4.5, inflation: -6.4 },
  { year: 1931, stocks: -43.3, bonds: -2.6, inflation: -9.3 },
  { year: 1932, stocks: -8.2, bonds: 8.8, inflation: -10.3 },
  { year: 1933, stocks: 54.0, bonds: 1.9, inflation: 0.8 },
  { year: 1934, stocks: -1.4, bonds: 8.0, inflation: 1.5 },
  { year: 1935, stocks: 47.7, bonds: 4.5, inflation: 3.0 },
  { year: 1936, stocks: 33.9, bonds: 5.0, inflation: 1.4 },
  { year: 1937, stocks: -35.0, bonds: 1.4, inflation: 2.9 },
  { year: 1938, stocks: 31.1, bonds: 4.2, inflation: -2.8 },
  { year: 1939, stocks: -0.4, bonds: 4.4, inflation: 0.0 },
  { year: 1940, stocks: -9.8, bonds: 5.4, inflation: 0.7 },
  { year: 1941, stocks: -11.6, bonds: -2.0, inflation: 9.9 },
  { year: 1942, stocks: 20.3, bonds: 2.3, inflation: 9.0 },
  { year: 1943, stocks: 25.9, bonds: 2.5, inflation: 3.0 },
  { year: 1944, stocks: 19.8, bonds: 2.6, inflation: 2.3 },
  { year: 1945, stocks: 36.4, bonds: 3.8, inflation: 2.2 },
  { year: 1946, stocks: -8.1, bonds: 3.1, inflation: 18.1 },
  { year: 1947, stocks: 5.7, bonds: 0.9, inflation: 8.8 },
  { year: 1948, stocks: 5.5, bonds: 2.0, inflation: 3.0 },
  { year: 1949, stocks: 18.8, bonds: 4.7, inflation: -2.1 },
  { year: 1950, stocks: 31.7, bonds: 0.4, inflation: 5.9 },
  { year: 1951, stocks: 24.0, bonds: -0.3, inflation: 6.0 },
  { year: 1952, stocks: 18.4, bonds: 2.3, inflation: 0.8 },
  { year: 1953, stocks: -1.0, bonds: 4.1, inflation: 0.7 },
  { year: 1954, stocks: 52.6, bonds: 3.3, inflation: -0.7 },
  { year: 1955, stocks: 31.6, bonds: -1.3, inflation: 0.4 },
  { year: 1956, stocks: 6.6, bonds: -2.3, inflation: 3.0 },
  { year: 1957, stocks: -10.8, bonds: 6.8, inflation: 2.9 },
  { year: 1958, stocks: 43.4, bonds: -2.1, inflation: 1.8 },
  { year: 1959, stocks: 12.0, bonds: -2.6, inflation: 1.7 },
  { year: 1960, stocks: 0.5, bonds: 11.6, inflation: 1.4 },
  { year: 1961, stocks: 26.9, bonds: 2.1, inflation: 0.7 },
  { year: 1962, stocks: -8.7, bonds: 5.7, inflation: 1.3 },
  { year: 1963, stocks: 22.8, bonds: 1.7, inflation: 1.6 },
  { year: 1964, stocks: 16.5, bonds: 3.7, inflation: 1.0 },
  { year: 1965, stocks: 12.5, bonds: 0.7, inflation: 1.9 },
  // 1966 begins the worst 30-year window in the record: a flat nominal market
  // through 1982 combined with the highest sustained inflation of the century.
  { year: 1966, stocks: -10.1, bonds: 3.6, inflation: 3.5 },
  { year: 1967, stocks: 24.0, bonds: -1.6, inflation: 3.0 },
  { year: 1968, stocks: 11.1, bonds: 3.3, inflation: 4.7 },
  { year: 1969, stocks: -8.5, bonds: -5.0, inflation: 6.2 },
  { year: 1970, stocks: 4.0, bonds: 16.8, inflation: 5.6 },
  { year: 1971, stocks: 14.3, bonds: 9.8, inflation: 3.3 },
  { year: 1972, stocks: 19.0, bonds: 2.8, inflation: 3.4 },
  { year: 1973, stocks: -14.7, bonds: 3.7, inflation: 8.7 },
  { year: 1974, stocks: -26.5, bonds: 2.0, inflation: 12.3 },
  { year: 1975, stocks: 37.2, bonds: 3.6, inflation: 6.9 },
  { year: 1976, stocks: 23.8, bonds: 16.0, inflation: 4.9 },
  { year: 1977, stocks: -7.2, bonds: 1.3, inflation: 6.7 },
  { year: 1978, stocks: 6.6, bonds: -0.8, inflation: 9.0 },
  { year: 1979, stocks: 18.4, bonds: 0.7, inflation: 13.3 },
  { year: 1980, stocks: 32.4, bonds: -3.0, inflation: 12.5 },
  { year: 1981, stocks: -4.9, bonds: 8.2, inflation: 8.9 },
  { year: 1982, stocks: 21.4, bonds: 32.8, inflation: 3.8 },
  { year: 1983, stocks: 22.5, bonds: 3.2, inflation: 3.8 },
  { year: 1984, stocks: 6.3, bonds: 13.7, inflation: 3.9 },
  { year: 1985, stocks: 32.2, bonds: 25.7, inflation: 3.8 },
  { year: 1986, stocks: 18.5, bonds: 24.3, inflation: 1.1 },
  { year: 1987, stocks: 5.2, bonds: -5.0, inflation: 4.4 },
  { year: 1988, stocks: 16.8, bonds: 8.2, inflation: 4.4 },
  { year: 1989, stocks: 31.5, bonds: 17.7, inflation: 4.6 },
  { year: 1990, stocks: -3.1, bonds: 6.2, inflation: 6.1 },
  { year: 1991, stocks: 30.5, bonds: 15.0, inflation: 3.1 },
  { year: 1992, stocks: 7.6, bonds: 9.4, inflation: 2.9 },
  { year: 1993, stocks: 10.1, bonds: 14.2, inflation: 2.7 },
  { year: 1994, stocks: 1.3, bonds: -8.0, inflation: 2.7 },
  { year: 1995, stocks: 37.6, bonds: 23.5, inflation: 2.5 },
  { year: 1996, stocks: 23.0, bonds: 1.4, inflation: 3.3 },
  { year: 1997, stocks: 33.4, bonds: 9.9, inflation: 1.7 },
  { year: 1998, stocks: 28.6, bonds: 14.9, inflation: 1.6 },
  { year: 1999, stocks: 21.0, bonds: -8.3, inflation: 2.7 },
  // 2000 is the other cohort the literature watches: a 3-year bear market
  // straight out of the gate, then 2008 eight years in.
  { year: 2000, stocks: -9.1, bonds: 16.7, inflation: 3.4 },
  { year: 2001, stocks: -11.9, bonds: 5.6, inflation: 1.6 },
  { year: 2002, stocks: -22.1, bonds: 15.1, inflation: 2.4 },
  { year: 2003, stocks: 28.7, bonds: 0.4, inflation: 1.9 },
  { year: 2004, stocks: 10.9, bonds: 4.5, inflation: 3.3 },
  { year: 2005, stocks: 4.9, bonds: 2.9, inflation: 3.4 },
  { year: 2006, stocks: 15.8, bonds: 2.0, inflation: 2.5 },
  { year: 2007, stocks: 5.5, bonds: 10.2, inflation: 4.1 },
  { year: 2008, stocks: -37.0, bonds: 20.1, inflation: 0.1 },
  { year: 2009, stocks: 26.5, bonds: -11.1, inflation: 2.7 },
  { year: 2010, stocks: 15.1, bonds: 8.5, inflation: 1.5 },
  { year: 2011, stocks: 2.1, bonds: 16.0, inflation: 3.0 },
  { year: 2012, stocks: 16.0, bonds: 3.0, inflation: 1.7 },
  { year: 2013, stocks: 32.4, bonds: -9.1, inflation: 1.5 },
  { year: 2014, stocks: 13.7, bonds: 10.7, inflation: 0.8 },
  { year: 2015, stocks: 1.4, bonds: 1.3, inflation: 0.7 },
  { year: 2016, stocks: 12.0, bonds: 0.7, inflation: 2.1 },
  { year: 2017, stocks: 21.8, bonds: 2.8, inflation: 2.1 },
  { year: 2018, stocks: -4.4, bonds: 0.0, inflation: 1.9 },
  { year: 2019, stocks: 31.5, bonds: 9.6, inflation: 2.3 },
  { year: 2020, stocks: 18.4, bonds: 11.3, inflation: 1.4 },
  { year: 2021, stocks: 28.7, bonds: -4.4, inflation: 7.0 },
  // 2022: stocks and bonds fell together, which the standard 60/40 assumption
  // says is unlikely. Worth keeping visible.
  { year: 2022, stocks: -18.1, bonds: -17.8, inflation: 6.5 },
  { year: 2023, stocks: 26.3, bonds: 3.9, inflation: 3.4 },
  { year: 2024, stocks: 25.0, bonds: -1.7, inflation: 2.9 },
];

export const FIRST_YEAR = MARKET_HISTORY[0].year;
export const LAST_YEAR = MARKET_HISTORY[MARKET_HISTORY.length - 1].year;

/**
 * A blended portfolio's nominal return for one year.
 * @param equityPct 0–100. The rest is bonds; cash is not modelled separately
 *   because at these horizons its behaviour is bond-like and worse.
 */
export const blendedReturn = (y: MarketYear, equityPct: number): number =>
  (y.stocks * equityPct + y.bonds * (100 - equityPct)) / 100;

/**
 * The real return for a year, Fisher-adjusted rather than subtracted.
 * In 1946 — 18.1% inflation — the difference between the two methods is over
 * a percentage point.
 */
export const realReturn = (nominalPct: number, inflationPct: number): number =>
  ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;

/** Every start year with at least `length` years of history after it. */
export function startYears(length: number): number[] {
  const out: number[] = [];
  for (let y = FIRST_YEAR; y + length - 1 <= LAST_YEAR; y++) out.push(y);
  return out;
}

/** The `length` years beginning at `start`. Throws rather than silently truncating. */
export function window(start: number, length: number): MarketYear[] {
  const from = MARKET_HISTORY.findIndex((y) => y.year === start);
  if (from < 0 || from + length > MARKET_HISTORY.length) {
    throw new Error(`No ${length}-year window starts at ${start}; history runs ${FIRST_YEAR}–${LAST_YEAR}.`);
  }
  return MARKET_HISTORY.slice(from, from + length);
}
