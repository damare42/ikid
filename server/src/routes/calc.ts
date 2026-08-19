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

/** Multi-debt payoff: compare snowball vs avalanche. */
calcRouter.post("/debt-plan", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      debts: z.array(
        z.object({
          name: z.string().min(1).max(80),
          balance: z.number().min(0).max(1e9),
          ratePct: z.number().min(0).max(50),
          minPayment: z.number().min(0).max(1e6),
        }),
      ).min(1).max(30),
      extraMonthly: z.number().min(0).max(1e6).default(0),
    }),
    req.body,
  );
  const { comparePayoff } = await import("../services/debtPayoff.js");
  res.json(comparePayoff(body.debts, body.extraMonthly));
}));

/**
 * Suggest debts from the user's own data: Net Worth liabilities first (they
 * carry a rate and a monthly payment), then any credit/loan accounts with a
 * negative balance.
 */
calcRouter.get("/debt-plan/prefill", asyncHandler(async (_req, res) => {
  const { summary } = await import("../services/netWorthService.js");
  const { accountRepo } = await import("../repositories/index.js");
  const { prisma } = await import("../lib/prisma.js");

  const debts: { name: string; balance: number; ratePct: number; minPayment: number; source: string }[] = [];

  try {
    const nw = await summary();
    for (const a of nw.assets) {
      if (!a.isLiability || a.value <= 0) continue;
      debts.push({
        name: a.name,
        balance: a.value,
        ratePct: a.ratePct ?? 0,
        minPayment: a.monthlyPayment ?? 0,
        source: "networth",
      });
    }
  } catch { /* no assets yet */ }

  try {
    const accounts = await accountRepo.all();
    const sums = await prisma.transaction.groupBy({ by: ["accountId"], _sum: { amount: true } });
    const byId = new Map(sums.map((s) => [s.accountId, s._sum.amount ?? 0]));
    for (const a of accounts) {
      if (a.type !== "credit" && a.type !== "loan") continue;
      const owed = Math.round(-(byId.get(a.id) ?? 0) * 100) / 100; // spend is negative
      if (owed <= 0) continue;
      if (debts.some((d) => d.name.toLowerCase() === a.name.toLowerCase())) continue;
      debts.push({ name: a.name, balance: owed, ratePct: 0, minPayment: 0, source: "account" });
    }
  } catch { /* no accounts yet */ }

  res.json({ debts });
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
