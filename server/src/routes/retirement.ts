import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parse } from "../lib/errors.js";
import { simulateRetirement } from "../services/retirement.js";
import { TAX_YEAR } from "../services/tax.js";
import { buildProfile } from "../services/plannerService.js";

export const retirementRouter = Router();

const money = (max: number) => z.number().min(0).max(max);

const paramsSchema = z.object({
  currentAge: z.number().min(18).max(80),
  retireAge: z.number().min(25).max(80),
  endAge: z.number().min(60).max(105).default(90),
  filingStatus: z.enum(["single", "married"]).default("single"),
  annualSpending: z.number().positive().max(1e7),
  ratePct: z.number().min(0).max(15),
  accounts: z.object({
    trad: z.object({ balance: money(1e8), contribution: money(1e6) }),
    roth: z.object({ balance: money(1e8), basis: money(1e8), contribution: money(1e6) }),
    brokerage: z.object({ balance: money(1e9), basisPct: z.number().min(0).max(100), contribution: money(1e6) }),
    hsa: z.object({ balance: money(1e7), contribution: money(1e5), annualMedical: money(1e6) }),
  }),
  ladder: z.boolean().default(true),
  fillBracket: z.union([z.literal(0), z.literal(10), z.literal(12), z.literal(22)]).default(12),
  rmdAge: z.union([z.literal(73), z.literal(75)]).default(75),
});

retirementRouter.post("/simulate", asyncHandler(async (req, res) => {
  const p = parse(paramsSchema, req.body);
  if (p.retireAge < p.currentAge) {
    res.status(400).json({ error: "Retirement age can't be before your current age." });
    return;
  }
  if (p.endAge <= p.retireAge) {
    res.status(400).json({ error: "Plan horizon must extend past retirement." });
    return;
  }
  if (p.accounts.roth.basis > p.accounts.roth.balance) {
    res.status(400).json({ error: "Roth basis (contributions) can't exceed the Roth balance." });
    return;
  }
  res.json({ taxYear: TAX_YEAR, ...simulateRetirement(p) });
}));

/** Prefill spending from the user's actual data (12-month average). */
retirementRouter.get("/prefill", asyncHandler(async (_req, res) => {
  try {
    const profile = await buildProfile(12);
    res.json({
      annualSpending: Math.round(profile.avgMonthlyExpenses * 12),
      monthsOfData: profile.monthsOfData,
    });
  } catch {
    res.json({ annualSpending: 0, monthsOfData: 0 });
  }
}));
