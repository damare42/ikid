/**
 * Money arithmetic that doesn't drift.
 *
 * Amounts are stored as SQLite REALs (IEEE-754 doubles). That's fine for a
 * single value — every realistic amount round-trips exactly — but *accumulating*
 * them does drift: summing this project's 1,211 real transactions as raw floats
 * gives 22220.499999999956 instead of 22220.5.
 *
 * The fix is to do the arithmetic in integer minor units (cents) and come back
 * to a Number at the end, so every total is exact to the cent. Displayed values
 * were already rounded, so this changes nothing a user sees — it removes a class
 * of latent bug (drift that grows with volume, and `total === 0` comparisons
 * that mysteriously fail).
 *
 * Long-term, storing integer cents in the schema is the better answer; see
 * docs/COMPETITIVE-NOTES.md. This helper buys correctness now, without a
 * migration.
 */

/** Money → integer cents. Rounds half away from zero, so -0.005 → -1, not 0. */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return amount < 0 ? -Math.round(-amount * 100) : Math.round(amount * 100);
}

/** Integer cents → money. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Round a single amount to whole cents. */
export function round2(amount: number): number {
  return fromCents(toCents(amount));
}

/** Exact sum of money values (no float drift, whatever the length). */
export function sumMoney(amounts: readonly number[]): number {
  let cents = 0;
  for (const a of amounts) cents += toCents(a);
  return fromCents(cents);
}

/** Exact sum of a money field across a list of records. */
export function sumBy<T>(items: readonly T[], pick: (item: T) => number): number {
  let cents = 0;
  for (const item of items) cents += toCents(pick(item));
  return fromCents(cents);
}

/** Exact addition/subtraction of two money values. */
export function addMoney(a: number, b: number): number {
  return fromCents(toCents(a) + toCents(b));
}
export function subMoney(a: number, b: number): number {
  return fromCents(toCents(a) - toCents(b));
}

/**
 * Multiply money by a plain factor (a rate, a share, a count) and round to
 * cents — e.g. units × unit price, or an amount × a percentage.
 */
export function mulMoney(amount: number, factor: number): number {
  return round2(amount * factor);
}

/** Are two money values equal to the cent? Use instead of `===`. */
export function moneyEquals(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}
