/** CRUD for categories, merchants, accounts, tags and categorization rules. */
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parse } from "../lib/errors.js";
import { categoryRepo, merchantRepo, accountRepo, tagRepo, ruleRepo } from "../repositories/index.js";
import { prisma } from "../lib/prisma.js";

export const metaRouter = Router();

// --- categories ---
metaRouter.get("/categories", asyncHandler(async (_req, res) => res.json(await categoryRepo.all())));

const categorySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["expense", "income", "transfer"]).default("expense"),
  color: z.string().default("#64748b"),
});
metaRouter.post("/categories", asyncHandler(async (req, res) => {
  res.json(await categoryRepo.create(parse(categorySchema, req.body)));
}));
metaRouter.patch("/categories/:id", asyncHandler(async (req, res) => {
  res.json(await categoryRepo.update(Number(req.params.id), parse(categorySchema.partial(), req.body)));
}));
metaRouter.delete("/categories/:id", asyncHandler(async (req, res) => {
  await categoryRepo.delete(Number(req.params.id));
  res.json({ ok: true });
}));

// --- merchants ---
metaRouter.get("/merchants", asyncHandler(async (_req, res) => res.json(await merchantRepo.all())));
metaRouter.patch("/merchants/:id", asyncHandler(async (req, res) => {
  const body = parse(z.object({ name: z.string().min(1) }), req.body);
  res.json(await merchantRepo.update(Number(req.params.id), body.name));
}));

/** Auto-merge merchant variants (brand aliases + word-prefix rule). */
metaRouter.post("/merchants/normalize", asyncHandler(async (_req, res) => {
  const { normalizeAllMerchants } = await import("../services/merchantService.js");
  res.json(await normalizeAllMerchants());
}));

/** Manually merge selected merchants into one name. */
metaRouter.post("/merchants/merge", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({ ids: z.array(z.number()).min(1), name: z.string().min(1) }),
    req.body,
  );
  const { mergeMerchants } = await import("../services/merchantService.js");
  const targetId = await mergeMerchants(body.ids, body.name);
  res.json({ ok: true, targetId });
}));

// --- accounts ---
metaRouter.get("/accounts", asyncHandler(async (_req, res) => {
  const accounts = await accountRepo.all();
  // include computed balance per account
  const sums = await prisma.transaction.groupBy({ by: ["accountId"], _sum: { amount: true } });
  const byId = new Map(sums.map((s) => [s.accountId, s._sum.amount ?? 0]));
  res.json(accounts.map((a) => ({ ...a, balance: Math.round((byId.get(a.id) ?? 0) * 100) / 100 })));
}));

/** Per-account upload status: latest transaction date + last import. */
metaRouter.get("/accounts/status", asyncHandler(async (_req, res) => {
  const { accountStatuses } = await import("../services/accountStatusService.js");
  res.json(await accountStatuses());
}));

const accountSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["checking", "savings", "credit", "loan"]),
  currency: z.string().default("USD"),
});
metaRouter.post("/accounts", asyncHandler(async (req, res) => {
  res.json(await accountRepo.create(parse(accountSchema, req.body)));
}));
metaRouter.patch("/accounts/:id", asyncHandler(async (req, res) => {
  res.json(await accountRepo.update(Number(req.params.id), parse(accountSchema.partial(), req.body)));
}));
metaRouter.delete("/accounts/:id", asyncHandler(async (req, res) => {
  await accountRepo.delete(Number(req.params.id));
  res.json({ ok: true });
}));

// --- tags ---
metaRouter.get("/tags", asyncHandler(async (_req, res) => res.json(await tagRepo.all())));

// --- rules ---
metaRouter.get("/rules", asyncHandler(async (_req, res) => {
  const rules = await ruleRepo.all();
  res.json(rules.map((r) => ({
    id: r.id, keyword: r.keyword, priority: r.priority, source: r.source,
    categoryId: r.categoryId, categoryName: r.category.name,
  })));
}));

const ruleSchema = z.object({
  keyword: z.string().min(1),
  categoryId: z.number(),
  priority: z.number().default(0),
});
metaRouter.post("/rules", asyncHandler(async (req, res) => {
  const body = parse(ruleSchema, req.body);
  res.json(await ruleRepo.create({ ...body, keyword: body.keyword.toUpperCase(), source: "user" }));
}));
metaRouter.patch("/rules/:id", asyncHandler(async (req, res) => {
  res.json(await ruleRepo.update(Number(req.params.id), parse(ruleSchema.partial(), req.body)));
}));
metaRouter.delete("/rules/:id", asyncHandler(async (req, res) => {
  await ruleRepo.delete(Number(req.params.id));
  res.json({ ok: true });
}));
