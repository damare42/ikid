/**
 * Per-account upload status — "where did I leave off importing?"
 *
 * For each account (plus an "Unassigned" bucket) reports the latest and
 * earliest transaction dates already imported, the transaction count, the
 * computed balance, and the most recent import file. The latest transaction
 * date is the resume point: the next statement should pick up after it.
 *
 * The assembly is a pure function (unit-tested); the async wrapper just feeds
 * it Prisma aggregates.
 */
import { prisma } from "../lib/prisma.js";
import { accountRepo } from "../repositories/index.js";
import type { AccountStatusDTO } from "../../../shared/types.js";

const r2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date | null | undefined): string | null =>
  d ? new Date(d).toISOString().slice(0, 10) : null;

export interface AccountInfo {
  id: number;
  name: string;
  type: string;
  currency: string;
}

export interface TxnAgg {
  accountId: number | null;
  count: number;
  sum: number;
  minDate: Date | null;
  maxDate: Date | null;
}

export interface ImportInfo {
  accountId: number | null;
  importedAt: Date;
  filename: string;
}

/**
 * Combine account rows with transaction aggregates and the latest import per
 * account into sorted status DTOs. Stalest (or never-used) accounts first so
 * the ones needing an upload rise to the top; the Unassigned bucket sinks
 * to the bottom.
 */
export function buildAccountStatus(
  accounts: AccountInfo[],
  aggs: TxnAgg[],
  imports: ImportInfo[],
): AccountStatusDTO[] {
  const aggById = new Map<number | null, TxnAgg>();
  for (const a of aggs) aggById.set(a.accountId, a);

  // latest import per account (imports already newest-first)
  const lastImport = new Map<number | null, ImportInfo>();
  for (const imp of imports) {
    if (!lastImport.has(imp.accountId)) lastImport.set(imp.accountId, imp);
  }

  const rows: AccountStatusDTO[] = accounts.map((a) => {
    const agg = aggById.get(a.id);
    const imp = lastImport.get(a.id);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      txnCount: agg?.count ?? 0,
      balance: r2(agg?.sum ?? 0),
      latestTxnDate: ymd(agg?.maxDate ?? null),
      earliestTxnDate: ymd(agg?.minDate ?? null),
      lastImportAt: imp ? imp.importedAt.toISOString() : null,
      lastImportFile: imp?.filename ?? null,
    };
  });

  // Unassigned bucket, only if such transactions exist.
  const unassigned = aggById.get(null);
  if (unassigned && unassigned.count > 0) {
    const imp = lastImport.get(null);
    rows.push({
      id: null,
      name: "Unassigned",
      type: "none",
      currency: "USD",
      txnCount: unassigned.count,
      balance: r2(unassigned.sum),
      latestTxnDate: ymd(unassigned.maxDate),
      earliestTxnDate: ymd(unassigned.minDate),
      lastImportAt: imp ? imp.importedAt.toISOString() : null,
      lastImportFile: imp?.filename ?? null,
    });
  }

  // Sort: real accounts by staleness (oldest latest-date first, never-used at
  // the very top), Unassigned always last.
  return rows.sort((a, b) => {
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    if (a.latestTxnDate === b.latestTxnDate) return a.name.localeCompare(b.name);
    if (a.latestTxnDate === null) return -1; // never imported → needs attention
    if (b.latestTxnDate === null) return 1;
    return a.latestTxnDate < b.latestTxnDate ? -1 : 1;
  });
}

export async function accountStatuses(): Promise<AccountStatusDTO[]> {
  const accounts = await accountRepo.all();
  const grouped = await prisma.transaction.groupBy({
    by: ["accountId"],
    _count: { _all: true },
    _sum: { amount: true },
    _min: { date: true },
    _max: { date: true },
  });
  const aggs: TxnAgg[] = grouped.map((g) => ({
    accountId: g.accountId,
    count: g._count._all,
    sum: g._sum.amount ?? 0,
    minDate: g._min.date ?? null,
    maxDate: g._max.date ?? null,
  }));
  const importRows = await prisma.import.findMany({
    orderBy: { importedAt: "desc" },
    select: { accountId: true, importedAt: true, filename: true },
  });
  return buildAccountStatus(
    accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency })),
    aggs,
    importRows,
  );
}
