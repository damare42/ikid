/**
 * Which merchants are charging you on a schedule, and roughly how much a month.
 *
 * Pure, and shared: the hosted demo can't import Prisma, and this had been
 * written twice already.
 *
 * ---------------------------------------------------------------------------
 * What "recurring" actually means
 *
 * The previous rule asked for amount similarity: at least three charges within
 * 15% of the median. Measured against two years of real-looking data, that is
 * the wrong signal in both directions.
 *
 * It let ordinary shopping in. A grocery run twice a month for two years is 46
 * charges; three of them landing near the median is a certainty, not evidence.
 * So The Turnip Truck, Northbrook Grocers, Halcyon Fuel, Noodle Parliament and
 * Meridian Transit were all being reported as recurring payments, and the
 * "you spend $X/month on subscriptions" figure came out at 85% of total
 * spending — a number nobody could believe, attached to a feature whose whole
 * job is to be believed.
 *
 * It also kept real bills out. An electricity bill varies with the weather
 * (38% of charges near its median) and a streaming service that raised its
 * price varies across the rise (58%). Both are unambiguously recurring.
 *
 * The signal that separates them is *when*, not *how much*. Subscriptions
 * arrive on a cycle; shopping doesn't. Across the same data:
 *
 *     regular billing      gaps ~30.4 days, coefficient of variation 0.03
 *     groceries and fuel   gaps 6–65 days,  coefficient of variation 0.60–1.16
 *
 * Twenty times the spread, with nothing in between. `MAX_GAP_VARIATION` sits
 * far above the tight cluster so that real-world drift — a bill on the 1st,
 * then the 3rd, then after a weekend — stays comfortably inside.
 */

export interface RecurringCharge {
  /** Positive amount (money out). */
  amount: number;
  /** YYYY-MM-DD. */
  date: string;
}

export interface RecurringPayment {
  merchant: string;
  avgAmount: number;
  count: number;
  lastDate: string;
  /** Seen within `ACTIVE_WITHIN_DAYS` of the most recent data. */
  active: boolean;
  monthlyEstimate: number;
  /** Mean days between charges — what made this look like a schedule. */
  intervalDays: number;
}

export const RECURRING = {
  /** Two charges describe one gap, which has no spread. Three is the minimum. */
  minCharges: 3,
  /**
   * Coefficient of variation of the gaps between charges. Regular billing in
   * the sample data sits at 0.03; the most regular *irregular* merchant is at
   * 0.60. Anything below this is a schedule.
   */
  maxGapVariation: 0.35,
  /** Weekly is a plausible subscription; every other day is a habit. */
  minIntervalDays: 5,
  /** Beyond a quarter apart, "recurring" stops being a useful prediction. */
  maxIntervalDays: 100,
  /** Still being charged, as of the newest transaction on file. */
  activeWithinDays: 45,
} as const;

const DAYS_PER_MONTH = 30.44; // 365.25 / 12
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * @param groups   charges per merchant, any order
 * @param asOf     the newest date in the data — not today. A demo dataset or an
 *                 old export would otherwise report everything as inactive.
 */
export function findRecurring(
  groups: Map<string, RecurringCharge[]>,
  asOf: Date,
): RecurringPayment[] {
  const out: RecurringPayment[] = [];

  for (const [merchant, charges] of groups) {
    if (charges.length < RECURRING.minCharges) continue;

    const times = charges.map((c) => new Date(c.date).getTime()).sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => (t - times[i]) / 86_400_000);
    const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (meanGap < RECURRING.minIntervalDays || meanGap > RECURRING.maxIntervalDays) continue;

    const variance = gaps.reduce((s, g) => s + (g - meanGap) ** 2, 0) / gaps.length;
    // Relative spread, so a monthly bill and a weekly one are judged alike.
    if (Math.sqrt(variance) / meanGap > RECURRING.maxGapVariation) continue;

    const amounts = charges.map((c) => c.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const last = new Date(times[times.length - 1]);

    out.push({
      merchant,
      avgAmount: round2(amounts.reduce((s, a) => s + a, 0) / amounts.length),
      count: charges.length,
      lastDate: last.toISOString().slice(0, 10),
      active: asOf.getTime() - last.getTime() < RECURRING.activeWithinDays * 86_400_000,
      // Derived from the observed cadence rather than a capped charges-per-month
      // count. The old `median × min(perMonth, 1.5)` inflated anything arriving
      // more than monthly and quietly under-reported anything weekly.
      monthlyEstimate: round2(median * (DAYS_PER_MONTH / meanGap)),
      intervalDays: Math.round(meanGap * 10) / 10,
    });
  }

  return out.sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);
}
