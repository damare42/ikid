/**
 * Reconciliation endpoints. Thin: validate, delegate to reconcileService.
 */
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parse } from "../lib/errors.js";
import {
  bucketTransactions, markCleared, reconcileAccount,
} from "../services/reconcileService.js";

export const reconcileRouter = Router();

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const summarySchema = z.object({
  accountId: z.coerce.number().int().positive(),
  statementDate: YMD,
  // Signed: a credit card you owe on closes negative. Zero is a real answer.
  statementBalance: z.coerce.number().finite(),
  openingBalance: z.coerce.number().finite().optional(),
});

reconcileRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    res.json(await reconcileAccount(parse(summarySchema, req.query)));
  }),
);

const bucketSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  statementDate: YMD,
  bucket: z.enum(["cleared", "uncleared", "after"]),
});

reconcileRouter.get(
  "/transactions",
  asyncHandler(async (req, res) => {
    const q = parse(bucketSchema, req.query);
    res.json(await bucketTransactions(q.accountId, q.statementDate, q.bucket));
  }),
);

/**
 * Mark cleared/uncleared. Either an explicit id list (single row, or the
 * `undoIds` from a previous call) or an account + cut-off date for the bulk
 * "everything up to here" action.
 */
const markSchema = z
  .object({
    cleared: z.boolean(),
    ids: z.array(z.number().int().positive()).max(100_000).optional(),
    accountId: z.number().int().positive().optional(),
    upToDate: YMD.optional(),
  })
  .refine(
    (b) => (b.ids && b.ids.length > 0) || (b.accountId != null && b.upToDate != null),
    "Provide transaction ids, or an accountId with upToDate.",
  );

reconcileRouter.post(
  "/mark",
  asyncHandler(async (req, res) => {
    res.json(await markCleared(parse(markSchema, req.body)));
  }),
);
