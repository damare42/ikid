/**
 * Shared DTOs for the Bills & renewal calendar.
 *
 * Kept dependency-free (same rule as shared/types.ts) so both the Express
 * server and the React client can import it.
 *
 * Vocabulary, because "recurring payment" is overloaded:
 *   charge     — one real transaction that already happened
 *   occurrence — one *projected* future charge, which may never happen
 *   bill       — a merchant whose charges form a regular enough cadence that
 *                the next occurrence can be projected
 */

/**
 * How often a bill charges. `irregular` means the gaps between charges are too
 * scattered to name a cycle — those merchants are excluded from projections
 * rather than guessed at.
 */
export type BillCadence =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "irregular";

/**
 * - `active`  — the last charge landed inside the expected window.
 * - `late`    — one expected charge hasn't appeared yet.
 * - `stopped` — two or more expected charges are missing.
 *
 * Deliberately NOT "cancelled" or "failed": a bank statement cannot tell those
 * apart. See `statusNote` on each bill.
 */
export type BillStatus = "active" | "late" | "stopped";

/** How much to trust the projected date. Driven by charge count and jitter. */
export type BillConfidence = "high" | "medium" | "low";

/** A step change in what a merchant charges. */
export interface BillPriceChange {
  /** Date of the first charge at the new price (YYYY-MM-DD). */
  date: string;
  from: number;
  to: number;
  /** Signed percentage change, one decimal place. */
  deltaPct: number;
  /**
   * Charges observed at the new price so far. 1 means the new price has been
   * seen exactly once — real, but not yet confirmed by a repeat.
   */
  chargesAtNewPrice: number;
}

/** One projected future charge. */
export interface BillOccurrence {
  /** Projected date (YYYY-MM-DD). Uncertain by ±`windowDays`. */
  date: string;
  amount: number;
  /** ± days of uncertainty. 0 means the cadence has been exact so far. */
  windowDays: number;
  /**
   * True when this occurrence was expected before today and hasn't shown up.
   * Money that is probably still to leave the account, so it stays in the
   * horizon total — but it is called out separately.
   */
  overdue: boolean;
}

export interface BillDTO {
  merchant: string;
  merchantId: number | null;
  cadence: BillCadence;
  /** Nominal cycle length in days (30.44 for monthly, etc.). */
  periodDays: number;
  confidence: BillConfidence;
  /** ± days of uncertainty on every projected date for this bill. */
  windowDays: number;
  status: BillStatus;
  /** Plain-language status, explicit about what the data cannot show. */
  statusNote: string;
  /** What the next charge should cost — the current price, not the average. */
  expectedAmount: number;
  /** True when the amount moves nearly every cycle (a utility, not a plan). */
  variableAmount: boolean;
  amountRange: { min: number; max: number };
  chargeCount: number;
  firstDate: string;
  lastDate: string;
  lastAmount: number;
  /** Days between the last charge and the newest data on file. */
  daysSinceLast: number;
  /** Empty for `variableAmount` bills — every cycle differing isn't news. */
  priceChanges: BillPriceChange[];
  /** Signed money difference between the first and current price levels. */
  priceChangeSinceStart: number;
  /** Projected charges inside the requested horizon. */
  upcoming: BillOccurrence[];
  /** Exact sum of `upcoming`. */
  horizonTotal: number;
  /** Cost normalised to one month, for ranking and the committed total. */
  monthlyEquivalent: number;
  /** Every transaction behind this row (PRINCIPLES rule 3: auditability). */
  transactionIds: number[];
}

export interface BillsSummary {
  /** 30, 60 or 90. */
  horizonDays: number;
  /** Start of the window (today, server-local) as YYYY-MM-DD. */
  from: string;
  /** End of the window as YYYY-MM-DD. */
  to: string;
  /** Newest transaction date anywhere in the data, or null when empty. */
  observedThrough: string | null;
  /**
   * True when the newest transaction is over a week old. Every "stopped"
   * verdict below is suspect while this is true — no imports looks exactly
   * like no charges.
   */
  dataStale: boolean;
  /** Bills that are active or late, soonest occurrence first. */
  bills: BillDTO[];
  /** Bills that appear to have stopped. Never counted in the totals. */
  stopped: BillDTO[];
  /** Exact sum of every projected occurrence in the horizon. */
  horizonTotal: number;
  /** Portion of `horizonTotal` that was expected before today. */
  overdueTotal: number;
  /** Average monthly income − expenses over `surplusMonths` whole months. */
  avgMonthlySurplus: number;
  /** How many whole months the average is built from (0 = no history). */
  surplusMonths: number;
  /** `avgMonthlySurplus` scaled to the horizon; null with no history. */
  surplusForHorizon: number | null;
  /** horizonTotal as a percentage of surplusForHorizon; null with no history. */
  pctOfSurplus: number | null;
  /** Sum of `monthlyEquivalent` across active and late bills. */
  monthlyCommitted: number;
  /**
   * Merchants with exactly two charges. Two charges give one gap, which cannot
   * be told apart from coincidence, so they are not projected — but the user
   * should know they were seen and skipped.
   */
  belowFloorMerchants: string[];
}
