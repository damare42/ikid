/**
 * Repository layer: all Prisma access lives here so services and routes
 * never talk to the database directly.
 */
import { prisma } from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";
import type { TransactionQuery } from "../../../shared/types.js";
import { canonicalMerchantName } from "../services/merchantService.js";

export const TRANSACTION_INCLUDE = {
  category: true,
  merchant: true,
  account: true,
  tags: true,
} satisfies Prisma.TransactionInclude;

export const transactionRepo = {
  buildWhere(q: TransactionQuery): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = {};
    if (q.search) {
      where.OR = [
        { description: { contains: q.search } },
        { notes: { contains: q.search } },
        { merchant: { name: { contains: q.search } } },
      ];
    }
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.merchantId) where.merchantId = q.merchantId;
    if (q.accountId) where.accountId = q.accountId;
    if (q.from || q.to) {
      where.date = {};
      if (q.from) where.date.gte = new Date(q.from);
      if (q.to) where.date.lte = new Date(q.to + "T23:59:59");
    }
    if (q.minAmount != null || q.maxAmount != null) {
      // filter on magnitude regardless of sign
      const abs: Prisma.TransactionWhereInput[] = [];
      const min = q.minAmount ?? 0;
      const max = q.maxAmount ?? Number.MAX_SAFE_INTEGER;
      abs.push({ amount: { gte: min, lte: max } });
      abs.push({ amount: { gte: -max, lte: -min } });
      where.AND = [...((where.AND as Prisma.TransactionWhereInput[]) ?? []), { OR: abs }];
    }
    return where;
  },

  async list(q: TransactionQuery) {
    const where = this.buildWhere(q);
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 50, 100000);
    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: TRANSACTION_INCLUDE,
        orderBy: { [q.sortBy ?? "date"]: q.sortDir ?? "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.transaction.count({ where }),
    ]);
    return { items, total, page, pageSize };
  },

  findById: (id: number) =>
    prisma.transaction.findUnique({ where: { id }, include: TRANSACTION_INCLUDE }),
  findByHashes: (hashes: string[]) =>
    prisma.transaction.findMany({ where: { hash: { in: hashes } }, select: { hash: true } }),
  create: (data: Prisma.TransactionCreateInput) =>
    prisma.transaction.create({ data, include: TRANSACTION_INCLUDE }),
  update: (id: number, data: Prisma.TransactionUpdateInput) =>
    prisma.transaction.update({ where: { id }, data, include: TRANSACTION_INCLUDE }),
  delete: (id: number) => prisma.transaction.delete({ where: { id } }),
  inRange: (from: Date, to: Date) =>
    prisma.transaction.findMany({
      where: { date: { gte: from, lte: to } },
      include: TRANSACTION_INCLUDE,
      orderBy: { date: "asc" },
    }),
  all: () =>
    prisma.transaction.findMany({ include: TRANSACTION_INCLUDE, orderBy: { date: "asc" } }),
};

export const categoryRepo = {
  all: () => prisma.category.findMany({ orderBy: { name: "asc" } }),
  create: (data: { name: string; type: string; color: string }) =>
    prisma.category.create({ data }),
  update: (id: number, data: Partial<{ name: string; type: string; color: string }>) =>
    prisma.category.update({ where: { id }, data }),
  delete: (id: number) => prisma.category.delete({ where: { id } }),
  byName: (name: string) => prisma.category.findUnique({ where: { name } }),
};

export const merchantRepo = {
  all: () =>
    prisma.merchant.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { transactions: true } } },
    }),
  /** New merchants are stored under their canonical brand name. */
  upsertByName: (name: string) => {
    const canonical = canonicalMerchantName(name);
    return prisma.merchant.upsert({
      where: { name: canonical },
      update: {},
      create: { name: canonical },
    });
  },
  update: (id: number, name: string) => prisma.merchant.update({ where: { id }, data: { name } }),
};

export const accountRepo = {
  all: () => prisma.account.findMany({ orderBy: { name: "asc" } }),
  create: (data: { name: string; type: string; currency?: string }) =>
    prisma.account.create({ data }),
  update: (id: number, data: Partial<{ name: string; type: string; currency: string }>) =>
    prisma.account.update({ where: { id }, data }),
  delete: (id: number) => prisma.account.delete({ where: { id } }),
};

export const tagRepo = {
  all: () => prisma.tag.findMany({ orderBy: { name: "asc" } }),
  upsertByName: (name: string) =>
    prisma.tag.upsert({ where: { name }, update: {}, create: { name } }),
};

export const ruleRepo = {
  all: () => prisma.rule.findMany({ include: { category: true }, orderBy: [{ priority: "desc" }, { keyword: "asc" }] }),
  create: (data: { keyword: string; categoryId: number; priority?: number; source?: string }) =>
    prisma.rule.upsert({
      where: { keyword_categoryId: { keyword: data.keyword, categoryId: data.categoryId } },
      update: { priority: data.priority ?? 0, source: data.source ?? "user" },
      create: { ...data },
    }),
  update: (id: number, data: Partial<{ keyword: string; categoryId: number; priority: number }>) =>
    prisma.rule.update({ where: { id }, data }),
  delete: (id: number) => prisma.rule.delete({ where: { id } }),
};

export const budgetRepo = {
  all: () => prisma.budget.findMany({ include: { category: true } }),
  upsert: (categoryId: number, monthlyLimit: number) =>
    prisma.budget.upsert({
      where: { categoryId },
      update: { monthlyLimit },
      create: { categoryId, monthlyLimit },
    }),
  delete: (id: number) => prisma.budget.delete({ where: { id } }),
};

export const goalRepo = {
  all: () => prisma.goal.findMany({ orderBy: { createdAt: "asc" } }),
  create: (data: {
    name: string; icon?: string; targetAmount: number;
    currentSaved?: number; monthlyContribution?: number; deadline?: Date | null;
  }) => prisma.goal.create({ data }),
  update: (id: number, data: Partial<{
    name: string; icon: string; targetAmount: number;
    currentSaved: number; monthlyContribution: number; deadline: Date | null;
  }>) => prisma.goal.update({ where: { id }, data }),
  delete: (id: number) => prisma.goal.delete({ where: { id } }),
};

export const importRepo = {
  all: () => prisma.import.findMany({ orderBy: { importedAt: "desc" } }),
  create: (data: { filename: string; fileType: string; accountId?: number | null }) =>
    prisma.import.create({ data }),
  finish: (id: number, transactionCount: number, duplicateCount: number) =>
    prisma.import.update({ where: { id }, data: { transactionCount, duplicateCount, status: "completed" } }),
  /** Undo an import: delete its transactions then the import record. */
  undo: async (id: number) => {
    await prisma.transaction.deleteMany({ where: { importId: id } });
    return prisma.import.delete({ where: { id } });
  },
};

export const settingRepo = {
  async getAll(): Promise<Record<string, string>> {
    const rows = await prisma.setting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
  set: (key: string, value: string) =>
    prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } }),
};
