/**
 * Demo-mode API. Thin by design: validation, profile selection, and error
 * mapping. All the logic — generation and, crucially, the safety guard — lives
 * in services/demoData.ts where it is unit-tested.
 *
 *   GET  /api/demo/status  — is this profile a demo, and can one be loaded here
 *   POST /api/demo/load    — generate and write (refuses over real data)
 *   POST /api/demo/reset   — regenerate, demo profiles only
 */
import { Router } from "express";
import fs from "node:fs";
import { z } from "zod";
import { ApiError, asyncHandler, parse } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import {
  createProfile,
  currentProfile,
  getDbPath,
  prisma,
  profileContext,
  switchProfile,
} from "../lib/prisma.js";
import { authEnabled } from "../services/authService.js";
import {
  DemoRefusedError,
  demoLoadDecision,
  loadDemoInto,
  readDemoState,
  resetDemoIn,
} from "../services/demoData.js";
import { DEMO_PROFILE } from "../../../shared/demo.js";
import type { DemoLoadResultDTO, DemoStatusDTO } from "../../../shared/demo.js";

export const demoRouter = Router();

function demoProfileExists(): boolean {
  try {
    return fs.existsSync(getDbPath(DEMO_PROFILE));
  } catch {
    return false; // getDbPath rejects anything that isn't a bare filename
  }
}

/** A refusal from the guard is a 409, not a 500 — it is an expected answer. */
function rethrow(e: unknown): never {
  if (e instanceof DemoRefusedError) throw new ApiError(409, e.message);
  throw e;
}

demoRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    const state = await readDemoState(prisma);
    const decision = demoLoadDecision(state.occupancy);
    const { isDemoProfile: _ignored, ...counts } = state.occupancy;
    const body: DemoStatusDTO = {
      isDemo: state.isDemo,
      profile: currentProfile(),
      seed: state.seed,
      generatedAt: state.generatedAt,
      range: state.range,
      counts,
      canLoadHere: decision.allowed,
      blockedReason: decision.allowed ? null : decision.message,
      demoProfileExists: demoProfileExists(),
      authEnabled: authEnabled(),
    };
    res.json(body);
  }),
);

const loadSchema = z.object({
  // An enum, not a free-form profile name: the client can pick between two
  // known destinations and cannot name an arbitrary file.
  target: z.enum(["demo", "current"]).optional(),
});

demoRouter.post(
  "/load",
  asyncHandler(async (req, res) => {
    const body = parse(loadSchema, req.body ?? {});
    const target = body.target ?? "demo";

    if (target === "current") {
      // Hosted / multi-user mode: profile switching is refused there, so the
      // only place a signed-in user can put the demo is their own profile.
      // Safe because loadDemoInto re-reads the counts and refuses if it holds
      // anything at all.
      const outcome = await loadDemoInto(prisma).catch(rethrow);
      logger.info("Demo data loaded", { profile: currentProfile(), seed: outcome.seed });
      const result: DemoLoadResultDTO = {
        profile: currentProfile(),
        activated: true,
        seed: outcome.seed,
        range: outcome.range,
        counts: outcome.counts,
        note: "Demo data loaded into this profile. Reset it any time from the demo banner.",
      };
      res.json(result);
      return;
    }

    // The dedicated demo profile lives in its own SQLite file, so this path
    // cannot touch the caller's data even in principle.
    if (authEnabled()) {
      throw new ApiError(
        403,
        'Accounts are enabled, so profiles cannot be switched. Sign up a separate account (for example "demo") and load the demo into it from its own Settings page.',
      );
    }

    if (!demoProfileExists()) {
      try {
        await createProfile(DEMO_PROFILE);
      } catch (e) {
        throw new ApiError(400, (e as Error).message);
      }
    }

    // Bind this write to the demo profile's database for its whole duration.
    const outcome = await profileContext
      .run({ profile: DEMO_PROFILE }, () => loadDemoInto(prisma))
      .catch(rethrow);

    await switchProfile(DEMO_PROFILE);
    logger.info("Demo profile loaded and activated", {
      profile: DEMO_PROFILE,
      seed: outcome.seed,
      transactions: outcome.counts.transactions,
    });

    const result: DemoLoadResultDTO = {
      profile: DEMO_PROFILE,
      activated: true,
      seed: outcome.seed,
      range: outcome.range,
      counts: outcome.counts,
      note: `Switched to the "${DEMO_PROFILE}" profile. Your own data is untouched in its own database file — switch back from the account menu.`,
    };
    res.json(result);
  }),
);

demoRouter.post(
  "/reset",
  asyncHandler(async (req, res) => {
    // Reset always acts on the profile serving this request, and resetDemoIn
    // refuses unless that profile carries the demo marker. There is no way to
    // aim it at somebody else's profile.
    const body = parse(z.object({ seed: z.number().int().optional() }), req.body ?? {});
    const outcome = await resetDemoIn(prisma, { seed: body.seed }).catch(rethrow);
    logger.info("Demo data reset", { profile: currentProfile(), seed: outcome.seed });
    const result: DemoLoadResultDTO = {
      profile: currentProfile(),
      activated: true,
      seed: outcome.seed,
      range: outcome.range,
      counts: outcome.counts,
      note: "Demo data regenerated from the seed. Same seed, same numbers.",
    };
    res.json(result);
  }),
);
