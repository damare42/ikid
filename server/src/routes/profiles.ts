import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parse, ApiError } from "../lib/errors.js";
import { createProfile, currentProfile, listProfiles, renameProfile, switchProfile } from "../lib/prisma.js";
import { authEnabled, renameProfileAuth } from "../services/authService.js";
import { logger } from "../lib/logger.js";

export const profilesRouter = Router();

profilesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ active: currentProfile(), profiles: listProfiles() });
  }),
);

profilesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ name: z.string().min(1) }), req.body);
    try {
      const name = await createProfile(body.name);
      logger.info("Profile created", { name });
      res.json({ name });
    } catch (e) {
      throw new ApiError(400, (e as Error).message);
    }
  }),
);

/** Rename the CURRENT profile (your own account) — data, password, and
 *  active sessions all follow the new name. */
profilesRouter.post(
  "/rename",
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ name: z.string().min(1) }), req.body);
    const from = currentProfile();
    try {
      const to = await renameProfile(from, body.name);
      renameProfileAuth(from, to);
      logger.info("Profile renamed", { from, to });
      res.json({ from, to });
    } catch (e) {
      throw new ApiError(400, (e as Error).message);
    }
  }),
);

profilesRouter.post(
  "/activate",
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ name: z.string().min(1) }), req.body);
    if (authEnabled()) {
      throw new ApiError(403, "Accounts are enabled — sign out and sign in as the other user instead of switching.");
    }
    try {
      await switchProfile(body.name);
    } catch (e) {
      throw new ApiError(400, (e as Error).message);
    }
    logger.info("Profile activated", { name: body.name });
    res.json({ active: body.name });
  }),
);
