import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parse, ApiError } from "../lib/errors.js";
import { toTransactionDTO } from "../lib/dto.js";
import { transactionRepo, merchantRepo, tagRepo, ruleRepo } from "../repositories/index.js";
import { prisma } from "../lib/prisma.js";
import type { TransactionQuery } from "../../../shared/types.js";

export const transactionsRouter = Router();

const querySchema = z.object({
  search: z.string().optional(),
  categoryId: z.coerce.number().optional(),
  merchantId: z.coerce.number().optional(),
  accountId: z.coerce.number().optional(),
  // NOT z.coerce.boolean(): that is truthiness of a string, so "false" arrives
  // as `true` and the filter does the opposite of what the URL says. Query
  // params are always strings, so match on the literal.
  unassigned: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  cleared: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  sortBy: z.enum(["date", "amount", "description"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
});

transactionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = parse(querySchema, req.query) as TransactionQuery;
    const result = await transactionRepo.list(q);
    res.json({ ...result, items: result.items.map(toTransactionDTO) });
  }),
);

/** Manually add a transaction (income, cash expense, adjustment…). */
const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  amount: z.number().refine((n) => n !== 0, "Amount cannot be zero"),
  categoryId: z.number().nullable().optional(),
  accountId: z.number().nullable().optional(),
  merchant: z.string().optional(),
  notes: z.string().nullable().optional(),
  isTransfer: z.boolean().optional(),
});

transactionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);
    const { transactionHash } = await import("../services/dedupe.js");
    const { categorize, extractMerchant } = await import("../services/categorization.js");

    // Auto-categorize when no category was chosen.
    let categoryId = body.categoryId ?? null;
    if (categoryId == null) {
      const rules = await ruleRepo.all();
      categoryId = categorize(body.description, rules)?.categoryId ?? null;
    }
    const merchantName = body.merchant?.trim() || extractMerchant(body.description);
    const merchant = await merchantRepo.upsertByName(merchantName);

    let isTransfer = body.isTransfer ?? false;
    if (!body.isTransfer && categoryId != null) {
      const cat = await prisma.category.findUnique({ where: { id: categoryId } });
      if (cat?.type === "transfer") isTransfer = true;
    }

    let hash = transactionHash({
      date: body.date, amount: body.amount, description: body.description,
      merchant: merchantName, accountId: body.accountId ?? null,
    });
    // Manual entries shouldn't be blocked by dedupe — salt on collision.
    if ((await transactionRepo.findByHashes([hash])).length > 0) {
      hash = `${hash}:manual-${Date.now()}`;
    }

    const created = await prisma.transaction.create({
      data: {
        date: new Date(body.date),
        description: body.description,
        amount: body.amount,
        type: body.amount >= 0 ? "credit" : "debit",
        notes: body.notes ?? null,
        hash,
        isTransfer,
        categoryId,
        merchantId: merchant.id,
        accountId: body.accountId ?? null,
      },
      include: { category: true, merchant: true, account: true, tags: true },
    });
    res.json(toTransactionDTO(created));
  }),
);

/**
 * Bulk-assign (or clear) the account for many transactions at once — either an
 * explicit list of ids, or everything matching a filter (e.g. all Unassigned).
 * accountId null unassigns.
 */
const assignSchema = z.object({
  accountId: z.number().nullable(),
  ids: z.array(z.number()).optional(),
  filter: z
    .object({
      search: z.string().optional(),
      categoryId: z.number().optional(),
      merchantId: z.number().optional(),
      accountId: z.number().optional(),
      unassigned: z.boolean().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      minAmount: z.number().optional(),
      maxAmount: z.number().optional(),
    })
    .optional(),
});

transactionsRouter.post(
  "/assign-account",
  asyncHandler(async (req, res) => {
    const body = parse(assignSchema, req.body);
    if (body.accountId != null) {
      const account = await prisma.account.findUnique({ where: { id: body.accountId } });
      if (!account) throw new ApiError(404, "Account not found");
    }
    let where;
    if (body.ids && body.ids.length > 0) {
      where = { id: { in: body.ids } };
    } else if (body.filter) {
      where = transactionRepo.buildWhere(body.filter);
    } else {
      throw new ApiError(400, "Provide transaction ids or a filter to assign.");
    }
    const result = await prisma.transaction.updateMany({ where, data: { accountId: body.accountId } });
    res.json({ updated: result.count });
  }),
);

