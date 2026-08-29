/**
 * Reconciliation: the pure engine.
 *
 * Split out from reconcileService.ts so the same decomposition runs on the
 * server against SQLite and in the hosted demo against an in-browser dataset.
 * One implementation of the maths, two callers.
 */
import { addMoney, subMoney, sumBy, toCents } from "./money.js";
import type {
  ReconcileBucket,
  ReconcileBucketDTO,
  ReconcileInput,
  ReconcileReportDTO,
} from "../../../shared/reconcile.js";

/** The only shape the pure core needs to know about. */
export interface ReconcileTxn {
  id: number;
  /** Calendar day, YYYY-MM-DD. */
  date: string;
  description: string;
  amount: number;
  cleared: boolean;
  isTransfer: boolean;
  /** Running balance from the statement, when the importer captured one. */
  balance?: number | null;
  merchant?: string | null;
}

export interface PureReconcileInput extends ReconcileInput {
  accountName: string;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Date → calendar day.
 *
 * Reconciliation compares DAYS, never instants: a purchase timestamped
 * 14:32 on the statement's closing date is on that statement, and so is one
 * timestamped 00:00. Using the ISO (UTC) day matches lib/dto.ts and
 * accountStatusService, so a transaction lands in the same day here as it
 * does everywhere else in the app — consistency matters more than which
 * timezone convention is "right", because a row that reads as the 31st in the
 * transaction list and the 30th here would be unexplainable.
 */
export function toYmd(d: Date | string): string {
  if (typeof d === "string") return YMD_RE.test(d) ? d : new Date(d).toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Which bucket a transaction falls in. Date is decided FIRST: a transaction
 * dated after the statement closed cannot be part of its closing balance even
 * if it has since been marked cleared, so "after" wins over "cleared".
 */
export function bucketOf(txn: ReconcileTxn, statementDate: string): ReconcileBucket {
  if (txn.date > statementDate) return "after";
  return txn.cleared ? "cleared" : "uncleared";
}

const LABELS: Record<ReconcileBucket, string> = {
  cleared: "Cleared on or before the statement date",
  uncleared: "Not yet cleared, on or before the statement date",
  after: "Dated after the statement date",
};

function bucketDTO(key: ReconcileBucket, rows: readonly ReconcileTxn[]): ReconcileBucketDTO {
  return { key, label: LABELS[key], count: rows.length, total: sumBy(rows, (t) => t.amount) };
}

/**
 * Opening balance implied by the earliest imported running balance.
 *
 * Most statement formats carry a running balance per row. If we know the
 * balance immediately AFTER transaction i, then the balance before the first
 * transaction on file is that balance minus every amount up to and including
 * i. This assumes the running-balance column belongs to the row order
 * (date, id) — which is how importers write them, since statements are
 * date-ordered and rows are inserted in file order.
 *
 * It is only ever a *suggestion*: the user sees it, and chooses. Returns null
 * when no row carries a balance.
 */
export function suggestOpeningBalance(rows: readonly ReconcileTxn[]): number | null {
  const sorted = [...rows].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
  const i = sorted.findIndex((t) => t.balance != null);
  if (i < 0) return null;
  const throughI = sorted.slice(0, i + 1);
  return subMoney(sorted[i].balance as number, sumBy(throughI, (t) => t.amount));
}

const fmt = (n: number) =>
  (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/**
 * The whole calculation, pure. Give it an account's transactions and the
 * statement, get back every number the screen shows.
 */
export function buildReconciliation(
  rows: readonly ReconcileTxn[],
  input: PureReconcileInput,
): ReconcileReportDTO {
  const { statementDate, accountId, accountName } = input;
  const statementBalance = input.statementBalance;
  const openingBalance = input.openingBalance ?? 0;

  const buckets: Record<ReconcileBucket, ReconcileTxn[]> = { cleared: [], uncleared: [], after: [] };
  for (const t of rows) buckets[bucketOf(t, statementDate)].push(t);

  const clearedInPeriod = bucketDTO("cleared", buckets.cleared);
  const uncleared = bucketDTO("uncleared", buckets.uncleared);
  const afterStatement = bucketDTO("after", buckets.after);

  // Balance on file: opening plus everything, whatever its date or state.
  // Same reading of "balance" the Accounts page uses (sum of signed amounts),
  // so the two screens can never disagree.
  const bookBalance = addMoney(
    openingBalance,
    addMoney(clearedInPeriod.total, addMoney(uncleared.total, afterStatement.total)),
  );
  const clearedBalance = addMoney(openingBalance, clearedInPeriod.total);

  const difference = subMoney(statementBalance, bookBalance);
  // residual = difference + uncleared + after. Identical to
  // statementBalance − clearedBalance; asserted both ways in the tests.
  const residual = addMoney(difference, addMoney(uncleared.total, afterStatement.total));
  const balanced = toCents(residual) === 0;

  const explanation: string[] = [];
  if (rows.length === 0) {
    explanation.push(
      `No transactions on file for ${accountName}. Import this account's statements, then reconcile.`,
    );
  }
  explanation.push(
    `Your records say ${fmt(bookBalance)}; the statement says ${fmt(statementBalance)} — a difference of ${fmt(difference)}.`,
  );
  if (uncleared.count > 0) {
    explanation.push(
      `${plural(uncleared.count, "transaction")} on or before ${statementDate} ${uncleared.count === 1 ? "is" : "are"} not marked cleared, worth ${fmt(uncleared.total)}. If the bank has not processed ${uncleared.count === 1 ? "it" : "them"} yet, that is expected.`,
    );
  }
  if (afterStatement.count > 0) {
    explanation.push(
      `${plural(afterStatement.count, "transaction")} ${afterStatement.count === 1 ? "is" : "are"} dated after ${statementDate}, worth ${fmt(afterStatement.total)}. The statement closed before ${afterStatement.count === 1 ? "it" : "they"} happened.`,
    );
  }
  explanation.push(
    balanced
      ? `Nothing is left unexplained — this account is reconciled to ${statementDate}.`
      : `${fmt(residual)} is left unexplained. That usually means a transaction is missing from ikid, was imported twice, or has the wrong amount. Look for a single ${fmt(Math.abs(residual))} item first, then for a pair that differs by that amount.`,
  );
  if (!balanced && openingBalance === 0 && rows.length > 0) {
    explanation.push(
      `If you did not import this account's full history, set an opening balance — the balance just before your earliest transaction on file. Starting from zero when the account did not will show up as exactly this kind of residual.`,
    );
  }

  return {
    accountId,
    accountName,
    statementDate,
    statementBalance,
    openingBalance,
    bookBalance,
    clearedBalance,
    difference,
    clearedInPeriod,
    uncleared,
    afterStatement,
    residual,
    balanced,
    suggestedOpeningBalance: suggestOpeningBalance(rows),
    explanation,
  };
}

// ─────────────────────────── database wrappers ───────────────────────────
