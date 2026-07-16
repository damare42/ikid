/**
 * Client telemetry sink. Any signed-in user can record a feature event for
 * themselves (page view, action). Feature keys only — the server rejects
 * anything that isn't a short slug, and no financial data is ever accepted.
 */
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parse } from "../lib/errors.js";
import { parseCookies, SESSION_COOKIE, getSessionProfile } from "../services/authService.js";
import { getActiveProfile } from "../lib/prisma.js";
import { recordEvent } from "../services/usageService.js";

export const trackRouter = Router();

trackRouter.post("/", asyncHandler(async (req, res) => {
  const body = parse(
    z.object({
      event: z.string().regex(/^[a-z0-9:._-]{1,48}$/),
      meta: z.string().max(40).optional(),
    }),
    req.body,
  );
  const user = getSessionProfile(parseCookies(req.headers.cookie)[SESSION_COOKIE]) ?? getActiveProfile();
  recordEvent(user, body.event, body.meta);
  res.json({ ok: true });
}));
