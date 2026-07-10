import { Router } from "express";
import { asyncHandler } from "../lib/errors.js";
import {
  dashboardSummary, monthlySeries, weeklySeries, yearlySeries,
  categoryBreakdown, merchantBreakdown, largestPurchases,
  recurringPayments, heatmap, savingsAnalysis, monthBreakdown, cspBreakdown, categoryMerchants,
} from "../services/analyticsService.js";
import { generateInsights } from "../services/insightsService.js";

export const analyticsRouter = Router();

const dateParam = (v: unknown): Date | undefined =>
  typeof v === "string" && v ? new Date(v) : undefined;

analyticsRouter.get("/summary", asyncHandler(async (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : undefined;
  const ytd = req.query.range === "ytd";
  res.json(await dashboardSummary(month, ytd));
}));

analyticsRouter.get("/monthly", asyncHandler(async (req, res) => {
  res.json(await monthlySeries(Number(req.query.months) || 12));
}));

analyticsRouter.get("/weekly", asyncHandler(async (req, res) => {
  res.json(await weeklySeries(Number(req.query.weeks) || 12));
}));

analyticsRouter.get("/yearly", asyncHandler(async (_req, res) => {
  res.json(await yearlySeries());
}));

analyticsRouter.get("/categories", asyncHandler(async (req, res) => {
  res.json(await categoryBreakdown(dateParam(req.query.from), dateParam(req.query.to)));
}));

analyticsRouter.get("/merchants", asyncHandler(async (req, res) => {
  res.json(await merchantBreakdown(dateParam(req.query.from), dateParam(req.query.to), Number(req.query.limit) || 20));
}));

analyticsRouter.get("/category-merchants", asyncHandler(async (req, res) => {
  const categoryId = Number(req.query.categoryId);
  if (!categoryId) {
    res.status(400).json({ error: "categoryId is required" });
    return;
  }
  res.json(
    await categoryMerchants(
      categoryId,
      dateParam(req.query.from),
      dateParam(req.query.to),
      Number(req.query.limit) || 10,
    ),
  );
}));

analyticsRouter.get("/largest", asyncHandler(async (req, res) => {
  res.json(await largestPurchases(dateParam(req.query.from), dateParam(req.query.to), Number(req.query.limit) || 10));
}));

analyticsRouter.get("/recurring", asyncHandler(async (_req, res) => {
  res.json(await recurringPayments());
}));

analyticsRouter.get("/heatmap", asyncHandler(async (req, res) => {
  res.json(await heatmap(Number(req.query.year) || new Date().getFullYear()));
}));

analyticsRouter.get("/csp", asyncHandler(async (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : undefined;
  res.json(await cspBreakdown(month, req.query.range === "ytd"));
}));

analyticsRouter.get("/month-breakdown", asyncHandler(async (req, res) => {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  res.json(await monthBreakdown(month));
}));

analyticsRouter.get("/savings", asyncHandler(async (_req, res) => {
  res.json(await savingsAnalysis());
}));

analyticsRouter.get("/insights", asyncHandler(async (_req, res) => {
  res.json(await generateInsights());
}));
