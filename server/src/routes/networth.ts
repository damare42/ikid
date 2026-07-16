import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parse } from "../lib/errors.js";
import {
  addSnapshot, assetHistory, createAsset, deleteAsset, history, summary, updateAsset,
} from "../services/netWorthService.js";

export const netWorthRouter = Router();

netWorthRouter.get("/summary", asyncHandler(async (_req, res) => res.json(await summary())));

netWorthRouter.get("/history", asyncHandler(async (req, res) => {
  res.json(await history(Number(req.query.months) || 24));
}));

const KINDS = ["cash", "investment", "property", "vehicle", "other", "mortgage", "loan", "credit"] as const;

const assetSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(KINDS),
  value: z.number().min(0),
  icon: z.string().max(8).optional(),
  units: z.number().positive().nullable().optional(),
  unitPrice: z.number().min(0).nullable().optional(),
  ratePct: z.number().min(0).max(50).nullable().optional(),
  monthlyPayment: z.number().min(0).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

netWorthRouter.post("/assets", asyncHandler(async (req, res) => {
  res.json(await createAsset(parse(assetSchema, req.body)));
}));

netWorthRouter.patch("/assets/:id", asyncHandler(async (req, res) => {
  const body = parse(assetSchema.omit({ value: true }).partial(), req.body);
  res.json(await updateAsset(Number(req.params.id), body));
}));

netWorthRouter.post("/assets/:id/snapshot", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({ value: z.number().min(0), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    req.body,
  );
  res.json(await addSnapshot(Number(req.params.id), body.value, body.date));
}));

netWorthRouter.get("/assets/:id/history", asyncHandler(async (req, res) => {
  res.json(await assetHistory(Number(req.params.id)));
}));

netWorthRouter.delete("/assets/:id", asyncHandler(async (req, res) => {
  await deleteAsset(Number(req.params.id));
  res.json({ ok: true });
}));
