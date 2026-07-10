import { prisma } from "../lib/prisma.js";
import { budgetRepo } from "../repositories/index.js";
import type { BudgetStatusDTO } from "../../../shared/types.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Budget status for a given month, with an end-of-month spend forecast. */
export async function budgetStatus(year: number, month: number): Promise<BudgetStatusDTO[]> {
  const budgets = await budgetRepo.all();
  if (budgets.length === 0) return [];

  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);
  const now = new Date();
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = now >= from && now <= to;
  const daysElapsed = isCurrentMonth ? Math.max(1, now.getDate()) : daysInMonth;

  const spentRows = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: {
      categoryId: { in: budgets.map((b) => b.categoryId) },
      date: { gte: from, lte: to },
      amount: { lt: 0 },
      isTransfer: false,
    },
    _sum: { amount: true },
  });
  const spentByCat = new Map(spentRows.map((r) => [r.categoryId, -(r._sum.amount ?? 0)]));

  return budgets
    .map((b) => {
      const spent = round2(spentByCat.get(b.categoryId) ?? 0);
      const remaining = round2(b.monthlyLimit - spent);
      const forecast = round2((spent / daysElapsed) * daysInMonth);
      return {
        id: b.id,
        categoryId: b.categoryId,
        categoryName: b.category.name,
        categoryColor: b.category.color,
        monthlyLimit: b.monthlyLimit,
        spent,
        remaining,
        pctUsed: b.monthlyLimit > 0 ? round2((spent / b.monthlyLimit) * 100) : 0,
        overBudget: spent > b.monthlyLimit,
        forecast,
      };
    })
    .sort((a, b) => b.pctUsed - a.pctUsed);
}
