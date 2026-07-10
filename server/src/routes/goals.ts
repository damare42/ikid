import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parse } from "../lib/errors.js";
import { goalRepo } from "../repositories/index.js";
import { computeGoal } from "../services/goalMath.js";
import type { GoalDTO } from "../../../shared/types.js";

export const goalsRouter = Router();

function toDTO(g: any): GoalDTO {
  const computed = computeGoal({
    targetAmount: g.targetAmount,
    currentSaved: g.currentSaved,
    monthlyContribution: g.monthlyContribution,
    deadline: g.deadline,
  });
  return {
    id: g.id,
    name: g.name,
    icon: g.icon,
    targetAmount: g.targetAmount,
    currentSaved: g.currentSaved,
    monthlyContribution: g.monthlyContribution,
    deadline: g.deadline ? g.deadline.toISOString().slice(0, 10) : null,
    ...computed,
  };
}

goalsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const goals = await goalRepo.all();
    res.json(goals.map(toDTO));
  }),
);

const goalSchema = z.object({
  name: z.string().min(1),
  icon: z.string().default("🎯"),
  targetAmount: z.number().positive(),
  currentSaved: z.number().min(0).default(0),
  monthlyContribution: z.number().min(0).default(0),
  deadline: z.string().nullable().optional(),
});

goalsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = parse(goalSchema, req.body);
    const goal = await goalRepo.create({
      ...body,
      deadline: body.deadline ? new Date(body.deadline) : null,
    });
    res.json(toDTO(goal));
  }),
);

goalsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = parse(goalSchema.partial(), req.body);
    const goal = await goalRepo.update(Number(req.params.id), {
      ...body,
      deadline: body.deadline === undefined ? undefined : body.deadline ? new Date(body.deadline) : null,
    });
    res.json(toDTO(goal));
  }),
);

goalsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await goalRepo.delete(Number(req.params.id));
    res.json({ ok: true });
  }),
);

/** "What if?" — recompute projections without saving. */
goalsRouter.post(
  "/what-if",
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        targetAmount: z.number().positive(),
        currentSaved: z.number().min(0),
        monthlyContribution: z.number().min(0),
        deadline: z.string().nullable().optional(),
      }),
      req.body,
    );
    res.json(
      computeGoal({ ...body, deadline: body.deadline ? new Date(body.deadline) : null }),
    );
  }),
);
