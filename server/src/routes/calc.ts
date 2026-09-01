/** Deterministic calculators (pure finmath) + saved-calculation history. */
import { Router } from "express";
import { z } from "zod";
import { ApiError, asyncHandler, parse } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { amortization, coastFire, compoundGrowth, fireProjection, loanPayoff } from "../services/finmath.js";
import { safeRateForHorizon, testSequences } from "../services/sequenceRisk.js";
import { affordability, emergencyFund, investVsPrepay, yearsToIndependence } from "../services/planningRules.js";
import { dollarsLabel } from "../services/rates.js";
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
      // Which kind of return the caller typed. The engine treated this field as
      // nominal here and as real in the FIRE calculator, with nothing
      // converting between them — a 30-year projection read in the wrong basis
      // is out by roughly (1.03)^30, about 2.4x, and looks entirely plausible.
      basis: z.enum(["nominal", "real"]).default("nominal"),
    }),
    req.body,
  );
  res.json({
    ...compoundGrowth(body.principal, body.monthly, body.ratePct, body.years),
    basis: body.basis,
    dollars: dollarsLabel(body.basis),
  });
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
  const projection = fireProjection(body);

  // The smooth projection answers "does this work on average". The history
  // answers "does it work if I'm unlucky", which is the question the 4% rule
  // was invented to settle — so the app should not quote that rule while
  // hiding the evidence behind it.
  const horizonYears = Math.max(1, Math.round(95 - (projection.fireAge ?? body.currentAge)));
  const balance = projection.balanceAtFire ?? projection.fireNumber;
  const history = projection.achievable
    ? testSequences({
        initialBalance: balance,
        annualWithdrawal: body.annualSpending,
        years: Math.min(horizonYears, 60),
        equityPct: 75,
      })
    : null;

  res.json({
    ...projection,
    dollars: dollarsLabel("real"),
    history: history && {
      successRate: history.successRate,
      cohortCount: history.cohortCount,
      firstStart: history.firstStart,
      lastStart: history.lastStart,
      horizonYears: Math.min(horizonYears, 60),
      worst: history.worst,
      median: history.median,
      withdrawalRatePct: history.withdrawalRatePct,
      // What the record actually supports for a retirement this long, which is
      // usually below the 4% the user typed.
      supportedRatePct: safeRateForHorizon(Math.min(horizonYears, 60), 75).maxSafePct,
    },
  });
}));

// ---------- the standard rules, made available ----------

calcRouter.post("/emergency-fund", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      essentialMonthlyExpenses: z.number().min(0).max(1e6),
      liquidSavings: z.number().min(0).max(1e9),
      stability: z.enum(["dual-stable", "single-stable", "variable", "self-employed"]),
      monthlySavingsCapacity: z.number().min(0).max(1e6).optional(),
    }),
    req.body,
  );
  res.json(emergencyFund(body));
}));

calcRouter.post("/affordability", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      grossAnnualIncome: z.number().positive().max(1e8),
      otherMonthlyDebt: z.number().min(0).max(1e6),
      downPayment: z.number().min(0).max(1e9),
      homePrice: z.number().positive().max(1e9),
      annualRatePct: z.number().min(0).max(30),
      termYears: z.number().min(1).max(50).optional(),
      propertyTaxPct: z.number().min(0).max(10).optional(),
      insurancePct: z.number().min(0).max(10).optional(),
      monthlyHoa: z.number().min(0).max(1e5).optional(),
    }),
    req.body,
  );
  res.json(affordability(body));
}));

calcRouter.post("/invest-vs-prepay", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      debtBalance: z.number().min(0).max(1e9),
      debtRatePct: z.number().min(0).max(60),
      monthlyAmount: z.number().min(0).max(1e6),
      expectedReturnPct: z.number().min(0).max(30),
      investmentTaxPct: z.number().min(0).max(60).optional(),
      debtInterestDeductible: z.boolean().optional(),
      marginalIncomeTaxPct: z.number().min(0).max(60).optional(),
      employerMatchPct: z.number().min(0).max(200).optional(),
    }),
    req.body,
  );
  res.json(investVsPrepay(body));
}));

calcRouter.post("/independence", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      savingsRatePct: z.number().min(0).max(100),
      realReturnPct: z.number().min(0).max(20),
      withdrawalRatePct: z.number().min(1).max(20).default(4),
      portfolioYearsOfSpending: z.number().min(0).max(100).default(0),
    }),
    req.body,
  );
  res.json({
    years: yearsToIndependence(
      body.savingsRatePct, body.realReturnPct, body.withdrawalRatePct, body.portfolioYearsOfSpending,
    ),
    dollars: dollarsLabel("real"),
  });
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
