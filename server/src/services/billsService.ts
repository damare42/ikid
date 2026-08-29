/**
 * Bills: the database half.
 *
 * Reads charges out of SQLite and hands them to the pure engine in
 * billsCore.ts. There is no arithmetic in this file.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { sumMoney, round2 } from "./money.js";
import { buildBillsSummary, type MerchantCharges, type MonthlyNetPoint } from "./billsCore.js";
import type { BillsSummary } from "../../../shared/bills.js";
export * from "./billsCore.js";

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
