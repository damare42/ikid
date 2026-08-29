import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parse } from "../lib/errors.js";
import { billsSummary, HORIZONS, type Horizon } from "../services/billsService.js";

export const billsRouter = Router();

/**
 * Only 30/60/90 are offered. The horizon is a fixed choice in the UI, and an
 * open-ended number would let a caller ask for 10,000 days of projections —
 * an accidental denial of service and a nonsense answer either way.
 */
const querySchema = z.object({
  horizon: z.coerce
    .number()
    .refine((n): n is Horizon => (HORIZONS as readonly number[]).includes(n), {
      message: `horizon must be one of ${HORIZONS.join(", ")}`,
    })
    .optional(),
});

billsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { horizon } = parse(querySchema, req.query);
    res.json(await billsSummary(horizon ?? 30));
  }),
);
