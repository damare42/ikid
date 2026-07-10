import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parse } from "../lib/errors.js";
import { budgetRepo } from "../repositories/index.js";
import { budgetStatus } from "../services/budgetService.js";

export const budgetsRouter = Router();

budgetsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const now = new Date();
    const month = typeof req.query.month === "string" ? req.query.month : "";
    const [y, m] = month.match(/^\d{4}-\d{2}$/)
      ? month.split("-").map(Number)
      : [now.getFullYear(), now.getMonth() + 1];
    res.json(await budgetStatus(y, m));
  }),
);

const budgetSchema = z.object({ categoryId: z.number(), monthlyLimit: z.number().positive() });
budgetsRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const body = parse(budgetSchema, req.body);
    res.json(await budgetRepo.upsert(body.categoryId, body.monthlyLimit));
  }),
);
budgetsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await budgetRepo.delete(Number(req.params.id));
    res.json({ ok: true });
  }),
);
