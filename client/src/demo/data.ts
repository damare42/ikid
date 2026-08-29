/**
 * Query helpers over the in-memory store.
 *
 * These stand in for the repository layer and the Prisma joins the server
 * would do. Kept separate from the route handlers so the handlers read like
 * the Express ones they replace.
 */
import type {
  AccountDTO, CategoryDTO, MerchantDTO, TransactionDTO, TransactionQuery,
} from "@shared/types";
import { db, type Row } from "./store.js";

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const ymd = (d: unknown): string =>
  d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

export const asDate = (d: unknown): Date => (d instanceof Date ? d : new Date(String(d)));

// ---------- joins ----------

export const categoryDTO = (id: unknown): CategoryDTO | null => {
  if (id == null) return null;
  const c = db().category.find((r) => r.id === id);
  return c ? { id: c.id, name: c.name as string, type: c.type as CategoryDTO["type"], color: c.color as string } : null;
};

export const merchantDTO = (id: unknown): MerchantDTO | null => {
  if (id == null) return null;
  const m = db().merchant.find((r) => r.id === id);
  return m ? { id: m.id, name: m.name as string } : null;
};

export const accountDTO = (id: unknown): AccountDTO | null => {
  if (id == null) return null;
  const a = db().account.find((r) => r.id === id);
  return a
    ? { id: a.id, name: a.name as string, type: a.type as AccountDTO["type"], currency: (a.currency as string) ?? "USD" }
    : null;
};

export function txnDTO(t: Row): TransactionDTO {
  return {
    id: t.id,
    date: ymd(t.date),
    description: t.description as string,
    amount: t.amount as number,
    balance: (t.balance as number | null) ?? null,
    type: (t.type as TransactionDTO["type"]) ?? ((t.amount as number) >= 0 ? "credit" : "debit"),
    refNumber: (t.refNumber as string | null) ?? null,
    notes: (t.notes as string | null) ?? null,
    isTransfer: Boolean(t.isTransfer),
    cleared: Boolean(t.cleared),
    category: categoryDTO(t.categoryId),
    merchant: merchantDTO(t.merchantId),
    account: accountDTO(t.accountId),
    tags: [],
  };
}

// ---------- transaction querying ----------

/** Everything the app calls "spending": money out, not an internal transfer. */
export const isExpense = (t: Row): boolean => (t.amount as number) < 0 && !t.isTransfer;
export const isIncome = (t: Row): boolean => (t.amount as number) > 0 && !t.isTransfer;

export function allTxns(): Row[] {
  return db().transaction;
}

export function inRange(from?: Date, to?: Date): Row[] {
  return allTxns().filter((t) => {
    const d = asDate(t.date).getTime();
    if (from && d < from.getTime()) return false;
    if (to && d > to.getTime()) return false;
    return true;
  });
}

/** Mirrors transactionRepo.buildWhere + list, including its sort defaults. */
export function queryTxns(q: TransactionQuery): { items: Row[]; total: number } {
  let rows = allTxns();

  if (q.search) {
    const s = q.search.toLowerCase();
    rows = rows.filter((t) => {
      const merchant = merchantDTO(t.merchantId)?.name?.toLowerCase() ?? "";
      return (t.description as string).toLowerCase().includes(s) || merchant.includes(s);
    });
  }
  if (q.categoryId) rows = rows.filter((t) => t.categoryId === q.categoryId);
  if (q.merchantId) rows = rows.filter((t) => t.merchantId === q.merchantId);
  if (q.unassigned) rows = rows.filter((t) => t.accountId == null);
  else if (q.accountId) rows = rows.filter((t) => t.accountId === q.accountId);
  if (q.cleared !== undefined) rows = rows.filter((t) => Boolean(t.cleared) === q.cleared);
  if (q.from) rows = rows.filter((t) => ymd(t.date) >= q.from!);
  if (q.to) rows = rows.filter((t) => ymd(t.date) <= q.to!);
  if (q.minAmount != null || q.maxAmount != null) {
    // Filter on magnitude regardless of sign, like the server does.
    const min = q.minAmount ?? 0;
    const max = q.maxAmount ?? Number.MAX_SAFE_INTEGER;
    rows = rows.filter((t) => {
      const a = Math.abs(t.amount as number);
      return a >= min && a <= max;
    });
  }

  const dir = q.sortDir === "asc" ? 1 : -1;
  const key = q.sortBy ?? "date";
  rows = [...rows].sort((a, b) => {
    let cmp: number;
    if (key === "amount") cmp = (a.amount as number) - (b.amount as number);
    else if (key === "description") cmp = (a.description as string).localeCompare(b.description as string);
    else cmp = asDate(a.date).getTime() - asDate(b.date).getTime();
    // Stable tiebreak, so paging can't drop or repeat a row.
    return cmp !== 0 ? cmp * dir : (a.id - b.id) * dir;
  });

  const total = rows.length;
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 50;
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total };
}

/** Sum of signed amounts, rounded once at the end. */
export const sumAmount = (rows: Row[]): number =>
  round2(rows.reduce((s, t) => s + (t.amount as number), 0));

export const monthKey = (d: unknown): string => ymd(d).slice(0, 7);

/** The newest transaction date in the dataset, which the demo treats as "now"
 *  for month-based screens so they're never looking at an empty current month. */
export function latestDate(): Date {
  let max = 0;
  for (const t of allTxns()) max = Math.max(max, asDate(t.date).getTime());
  return max ? new Date(max) : new Date();
}
