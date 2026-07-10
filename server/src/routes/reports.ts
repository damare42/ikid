import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parse } from "../lib/errors.js";
import { transactionsCsv } from "../services/reportService.js";
import type { TransactionQuery } from "../../../shared/types.js";

export const reportsRouter = Router();

const querySchema = z.object({
  search: z.string().optional(),
  categoryId: z.coerce.number().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

reportsRouter.get(
  "/csv",
  asyncHandler(async (req, res) => {
    const q = parse(querySchema, req.query) as TransactionQuery;
    const csv = await transactionsCsv(q);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="ikid-transactions-${stamp}.csv"`);
    res.send(csv);
  }),
);
