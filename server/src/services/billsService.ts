/**
 * Bills & renewal calendar — "what is coming out of my account in the next 30 days?"
 *
 * The app already *detects* recurring merchants (analyticsService.recurringPayments)
 * but only reports an average and a last-seen date. To project forward you need
 * the individual dated amounts, so this service runs its own query and keeps
 * every charge, then answers four questions:
 *
 *   1. How often does this merchant charge?      → inferCadence()
 *   2. What will the next charge cost?           → priceLevels() / detectPriceChanges()
 *   3. When will it land?                        → projectOccurrences()
 *   4. Has it quietly stopped?                   → classifyStatus()
 *
 * Everything above the `--- database ---` line is pure (PRINCIPLES rule 2): no
 * Prisma, no clock, no `new Date()` without an argument. The caller passes the
 * reference dates in, so the tests are exact and reproducible.
 *
 * Dates are handled as YYYY-MM-DD strings parsed as UTC midnight, matching how
 * imports store them (services/parsers.ts emits YYYY-MM-DD, and lib/dto.ts
 * reads them back with toISOString()). Doing the arithmetic in local time would
 * shift dates by a day for anyone west of Greenwich.
 *
 * Money goes through services/money.ts — raw float sums drift (see money.ts).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { round2, subMoney, sumBy, sumMoney, toCents } from "./money.js";
import type {
  BillCadence,
  BillConfidence,
  BillDTO,
  BillOccurrence,
  BillPriceChange,
  BillStatus,
  BillsSummary,
} from "../../../shared/bills.js";

// ---------------------------------------------------------------- date helpers

const MS_DAY = 86_400_000;

/** YYYY-MM-DD → whole days since the epoch (UTC, so no timezone drift). */
export function toDayNumber(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

/** Days since the epoch → YYYY-MM-DD. */
export function fromDayNumber(days: number): string {
  return new Date(days * MS_DAY).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export const daysBetween = (a: string, b: string): number => toDayNumber(b) - toDayNumber(a);

const dayOfMonth = (ymd: string): number => Number(ymd.slice(8, 10));
/** 0 = Sunday. 1970-01-01 was a Thursday, hence the +4. */
const weekdayOf = (ymd: string): number => ((toDayNumber(ymd) + 4) % 7 + 7) % 7;

const daysInMonth = (year: number, month1: number): number =>
  new Date(Date.UTC(year, month1, 0)).getUTCDate();

/**
 * Add whole calendar months, clamping the day to the target month's length.
 * A bill charged on the 31st becomes the 28th in February and the 30th in
 * April — which is what the merchant actually does, and what plain "+30.44
 * days" arithmetic gets wrong within two cycles.
 */
export function addMonthsClamped(ymd: string, months: number): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Set the day-of-month, clamped to the month's length. */
function withDayOfMonth(ymd: string, day: number): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  return `${ymd.slice(0, 7)}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- statistics

/** Median of a numeric list. Even lengths take the lower-mean midpoint. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 80th percentile (nearest-rank, no interpolation). */
export function p80(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.8 * (s.length - 1)))];
}

/**
 * Typical distance from the median, ignoring the worst fifth of observations.
 *
 * The choice of statistic matters more than it looks. A standard deviation
 * lets one skipped month brand an otherwise-perfect subscription
 * "unpredictable". A median absolute deviation over-corrects: with five
 * charges it reports ±2 days for dates that wander from the 2nd to the 10th,
 * because it only ever looks at the middle deviation. The 80th percentile
 * keeps the outlier resistance — one doubled gap or one weekend shift is
 * absorbed — while still noticing when most charges are off.
 */
export function spread(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  return p80(values.map((v) => Math.abs(v - m)));
}

// ---------------------------------------------------------------- cadence

/**
 * Nominal cycle lengths in days. Calendar-anchored cadences use average
 * lengths (30.44 = 365.25/12) purely for *matching* observed gaps; the actual
 * date projection uses calendar arithmetic, not these numbers.
 */
export const CADENCE_DAYS: Record<Exclude<BillCadence, "irregular">, number> = {
  weekly: 7,
  biweekly: 14,
  semimonthly: 365.25 / 24, // 15.22
  monthly: 365.25 / 12, // 30.44
  quarterly: 365.25 / 4, // 91.31
  semiannual: 365.25 / 2, // 182.63
  annual: 365.25,
};

/** Cadences that follow the calendar (day-of-month) rather than a day count. */
const CALENDAR_CADENCES = new Set<BillCadence>([
  "semimonthly", "monthly", "quarterly", "semiannual", "annual",
]);

/**
 * Past this much wobble, relative to the cycle, a "cadence" carries no
 * information: if the typical charge misses its own cycle by half a cycle, the
 * projected date is no better than a guess, and we would rather say "not a
 * bill" than print a date. Half a cycle is the natural line — that's the point
 * where the next charge is as likely to land anywhere in the window as on the
 * date we'd show.
 */
const MAX_RELATIVE_JITTER = 0.5;

/**
 * How far an observed median gap may sit from a nominal cycle and still be
 * called that cycle. 25% was chosen from the shape of the buckets, not taste:
 * a "monthly on the 1st" bill has gaps of 28–31 days (±5% of 30.44), so 25%
 * absorbs a bill that slips a week without letting the bands overlap —
 * ±25% gives weekly 5.3–8.8, biweekly 10.5–17.5, monthly 22.8–38.0,
 * quarterly 68–114. A 21-day gap matches nothing and is honestly irregular.
 */
const CADENCE_TOLERANCE = 0.25;

export interface CadenceFit {
  cadence: BillCadence;
  /** Nominal cycle length. For `irregular`, the observed median gap. */
  periodDays: number;
  /** Observed median gap between charges, days. */
  medianGapDays: number;
  /** MAD of the thing that actually varies — see windowDays. */
  jitterDays: number;
  /** ± days of uncertainty on a projected date. */
  windowDays: number;
  confidence: BillConfidence;
}

/**
 * Group numbers into clusters no wider than `tolerance`, treating the
 * day-of-month axis as circular so a bill that lands on the 31st and the 1st
 * counts as one anchor rather than two.
 */
export function clusterDaysOfMonth(days: readonly number[], tolerance: number): number[][] {
  const clusters: number[][] = [];
  for (const d of [...days].sort((a, b) => a - b)) {
    const hit = clusters.find((c) => c.some((x) => Math.abs(x - d) <= tolerance));
    if (hit) hit.push(d);
    else clusters.push([d]);
  }
  // Merge the first and last clusters when they wrap around month end — a bill
  // charged on the 31st in January and the 1st in March is one anchor, not two.
  if (clusters.length > 1) {
    const first = clusters[0];
    const lastCluster = clusters[clusters.length - 1];
    if (31 - lastCluster[lastCluster.length - 1] + first[0] <= tolerance) {
      clusters.pop();
      first.push(...lastCluster);
    }
  }
  return clusters;
}

/**
 * Biweekly and semimonthly are only 1.2 days apart on average, so a median gap
 * of 14–16 fits both. They are distinguishable by *structure*, not spacing:
 * a semimonthly bill holds two fixed days of the month (the 1st and the 15th);
 * a biweekly one holds a fixed weekday and walks through the month.
 */
export function disambiguateFortnightly(dates: readonly string[]): "biweekly" | "semimonthly" {
  const clusters = clusterDaysOfMonth(dates.map(dayOfMonth), 2);
  if (clusters.length <= 2) return "semimonthly";
  const weekdays = new Set(dates.map(weekdayOf));
  if (weekdays.size === 1) return "biweekly";
  // Neither structure is clean. Two anchors would need ≤2 clusters, so more
  // than that with a mixed weekday reads as a drifting fortnightly cycle.
  return "biweekly";
}

/**
 * How far, in days, the typical charge lands from its calendar anchor.
 *
 * A monthly bill has one anchor (the day of the month it charges on) so the
 * spread of days-of-month IS the jitter. A semimonthly bill has two anchors a
 * fortnight apart; measuring the raw spread there would report ±7 days for a
 * bill that has never missed the 1st or the 15th, so each charge is measured
 * against its own nearest anchor instead.
 */
export function calendarJitter(dates: readonly string[], cadence: BillCadence): number {
  const doms = dates.map(dayOfMonth);
  if (cadence !== "semimonthly") return spread(doms);
  const [a, b] = semimonthlyAnchors(dates);
  return p80(doms.map((d) => Math.min(Math.abs(d - a), Math.abs(d - b))));
}

/**
 * Name the cycle behind a list of charge dates (ascending, ≥3 entries).
 *
 * Uses the MEDIAN gap, not the mean, so a single skipped month (which shows up
 * as one double-length gap) doesn't stretch the inferred cycle — the whole
 * reason a subscription that missed December still projects correctly.
 */
export function inferCadence(dates: readonly string[]): CadenceFit {
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));

  const medianGap = median(gaps);
  const irregular: CadenceFit = {
    cadence: "irregular",
    periodDays: medianGap,
    medianGapDays: medianGap,
    jitterDays: spread(gaps),
    windowDays: Math.min(14, Math.ceil(Math.max(3, spread(gaps)))),
    confidence: "low",
  };
  if (gaps.length < 2 || medianGap <= 0) return irregular;

  let best: Exclude<BillCadence, "irregular"> | null = null;
  let bestErr = Infinity;
  for (const [name, days] of Object.entries(CADENCE_DAYS) as [
    Exclude<BillCadence, "irregular">,
    number,
  ][]) {
    const err = Math.abs(medianGap - days) / days;
    if (err < bestErr) {
      bestErr = err;
      best = name;
    }
  }
  if (!best || bestErr > CADENCE_TOLERANCE) return irregular;

  if (best === "biweekly" || best === "semimonthly") best = disambiguateFortnightly(dates);

  const periodDays = CADENCE_DAYS[best];

  // Jitter is measured on whatever the projection actually keys off. Calendar
  // cadences project by day-of-month, so month-length differences (28 vs 31)
  // are NOT uncertainty — measuring them as gap variance would put a ±2 day
  // window on a bill that has charged on the 3rd for two years.
  const jitterDays = CALENDAR_CADENCES.has(best) ? calendarJitter(dates, best) : spread(gaps);
  const relJitter = jitterDays / periodDays;
  if (relJitter > MAX_RELATIVE_JITTER) return irregular;

  // ≥4 intervals (5 charges) and jitter under a tenth of the cycle is a
  // pattern you can bank on; 5 charges is where a coincidence stops being
  // plausible. Under 2 intervals we never get here (3-charge floor).
  const confidence: BillConfidence =
    gaps.length >= 4 && relJitter <= 0.1
      ? "high"
      : relJitter <= 0.3
        ? "medium"
        : "low";

  return {
    cadence: best,
    periodDays,
    medianGapDays: medianGap,
    jitterDays,
    // Cap at 14: past a fortnight of slop the date is not a projection any
    // more, and a huge ± reads as precision the number doesn't have.
    windowDays: Math.min(14, Math.ceil(jitterDays)),
    confidence,
  };
}

// ---------------------------------------------------------------- price levels

/**
 * Two amounts count as the same price when they differ by no more than 2% or
 * 25c, whichever is larger. The relative part stops a $1 wobble on a $220
 * insurance premium reading as a repricing; the 25c floor stops a $9.99
 * subscription being flagged for a tax-rounding cent — while still catching
 * the 50c-a-month creep that streaming services actually do.
 */
export function priceTolerance(amount: number): number {
  return Math.max(0.25, Math.abs(amount) * 0.02);
}

const samePrice = (a: number, b: number): boolean =>
  Math.abs(a - b) <= priceTolerance(a) + 1e-9;

export interface Charge {
  id: number;
  /** YYYY-MM-DD. */
  date: string;
  /** Positive money out. */
  amount: number;
}

export interface PriceLevel {
  amount: number;
  from: string;
  to: string;
  count: number;
}

/**
 * Collapse a charge history into consecutive runs of the same price.
 *
 * A single charge at a different amount whose neighbours agree with each other
 * is dropped as an outlier, not reported as two price changes: buying a one-off
 * item from a merchant you also subscribe to is common, and "Northbrook
 * Streaming went from $15.49 to $61.00 and back" is a lie about the bill.
 */
export function priceLevels(charges: readonly Charge[]): PriceLevel[] {
  if (charges.length === 0) return [];

  const kept = charges.filter((c, i) => {
    if (i === 0 || i === charges.length - 1) return true;
    const prev = charges[i - 1].amount;
    const next = charges[i + 1].amount;
    return !(samePrice(prev, next) && !samePrice(prev, c.amount));
  });

  const levels: PriceLevel[] = [];
  for (const c of kept) {
    const cur = levels[levels.length - 1];
    if (cur && samePrice(cur.amount, c.amount)) {
      cur.to = c.date;
      cur.count++;
      // Track the newest amount within the level so a slow 1c drift doesn't
      // anchor forever on a stale figure.
      cur.amount = round2(c.amount);
    } else {
      levels.push({ amount: round2(c.amount), from: c.date, to: c.date, count: 1 });
    }
  }
  return levels;
}

/**
 * True when the amount moves nearly every cycle — a utility or a card bill,
 * not a subscription. Threshold is half the transitions: a subscription that
 * repriced twice in six charges (2/5 = 0.4) still reads as a fixed price with
 * two changes, which is the point of the feature; a bill where most cycles
 * differ (a power bill: ~1.0) does not.
 */
export function isVariableAmount(charges: readonly Charge[]): boolean {
  if (charges.length < 3) return false;
  let transitions = 0;
  for (let i = 1; i < charges.length; i++) {
    if (!samePrice(charges[i - 1].amount, charges[i].amount)) transitions++;
  }
  return transitions / (charges.length - 1) > 0.5;
}

/** Step changes between consecutive price levels, oldest first. */
export function detectPriceChanges(charges: readonly Charge[]): BillPriceChange[] {
  const levels = priceLevels(charges);
  const out: BillPriceChange[] = [];
  for (let i = 1; i < levels.length; i++) {
    const from = levels[i - 1].amount;
    const to = levels[i].amount;
    out.push({
      date: levels[i].from,
      from,
      to,
      deltaPct: from === 0 ? 0 : Math.round(((to - from) / from) * 1000) / 10,
      chargesAtNewPrice: levels[i].count,
    });
  }
  return out;
}

// ---------------------------------------------------------------- status

/**
 * Slack allowed before a missing charge is treated as missing.
 *
 * A quarter of the cycle, floored at 5 days and capped at 30. The floor covers
 * the ordinary reasons a monthly charge slides — a weekend, a bank holiday, a
 * card re-auth, a statement that posts late. The cap stops an annual bill from
 * getting a three-month grace period, which would make "stopped" meaningless
 * for exactly the bills where a silent lapse costs the most.
 */
export function graceDays(periodDays: number): number {
  return Math.min(30, Math.max(5, periodDays * 0.25));
}

export function classifyStatus(daysSinceLast: number, periodDays: number): BillStatus {
  const grace = graceDays(periodDays);
  if (daysSinceLast <= periodDays + grace) return "active";
  if (daysSinceLast <= periodDays * 2 + grace) return "late";
  return "stopped";
}

// ---------------------------------------------------------------- projection

/**
 * The next charge date strictly after `after`, given the cadence anchor.
 * Calendar cadences step in whole months from the last real charge, so the
 * day-of-month is preserved; weekly ones step in days.
 */
function stepFrom(anchor: string, cadence: BillCadence, periodDays: number, index: number): string {
  switch (cadence) {
    case "weekly":
      return fromDayNumber(toDayNumber(anchor) + 7 * index);
    case "biweekly":
      return fromDayNumber(toDayNumber(anchor) + 14 * index);
    case "monthly":
      return addMonthsClamped(anchor, index);
    case "quarterly":
      return addMonthsClamped(anchor, 3 * index);
    case "semiannual":
      return addMonthsClamped(anchor, 6 * index);
    case "annual":
      return addMonthsClamped(anchor, 12 * index);
    default:
      // irregular — the median gap is the only thing we have.
      return fromDayNumber(toDayNumber(anchor) + Math.round(periodDays) * index);
  }
}

/**
 * Semimonthly bills have two anchors a fortnight apart (the 1st and the 15th,
 * say). Derive them from the observed days-of-month so the projection lands on
 * the merchant's real dates rather than "last charge + 15".
 */
function semimonthlyAnchors(dates: readonly string[]): [number, number] {
  const clusters = clusterDaysOfMonth(dates.map(dayOfMonth), 2);
  const centres = clusters
    .map((c) => Math.round(median(c)))
    .sort((a, b) => a - b);
  if (centres.length >= 2) return [centres[0], centres[1]];
  const only = centres[0] ?? dayOfMonth(dates[dates.length - 1]);
  return [only, ((only + 14) % 30) + 1];
}

export interface ProjectionInput {
  cadence: BillCadence;
  periodDays: number;
  windowDays: number;
  /** All observed charge dates, ascending. */
  dates: readonly string[];
  amount: number;
  /** Inclusive start of the window (normally today), YYYY-MM-DD. */
  today: string;
  horizonDays: number;
  /**
   * Include one already-due-but-unseen occurrence. True for `late` bills:
   * that money has not left the account yet, so leaving it out understates
   * what is coming.
   */
  includeOverdue: boolean;
}

const MAX_OCCURRENCES = 200; // hard stop; 90 days of weekly is 13

/**
 * Every projected charge inside [today, today + horizonDays], plus (when
 * `includeOverdue`) the one occurrence that was expected and never arrived.
 */
export function projectOccurrences(input: ProjectionInput): BillOccurrence[] {
  const { cadence, periodDays, windowDays, dates, amount, today, horizonDays } = input;
  if (dates.length === 0 || horizonDays <= 0) return [];

  const last = dates[dates.length - 1];
  const lastDay = toDayNumber(last);
  const todayDay = toDayNumber(today);
  const endDay = todayDay + horizonDays;

  // Candidate dates, strictly after the last real charge, in order.
  const candidates: string[] = [];
  if (cadence === "semimonthly") {
    const [a, b] = semimonthlyAnchors(dates);
    // Start a month early so an anchor later in the last charge's own month
    // (charged on the 1st, the 15th still to come) isn't skipped.
    let month = addMonthsClamped(last, -1);
    for (let i = 0; i < MAX_OCCURRENCES && candidates.length < MAX_OCCURRENCES; i++) {
      for (const day of [a, b]) candidates.push(withDayOfMonth(month, day));
      if (toDayNumber(withDayOfMonth(month, a)) > endDay) break;
      month = addMonthsClamped(month, 1);
    }
    candidates.sort();
  } else {
    for (let i = 1; i <= MAX_OCCURRENCES; i++) {
      const date = stepFrom(last, cadence, periodDays, i);
      candidates.push(date);
      if (toDayNumber(date) > endDay) break;
    }
  }

  const out: BillOccurrence[] = [];
  for (const date of candidates) {
    const day = toDayNumber(date);
    if (day <= lastDay || day > endDay) continue;
    const overdue = day < todayDay;
    if (overdue && !input.includeOverdue) continue;
    out.push({ date, amount: round2(amount), windowDays, overdue });
  }
  return out;
}

// ---------------------------------------------------------------- bill assembly

/** Fewer than three charges gives at most one gap — indistinguishable from
 *  coincidence, so no cadence and no projection. */
export const MIN_CHARGES = 3;

export interface BuildBillOptions {
  /** Today, YYYY-MM-DD. Drives the projection window. */
  today: string;
  /**
   * Newest transaction date anywhere in the data. Status is measured against
   * THIS, not today: if the user last imported in March, every bill would look
   * stopped in June, which is a statement about the imports, not the bills.
   */
  observedThrough: string;
  horizonDays: number;
}

export interface MerchantCharges {
  merchant: string;
  merchantId: number | null;
  /** Ascending by date. */
  charges: Charge[];
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Turn one merchant's charge history into a bill, or null when it isn't one
 * (too few charges, or no nameable cycle).
 */
export function buildBill(input: MerchantCharges, opts: BuildBillOptions): BillDTO | null {
  const charges = [...input.charges].sort((a, b) => a.date.localeCompare(b.date));
  if (charges.length < MIN_CHARGES) return null;

  const dates = charges.map((c) => c.date);
  const fit = inferCadence(dates);
  // No nameable cycle → this is a merchant you shop at, not a bill. Projecting
  // it would be inventing a number.
  if (fit.cadence === "irregular") return null;

  const variableAmount = isVariableAmount(charges);
  const levels = priceLevels(charges);
  const priceChanges = variableAmount ? [] : detectPriceChanges(charges);

  // The next charge costs the CURRENT price, not the historical average — the
  // whole reason recurringPayments()'s avgAmount is unusable here. For a
  // variable bill there is no current price, so use the median of the last
  // three cycles as the least-bad estimate.
  const recent = charges.slice(-3).map((c) => c.amount);
  const expectedAmount = variableAmount
    ? round2(median(recent))
    : round2(levels[levels.length - 1]?.amount ?? charges[charges.length - 1].amount);

  const amounts = charges.map((c) => c.amount);
  const lastDate = dates[dates.length - 1];
  const daysSinceLast = Math.max(0, daysBetween(lastDate, opts.observedThrough));
  const status = classifyStatus(daysSinceLast, fit.periodDays);

  const upcoming =
    status === "stopped"
      ? []
      : projectOccurrences({
          cadence: fit.cadence,
          periodDays: fit.periodDays,
          windowDays: fit.windowDays,
          dates,
          amount: expectedAmount,
          today: opts.today,
          horizonDays: opts.horizonDays,
          includeOverdue: status === "late",
        });

  const nextDate = upcoming[0]?.date ?? stepFrom(lastDate, fit.cadence, fit.periodDays, 1);
  const missedCycles = Math.max(0, Math.floor(daysSinceLast / fit.periodDays));

  const statusNote =
    status === "active"
      ? `Charged ${lastDate}. Next expected around ${nextDate}` +
        (fit.windowDays > 0 ? ` (±${plural(fit.windowDays, "day")}).` : ".")
      : status === "late"
        ? `Expected around ${nextDate} but nothing has appeared in ${plural(daysSinceLast, "day")}. ` +
          `It may simply be running late — but a failed payment and a cancellation look the same ` +
          `in bank data, so Ikid cannot tell you which this is.`
        : `Nothing since ${lastDate} — about ${plural(missedCycles, "cycle")} missed. ` +
          `A cancellation, a failed payment and an expired card are indistinguishable in a ` +
          `statement, so this is only "it stopped charging". Worth checking with ${input.merchant}. ` +
          `Excluded from the totals below.`;

  const firstLevel = levels[0]?.amount ?? expectedAmount;
  // A month's worth of this bill, for ranking and the committed total.
  const monthlyEquivalent = round2((expectedAmount * (365.25 / 12)) / fit.periodDays);

  return {
    merchant: input.merchant,
    merchantId: input.merchantId,
    cadence: fit.cadence,
    periodDays: round2(fit.periodDays),
    confidence: fit.confidence,
    windowDays: fit.windowDays,
    status,
    statusNote,
    expectedAmount,
    variableAmount,
    amountRange: { min: round2(Math.min(...amounts)), max: round2(Math.max(...amounts)) },
    chargeCount: charges.length,
    firstDate: dates[0],
    lastDate,
    lastAmount: round2(charges[charges.length - 1].amount),
    daysSinceLast,
    priceChanges,
    priceChangeSinceStart: variableAmount ? 0 : subMoney(expectedAmount, firstLevel),
    upcoming,
    horizonTotal: sumBy(upcoming, (o) => o.amount),
    monthlyEquivalent,
    transactionIds: charges.map((c) => c.id),
  };
}

// ---------------------------------------------------------------- surplus

export interface MonthlyNetPoint {
  /** YYYY-MM. */
  month: string;
  income: number;
  expenses: number;
}

/**
 * Average monthly (income − expenses) over the last whole months.
 *
 * Six months by default: long enough to absorb one lumpy month (an annual
 * insurance renewal, December), short enough that a pay rise last quarter
 * isn't dragged down by the year before it. The current month is excluded by
 * the caller — a partial month always looks like a surplus.
 */
export function averageMonthlySurplus(
  points: readonly MonthlyNetPoint[],
  months = 6,
): { average: number; monthsUsed: number } {
  const used = points.slice(-months);
  if (used.length === 0) return { average: 0, monthsUsed: 0 };
  const total = sumMoney(used.map((p) => subMoney(p.income, p.expenses)));
  return { average: round2(total / used.length), monthsUsed: used.length };
}

// ---------------------------------------------------------------- summary

export interface BuildSummaryOptions extends BuildBillOptions {
  monthly: readonly MonthlyNetPoint[];
  /** Newest transaction date, or null when there are no transactions. */
  observedThroughOrNull: string | null;
}

/** How stale the data may be before "stopped" verdicts stop meaning anything. */
export const STALE_DATA_DAYS = 7;

export function buildBillsSummary(
  groups: readonly MerchantCharges[],
  opts: BuildSummaryOptions,
): BillsSummary {
  const bills: BillDTO[] = [];
  const stopped: BillDTO[] = [];
  const belowFloorMerchants: string[] = [];

  for (const g of groups) {
    if (g.charges.length > 0 && g.charges.length < MIN_CHARGES) {
      // Two charges is a coincidence until proven otherwise, but the user
      // deserves to know we looked. One charge isn't worth mentioning.
      if (g.charges.length === MIN_CHARGES - 1) belowFloorMerchants.push(g.merchant);
      continue;
    }
    const bill = buildBill(g, opts);
    if (!bill) continue;
    (bill.status === "stopped" ? stopped : bills).push(bill);
  }

  // Soonest first; a bill with no occurrence in the window sinks to the bottom.
  const sortKey = (b: BillDTO) => b.upcoming[0]?.date ?? "9999-12-31";
  bills.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.merchant.localeCompare(b.merchant));
  stopped.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.merchant.localeCompare(b.merchant));

  const horizonTotal = sumBy(bills, (b) => b.horizonTotal);
  const overdueTotal = sumMoney(
    bills.flatMap((b) => b.upcoming.filter((o) => o.overdue).map((o) => o.amount)),
  );

  const { average, monthsUsed } = averageMonthlySurplus(opts.monthly);
  const surplusForHorizon =
    monthsUsed > 0 ? round2((average * opts.horizonDays) / (365.25 / 12)) : null;
  const pctOfSurplus =
    surplusForHorizon != null && toCents(surplusForHorizon) > 0
      ? Math.round((horizonTotal / surplusForHorizon) * 1000) / 10
      : null;

  const observedThrough = opts.observedThroughOrNull;
  const dataStale =
    observedThrough == null || daysBetween(observedThrough, opts.today) > STALE_DATA_DAYS;

  return {
    horizonDays: opts.horizonDays,
    from: opts.today,
    to: fromDayNumber(toDayNumber(opts.today) + opts.horizonDays),
    observedThrough,
    dataStale,
    bills,
    stopped,
    horizonTotal,
    overdueTotal,
    avgMonthlySurplus: average,
    surplusMonths: monthsUsed,
    surplusForHorizon,
    pctOfSurplus,
    monthlyCommitted: sumBy(bills, (b) => b.monthlyEquivalent),
    belowFloorMerchants: belowFloorMerchants.sort(),
  };
}

// ---------------------------------------------------------------- database

/*
 * Everything below talks to Prisma. It exists only to feed the pure functions
 * above; there is no arithmetic here. Several services query `prisma` directly
 * (backupRestore.ts, accountStatusService.ts) — this follows that precedent
 * rather than widening the shared repositories.
 */

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** Accounting invariants, restated locally so this file owns its own query.
 *  A transfer is never spending (a card payment is not a bill), and an
 *  investment purchase is a contribution, not consumption. */
// Deliberately not `as const`: that makes OR a readonly tuple, and Prisma's
// TransactionWhereInput wants a mutable array. The readonly version compiles
// everywhere except here, and the resulting error cascades — Prisma falls back
// to the scalar row type, so `select` appears to be ignored and every
// `r.merchant` downstream reports "does not exist".
const NOT_A_TRANSFER: Prisma.TransactionWhereInput = {
  isTransfer: false,
  OR: [{ categoryId: null }, { category: { type: { not: "transfer" } } }],
};

/** All outgoing, non-transfer, non-investment charges grouped by merchant. */
export async function loadMerchantCharges(): Promise<MerchantCharges[]> {
  const rows = await prisma.transaction.findMany({
    where: { amount: { lt: 0 }, ...NOT_A_TRANSFER },
    select: {
      id: true,
      date: true,
      amount: true,
      merchantId: true,
      merchant: { select: { name: true } },
      category: { select: { name: true } },
    },
    orderBy: { date: "asc" },
  });

  const byMerchant = new Map<string, MerchantCharges>();
  for (const r of rows) {
    // No merchant means no identity to track across months — an unnamed
    // "Unknown" bucket would blend every uncategorised charge into one fake bill.
    if (!r.merchant) continue;
    if (r.category?.name === "Investment") continue;
    const g = byMerchant.get(r.merchant.name) ?? {
      merchant: r.merchant.name,
      merchantId: r.merchantId,
      charges: [],
    };
    g.charges.push({ id: r.id, date: ymd(r.date), amount: round2(-r.amount) });
    byMerchant.set(r.merchant.name, g);
  }
  return [...byMerchant.values()];
}

/** Whole-month income and expenses, oldest first, excluding the current month. */
export async function loadMonthlyNet(today: string, months = 6): Promise<MonthlyNetPoint[]> {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  // Start `months` whole months back; end at the last day before this month.
  const from = new Date(Date.UTC(y, m - 1 - months, 1));
  const to = new Date(Date.UTC(y, m - 1, 1));

  const rows = await prisma.transaction.findMany({
    where: { date: { gte: from, lt: to }, ...NOT_A_TRANSFER },
    select: {
      date: true,
      amount: true,
      category: { select: { name: true } },
    },
  });

  const map = new Map<string, { income: number[]; expenses: number[] }>();
  for (const r of rows) {
    const key = ymd(r.date).slice(0, 7);
    const p = map.get(key) ?? { income: [], expenses: [] };
    if (r.amount > 0) p.income.push(r.amount);
    // Investment contributions are savings, not spending — same treatment as
    // analyticsService.monthlySeries, so the surplus here matches Analytics.
    else if (r.amount < 0 && r.category?.name !== "Investment") p.expenses.push(-r.amount);
    map.set(key, p);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({
      month,
      income: sumMoney(v.income),
      expenses: sumMoney(v.expenses),
    }));
}

export const HORIZONS = [30, 60, 90] as const;
export type Horizon = (typeof HORIZONS)[number];

/** Today in the server's local timezone, as YYYY-MM-DD. */
function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function billsSummary(horizonDays: Horizon = 30): Promise<BillsSummary> {
  const today = localToday();
  const [groups, monthly, newest] = await Promise.all([
    loadMerchantCharges(),
    loadMonthlyNet(today),
    prisma.transaction.aggregate({ _max: { date: true } }),
  ]);
  const observedThroughOrNull = newest._max.date ? ymd(newest._max.date) : null;
  return buildBillsSummary(groups, {
    today,
    // With no data at all, "observed through" is today: every bill list is
    // empty anyway, and this keeps the date arithmetic total.
    observedThrough: observedThroughOrNull ?? today,
    observedThroughOrNull,
    horizonDays,
    monthly,
  });
}

