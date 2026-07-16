/** Deterministic calculators (pure finmath) + saved-calculation history. */
import { Router } from "express";
import { z } from "zod";
import { ApiError, asyncHandler, parse } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { amortization, coastFire, compoundGrowth, fireProjection, loanPayoff } from "../services/finmath.js";
import type { SavedCalcDTO } from "../../../shared/types.js";

export const calcRouter = Router();

// ---------- saved calculations ----------

const CALC_KINDS = ["amortization", "compound", "fire", "coast", "retirement"] as const;

function toSavedDTO(c: { id: number; kind: string; name: string; inputs: string; createdAt: Date }): SavedCalcDTO {
  let inputs: Record<string, number> = {};
  try {
    inputs = JSON.parse(c.inputs);
  } catch {
    /* corrupted row — return empty inputs rather than 500 */
  }
  return {
    id: c.id,
    kind: c.kind as SavedCalcDTO["kind"],
    name: c.name,
    inputs,
    createdAt: c.createdAt.toISOString().slice(0, 10),
  };
}

calcRouter.get("/saved", asyncHandler(async (_req, res) => {
  const rows = await prisma.savedCalculation.findMany({ orderBy: { createdAt: "desc" } });
  res.json(rows.map(toSavedDTO));
}));

calcRouter.post("/saved", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      kind: z.enum(CALC_KINDS),
      name: z.string().min(1).max(80),
      inputs: z.record(z.number()),
    }),
    req.body,
  );
  if (Object.keys(body.inputs).length > 24) throw new ApiError(400, "Too many inputs.");
  const row = await prisma.savedCalculation.create({
    data: { kind: body.kind, name: body.name, inputs: JSON.stringify(body.inputs) },
  });
  res.json(toSavedDTO(row));
}));

calcRouter.delete("/saved/:id", asyncHandler(async (req, res) => {
  await prisma.savedCalculation.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
}));

// ---------- calculators ----------

calcRouter.post("/amortization", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      principal: z.number().positive().max(1e9),
      ratePct: z.number().min(0).max(50),
      years: z.number().min(0.5).max(50),
      extraMonthly: z.number().min(0).max(1e6).default(0),
    }),
    req.body,
  );
  res.json(amortization(body.principal, body.ratePct, body.years, body.extraMonthly));
}));

calcRouter.post("/compound", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      principal: z.number().min(0).max(1e9),
      monthly: z.number().min(0).max(1e6),
      ratePct: z.number().min(0).max(50),
      years: z.number().min(1).max(80),
    }),
    req.body,
  );
  res.json(compoundGrowth(body.principal, body.monthly, body.ratePct, body.years));
}));

calcRouter.post("/fire", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      currentAge: z.number().min(10).max(90),
      currentBalance: z.number().min(0).max(1e9),
      monthlyContribution: z.number().min(0).max(1e6),
      annualSpending: z.number().positive().max(1e7),
      ratePct: z.number().min(0).max(50),
      swrPct: z.number().min(1).max(20).default(4),
    }),
    req.body,
  );
  res.json(fireProjection(body));
}));

calcRouter.post("/coast", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      currentAge: z.number().min(10).max(90),
      retireAge: z.number().min(11).max(100),
      currentBalance: z.number().min(0).max(1e9),
      monthlyContribution: z.number().min(0).max(1e6),
      annualSpending: z.number().positive().max(1e7),
      ratePct: z.number().min(0).max(50),
      swrPct: z.number().min(1).max(20).default(4),
    }),
    req.body,
  );
  if (body.retireAge <= body.currentAge) {
    res.status(400).json({ error: "Retirement age must be after your current age." });
    return;
  }
  res.json(coastFire(body));
}));

calcRouter.post("/payoff", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      balance: z.number().positive().max(1e9),
      ratePct: z.number().min(0).max(50),
      payment: z.number().positive().max(1e6),
      extraMonthly: z.number().min(0).max(1e6).default(0),
    }),
    req.body,
  );
  res.json(loanPayoff(body.balance, body.ratePct, body.payment, body.extraMonthly));
}));
