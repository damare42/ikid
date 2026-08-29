/**
 * Reconciliation DTOs — the wire contract between server and client for
 * "do my books match the bank?".
 *
 * Kept in its own module (rather than shared/types.ts) so the reconciliation
 * slice is self-contained. The server tsconfig includes all of shared/, and
 * the client resolves it via the `@shared/*` path alias.
 */

/**
 * Which side of the statement a transaction falls on. The buckets PARTITION
 * an account's transactions — every row is in exactly one — which is what
 * makes the difference decomposition an identity rather than an estimate.
 */
export type ReconcileBucket =
  /** On or before the statement date, already confirmed against a statement. */
  | "cleared"
  /** On or before the statement date, not yet confirmed. */
  | "uncleared"
  /** Dated after the statement date, so it cannot be in the closing balance. */
  | "after";

export interface ReconcileInput {
  accountId: number;
  /** Statement closing date, YYYY-MM-DD. */
  statementDate: string;
  /** Statement closing balance, signed (a credit card you owe on is negative). */
  statementBalance: number;
  /**
   * Balance before the earliest transaction on file. Defaults to 0, which is
   * right only when the account's whole history was imported. See
   * `suggestedOpeningBalance` for a data-derived starting point.
   */
  openingBalance?: number;
}

export interface ReconcileBucketDTO {
  key: ReconcileBucket;
  /** Human label, safe to render as-is. */
  label: string;
  count: number;
  /** Exact signed sum of the transactions in this bucket. */
  total: number;
}

export interface ReconcileReportDTO {
  accountId: number;
  accountName: string;
  statementDate: string;
  statementBalance: number;
  openingBalance: number;
  /**
   * Opening balance plus EVERY transaction on file for this account, whatever
   * its date or cleared state — the "balance on file" that the Accounts page
   * already shows. This is the number the raw difference is measured from.
   */
  bookBalance: number;
  /**
   * Opening balance plus only the cleared transactions dated on or before the
   * statement date — the app's answer to "what should the bank say?".
   */
  clearedBalance: number;
  /** statementBalance − bookBalance. The gap before anything explains it. */
  difference: number;

  clearedInPeriod: ReconcileBucketDTO;
  uncleared: ReconcileBucketDTO;
  afterStatement: ReconcileBucketDTO;

  /**
   * What neither uncleared nor after-statement transactions explain:
   *   residual = difference + uncleared.total + afterStatement.total
   *            = statementBalance − clearedBalance
   * A non-zero residual means a transaction is missing, duplicated, or has
   * the wrong amount. This is the number worth chasing.
   */
  residual: number;
  /** residual is zero to the cent. */
  balanced: boolean;
  /**
   * Opening balance implied by the earliest transaction's own running-balance
   * column, when the import captured one. Null when it can't be derived.
   */
  suggestedOpeningBalance: number | null;
  /** Plain-language, deterministic explanation lines. */
  explanation: string[];
}

export interface ReconcileTxnDTO {
  id: number;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  cleared: boolean;
  isTransfer: boolean;
  merchant: string | null;
}

export interface MarkClearedRequest {
  cleared: boolean;
  /** Explicit ids — used for single rows and for undo. */
  ids?: number[];
  /** Bulk: everything in this account dated on or before `upToDate`. */
  accountId?: number;
  upToDate?: string; // YYYY-MM-DD
}

export interface MarkClearedResultDTO {
  updated: number;
  /**
   * Exactly the rows whose flag actually changed. Posting these back with the
   * opposite `cleared` restores the previous state precisely — an undo of a
   * bulk mark never touches rows that were already in the target state.
   */
  undoIds: number[];
}
