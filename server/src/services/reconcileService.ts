/**
 * Reconciliation: the database half. Loads rows and delegates every
 * calculation to reconcileCore.ts.
 */
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import {
  buildReconciliation, bucketOf, toYmd,
  type ReconcileTxn,
} from "./reconcileCore.js";
import type {
  ReconcileInput, ReconcileReportDTO, ReconcileBucket, MarkClearedRequest,
  MarkClearedResultDTO, ReconcileTxnDTO,
} from "../../../shared/reconcile.js";
export * from "./reconcileCore.js";

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
