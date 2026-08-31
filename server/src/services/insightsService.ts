/**
 * Smart insights: month-over-month category/merchant movements, subscription
 * audit, savings opportunities.
 *
 * This file is now only the fetching. The heuristics are pure and live in
 * insightsCore, so the hosted demo runs the same ones instead of a shorter
 * version of its own — see the note there.
 */
import { categoryBreakdown, merchantBreakdown, monthlySeries, recurringPayments } from "./analyticsService.js";
import { buildInsights } from "./insightsCore.js";
import type { InsightDTO } from "../../../shared/types.js";

export async function generateInsights(): Promise<InsightDTO[]> {
  const now = new Date();
  const curFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1); // last full month
  const curTo = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const prevFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const prevTo = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59);

  const [currentCategories, previousCategories, currentMerchants, previousMerchants, series, recurring] =
    await Promise.all([
      categoryBreakdown(curFrom, curTo),
      categoryBreakdown(prevFrom, prevTo),
      merchantBreakdown(curFrom, curTo, 50),
      merchantBreakdown(prevFrom, prevTo, 50),
      monthlySeries(12),
      recurringPayments(),
    ]);

  return buildInsights({
    currentCategories, previousCategories, currentMerchants, previousMerchants, series, recurring,
  });
}
