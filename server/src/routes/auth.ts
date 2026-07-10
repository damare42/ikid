import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, parse, ApiError } from "../lib/errors.js";
import { profileContext, getActiveProfile, getDbPath, createProfile } from "../lib/prisma.js";
import {
  authEnabled, checkLogin, createSession, destroySession, getSessionProfile,
  isProtected, loginOptions, parseCookies, removePassword, sessionCookie,
  clearSessionCookie, setPassword, SESSION_COOKIE,
} from "../services/authService.js";
import fs from "node:fs";

export const authRouter = Router();

function sessionToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

authRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    const current = getSessionProfile(sessionToken(req));
    res.json({
      enabled: authEnabled(),
      current: authEnabled() ? current : getActiveProfile(),
      signedIn: !authEnabled() || current != null,
      profiles: loginOptions(),
    });
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({ profile: z.string().min(1), password: z.string().default("") }),
      req.body,
    );
    if (!fs.existsSync(getDbPath(body.profile))) throw new ApiError(404, "Profile not found");
    const result = checkLogin(body.profile, body.password);
    if (!result.ok) throw new ApiError(401, result.error ?? "Login failed");
    const token = createSession(body.profile);
    res.setHeader("Set-Cookie", sessionCookie(token));
    res.json({ profile: body.profile });
  }),
);

/** Public sign-up: creates a new profile (own database) with a password. */
authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().min(1),
        password: z.string().min(4, "Password must be at least 4 characters"),
      }),
      req.body,
    );
    let name: string;
    try {
      name = await createProfile(body.name);
    } catch (e) {
      throw new ApiError(400, (e as Error).message);
    }
    setPassword(name, body.password);
    const token = createSession(name);
    res.setHeader("Set-Cookie", sessionCookie(token));
    res.json({ profile: name });
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    destroySession(sessionToken(req));
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json({ ok: true });
  }),
);

const setPasswordSchema = z.object({
  password: z.string().min(4, "Password must be at least 4 characters"),
  currentPassword: z.string().optional(),
});

/** Set or change the password for the CURRENT profile. Enabling the first
 *  password turns authentication on for the whole app. */
authRouter.post(
  "/set-password",
  asyncHandler(async (req, res) => {
    const body = parse(setPasswordSchema, req.body);
    const profile = authEnabled()
      ? getSessionProfile(sessionToken(req))
      : getActiveProfile();
    if (!profile) throw new ApiError(401, "Not signed in");

    if (isProtected(profile)) {
      const ok = body.currentPassword != null && checkLogin(profile, body.currentPassword).ok;
      if (!ok) throw new ApiError(401, "Current password is wrong");
    }
    setPassword(profile, body.password);
    // Keep the user signed in after enabling auth for the first time.
    const token = createSession(profile);
    res.setHeader("Set-Cookie", sessionCookie(token));
    res.json({ ok: true, profile, authEnabled: true });
  }),
);

authRouter.post(
  "/remove-password",
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string() }), req.body);
    const profile = getSessionProfile(sessionToken(req)) ?? getActiveProfile();
    if (!isProtected(profile)) throw new ApiError(400, "This profile has no password");
    if (!checkLogin(profile, body.currentPassword).ok) throw new ApiError(401, "Current password is wrong");
    removePassword(profile);
    res.json({ ok: true });
  }),
);

/**
 * Gate for all other /api routes. When auth is enabled, requires a valid
 * session and binds that user's profile to the request so every DB query
 * automatically hits their database — concurrent users stay isolated.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!authEnabled()) {
    next();
    return;
  }
  const profile = getSessionProfile(sessionToken(req));
  if (!profile) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  profileContext.run({ profile }, next);
}
