/**
 * Reconciliation — "do my books match the bank?"
 *
 * The Accounts page (accountStatusService) answers "where did I leave off
 * importing?". This answers the harder question that comes next: given a
 * statement's closing balance and date, does what ikid has on file agree with
 * it — and if not, *why not*.
 *
 * A single difference number is close to useless. The value is in splitting it
 * into causes the user can act on. The buckets PARTITION the account's
 * transactions, so the split is an identity, not an estimate:
 *
 *   bookBalance    = opening + cleared + uncleared + afterStatement
 *   clearedBalance = opening + cleared
 *   difference     = statementBalance − bookBalance
 *   residual       = difference + uncleared.total + afterStatement.total
 *                  = statementBalance − clearedBalance          ← always true
 *
 * `residual` is therefore both "what nothing explains" and the classic
 * reconciliation difference. Zero means the books match. Non-zero means a
 * transaction is missing, duplicated, or wrong — the thing worth chasing.
 *
 * ── Transfers ────────────────────────────────────────────────────────────
 * `isTransfer` rows are INCLUDED here, deliberately and with no opt-out.
 *
 * The flag exists for one purpose: keeping money you moved between your own
 * accounts out of *income and spending* totals, so a credit-card payment isn't
 * counted as consumption on top of the purchases it settles. That is a
 * question about behaviour.
 *
 * Reconciliation is a question about *cash*: did this balance move? A card
 * payment genuinely leaves the checking account and genuinely appears on the
 * bank statement. Excluding transfers would put every single reconciliation
 * out by exactly the sum of the account's transfers, and — worse — it would
 * put it out by an amount that *looks* like a real residual, sending the user
 * hunting for a missing transaction that was never missing. Since
 * reconciliation is scoped to one account and compared against that account's
 * own statement, the two legs of an internal transfer are never netted against
 * each other; each side reconciles against its own bank. See
 * tests/reconcile.test.ts, "transfers".
 *
 * ── Purity ───────────────────────────────────────────────────────────────
 * Everything that produces a number is a pure function over plain rows
 * (PRINCIPLES rule 2); the async wrappers below only fetch rows and hand them
 * over. All arithmetic goes through services/money.ts, because a
 * reconciliation tool that reports a one-cent difference caused by float drift
 * is worse than no reconciliation tool at all.
 */
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { addMoney, subMoney, sumBy, toCents } from "./money.js";
import type {
  MarkClearedRequest,
  MarkClearedResultDTO,
  ReconcileBucket,
  ReconcileBucketDTO,
  ReconcileInput,
  ReconcileReportDTO,
  ReconcileTxnDTO,
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
// Thin by design: fetch rows, hand them to the pure code above. Several
// services (backupRestore, accountStatusService) query prisma directly rather
// than going through repositories/index.ts; this follows that precedent.

/**
 * Inclusive end-of-day instant for a YYYY-MM-DD.
 *
 * Deliberately UTC, to match toYmd(): a row whose ISO day is <= `day` has an
 * instant <= `day`T23:59:59.999Z and vice versa. That equivalence is what
 * makes "mark everything up to this date" select exactly the rows the report
 * counted as in-period — an off-by-one here would clear a row the user never
 * saw listed.
 */
export function endOfDayUtc(day: string): Date {
  return new Date(`${day}T23:59:59.999Z`);
}

async function loadAccountRows(accountId: number): Promise<ReconcileTxn[]> {
  const rows = await prisma.transaction.findMany({
    where: { accountId },
    select: {
      id: true, date: true, description: true, amount: true,
      cleared: true, isTransfer: true, balance: true,
      merchant: { select: { name: true } },
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  return rows.map((t) => ({
    id: t.id,
    date: toYmd(t.date),
    description: t.description,
    amount: t.amount,
    cleared: t.cleared,
    isTransfer: t.isTransfer,
    balance: t.balance,
    merchant: t.merchant?.name ?? null,
  }));
}

async function requireAccount(accountId: number): Promise<{ id: number; name: string }> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, name: true },
  });
  if (!account) throw new ApiError(404, "Account not found");
  return account;
}

export async function reconcileAccount(input: ReconcileInput): Promise<ReconcileReportDTO> {
  const account = await requireAccount(input.accountId);
  const rows = await loadAccountRows(account.id);
  return buildReconciliation(rows, { ...input, accountName: account.name });
}

/**
 * Cap on rows returned for one bucket. The report's counts and totals are
 * always exact and computed over every row; this only bounds the list the
 * browser has to render, which on a years-old account's "already cleared"
 * bucket would otherwise be tens of thousands of rows.
 */
export const MAX_BUCKET_ROWS = 500;

/**
 * The transactions behind one component of the difference (PRINCIPLES rule 3:
 * every number clicks through to its rows). Newest first — the recent end is
 * where an unreconciled item usually is.
 */
export async function bucketTransactions(
  accountId: number,
  statementDate: string,
  bucket: ReconcileBucket,
): Promise<ReconcileTxnDTO[]> {
  const account = await requireAccount(accountId);
  const rows = await loadAccountRows(account.id);
  return rows
    .filter((t) => bucketOf(t, statementDate) === bucket)
    .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
    .slice(0, MAX_BUCKET_ROWS)
    .map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      amount: t.amount,
      cleared: t.cleared,
      isTransfer: t.isTransfer,
      merchant: t.merchant ?? null,
    }));
}

/**
 * Mark rows cleared or uncleared — one row, an explicit list, or every row in
 * an account up to a date.
 *
 * Only rows that actually change are touched, and their ids come back as
 * `undoIds`. Re-posting those with the opposite flag restores the exact prior
 * state, so a mistaken bulk mark over hundreds of rows is one click to
 * reverse and can never "un-clear" rows the user had cleared earlier.
 */
export async function markCleared(req: MarkClearedRequest): Promise<MarkClearedResultDTO> {
  let scope;
  if (req.ids && req.ids.length > 0) {
    scope = { id: { in: req.ids } };
  } else if (req.accountId != null && req.upToDate) {
    await requireAccount(req.accountId);
    scope = { accountId: req.accountId, date: { lte: endOfDayUtc(req.upToDate) } };
  } else {
    throw new ApiError(400, "Provide transaction ids, or an accountId with upToDate.");
  }

  // Select first, then update by id: the ids we return are exactly the rows
  // whose value flipped, which is what makes the undo precise.
  const changing = await prisma.transaction.findMany({
    where: { ...scope, cleared: !req.cleared },
    select: { id: true },
  });
  const undoIds = changing.map((t) => t.id);
  if (undoIds.length === 0) return { updated: 0, undoIds: [] };

  const result = await prisma.transaction.updateMany({
    where: { id: { in: undoIds } },
    data: { cleared: req.cleared },
  });
  return { updated: result.count, undoIds };
}