const updateSchema = z.object({
  categoryId: z.number().nullable().optional(),
  accountId: z.number().nullable().optional(),
  merchant: z.string().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  isTransfer: z.boolean().optional(),
  /**
   * Rule learning. Defaults to true: whenever a category is set, a learned
   * rule (merchant -> category) is saved and applied to other uncategorized
   * transactions from the same merchant. Pass false to opt out.
   */
  learn: z.boolean().optional(),
});

transactionsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = parse(updateSchema, req.body);
    const existing = await transactionRepo.findById(id);
    if (!existing) throw new ApiError(404, "Transaction not found");

    const data: any = {};
    if (body.categoryId !== undefined)
      data.category = body.categoryId ? { connect: { id: body.categoryId } } : { disconnect: true };
    if (body.accountId !== undefined)
      data.account = body.accountId ? { connect: { id: body.accountId } } : { disconnect: true };
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.isTransfer !== undefined) data.isTransfer = body.isTransfer;
    // Assigning a transfer-type category (Transfers, Savings) implies transfer,
    // so it's excluded from income/spending unless explicitly overridden.
    if (body.categoryId && body.isTransfer === undefined) {
      const cat = await prisma.category.findUnique({ where: { id: body.categoryId } });
      if (cat?.type === "transfer") data.isTransfer = true;
    }
    if (body.merchant !== undefined && body.merchant.trim()) {
      const m = await merchantRepo.upsertByName(body.merchant.trim());
      data.merchant = { connect: { id: m.id } };
    }
    if (body.tags !== undefined) {
      const tagRecords = await Promise.all(body.tags.map((t) => tagRepo.upsertByName(t.trim())));
      data.tags = { set: tagRecords.map((t) => ({ id: t.id })) };
    }

    const updated = await transactionRepo.update(id, data);

    // Category learning (on by default): remember merchant -> category for
    // future imports, and retroactively fix other uncategorized transactions
    // from the same merchant.
    const shouldLearn = body.learn !== false;
    let relabeled = 0;
    if (shouldLearn && body.categoryId && updated.merchant) {
      await ruleRepo.create({
        keyword: updated.merchant.name.toUpperCase(),
        categoryId: body.categoryId,
        priority: 5,
        source: "learned",
      });
      const unknown = await prisma.category.findUnique({ where: { name: "Unknown" } });
      const result = await prisma.transaction.updateMany({
        where: {
          merchantId: updated.merchant.id,
          id: { not: updated.id },
          OR: [{ categoryId: null }, ...(unknown ? [{ categoryId: unknown.id }] : [])],
        },
        data: { categoryId: body.categoryId },
      });
      relabeled = result.count;
    }
    res.json({ ...toTransactionDTO(updated), relabeled });
  }),
);

transactionsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await transactionRepo.delete(Number(req.params.id));
    res.json({ ok: true });
  }),
);

/** Re-scan existing transactions and flag transfers (card payments, savings
 *  moves) using the current keyword list + transfer-type categories. */
transactionsRouter.post(
  "/detect-transfers",
  asyncHandler(async (_req, res) => {
    const { isTransferDescription } = await import("../services/categorization.js");
    const { TRANSFER_KEYWORDS } = await import("../services/defaults.js");
    const txns = await prisma.transaction.findMany({
      where: { isTransfer: false },
      select: { id: true, description: true, category: { select: { type: true } } },
    });
    const ids = txns
      .filter(
        (t) =>
          isTransferDescription(t.description, TRANSFER_KEYWORDS) ||
          t.category?.type === "transfer",
      )
      .map((t) => t.id);
    if (ids.length > 0) {
      await prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { isTransfer: true } });
    }
    res.json({ scanned: txns.length, flagged: ids.length });
  }),
);

/** Re-apply all rules to existing transactions (optionally only Unknown ones). */
transactionsRouter.post(
  "/recategorize",
  asyncHandler(async (req, res) => {
    const onlyUnknown = req.body?.onlyUnknown !== false;
    const { categorize } = await import("../services/categorization.js");
    const rules = await ruleRepo.all();
    const unknown = await prisma.category.findUnique({ where: { name: "Unknown" } });
    const where = onlyUnknown && unknown ? { categoryId: unknown.id } : {};
    const txns = await prisma.transaction.findMany({ where, select: { id: true, description: true } });
    let updated = 0;
    for (const t of txns) {
      const match = categorize(t.description, rules);
      if (match) {
        await prisma.transaction.update({ where: { id: t.id }, data: { categoryId: match.categoryId } });
        updated++;
      }
    }
    res.json({ scanned: txns.length, updated });
  }),
);
