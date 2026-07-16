/**
 * Admin API — account management + usage analytics. Every route here is
 * gated by adminMiddleware (403 for non-admins). Admins manage accounts and
 * see aggregate usage, but never any user's financial data — profiles stay
 * isolated by the per-request DB routing that powers the whole app.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, parse, ApiError } from "../lib/errors.js";
import { getActiveProfile, getProfileId, listProfiles } from "../lib/prisma.js";
import {
  getSessionProfile, parseCookies, SESSION_COOKIE, isProtected, setPassword,
  destroySessionsFor,
} from "../services/authService.js";
import {
  getAccount, getConfig, isAdmin, listAccounts, setConfig, setDisabled, setRole,
} from "../services/accountService.js";
import { eventCountsByUser, overview } from "../services/usageService.js";
import type { AdminOverviewDTO, AdminUserDTO } from "../../../shared/types.js";

export const adminRouter = Router();

function currentUser(req: Request): string | null {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return getSessionProfile(token) ?? (isAdmin(getActiveProfile()) ? getActiveProfile() : null);
}

/** Only admins past this point. */
export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  const user = currentUser(req);
  if (!user || !isAdmin(user)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }
  (req as any).adminUser = user;
  next();
}

adminRouter.use(adminMiddleware);

adminRouter.get("/overview", asyncHandler(async (_req, res) => {
  const dto: AdminOverviewDTO = { ...overview(30), config: getConfig() };
  res.json(dto);
}));

adminRouter.get("/users", asyncHandler(async (req, res) => {
  const me = (req as any).adminUser as string;
  const counts = eventCountsByUser();
  const profiles = new Map(listProfiles().map((p) => [p.name, p]));
  const users: AdminUserDTO[] = listAccounts().map((a) => ({
    name: a.name,
    id: profiles.get(a.name)?.id ?? getProfileId(a.name),
    role: a.role,
    disabled: a.disabled,
    hasPassword: isProtected(a.name),
    createdAt: a.createdAt,
    lastLogin: a.lastLogin,
    eventCount: counts[a.name]?.count ?? 0,
    lastActive: counts[a.name]?.lastActive ?? null,
    isSelf: a.name === me,
  }));
  res.json(users);
}));

adminRouter.post("/users/:name/role", asyncHandler(async (req, res) => {
  const body = parse(z.object({ role: z.enum(["admin", "user"]) }), req.body);
  const name = req.params.name;
  if (!getAccount(name)) throw new ApiError(404, "Account not found");
  try {
    setRole(name, body.role);
  } catch (e) {
    throw new ApiError(400, (e as Error).message);
  }
  res.json({ ok: true });
}));

adminRouter.post("/users/:name/disabled", asyncHandler(async (req, res) => {
  const body = parse(z.object({ disabled: z.boolean() }), req.body);
  const name = req.params.name;
  if (!getAccount(name)) throw new ApiError(404, "Account not found");
  try {
    setDisabled(name, body.disabled);
  } catch (e) {
    throw new ApiError(400, (e as Error).message);
  }
  // Kick out any live sessions when disabling.
  if (body.disabled) destroySessionsFor(name);
  res.json({ ok: true });
}));

adminRouter.post("/users/:name/reset-password", asyncHandler(async (req, res) => {
  const body = parse(z.object({ password: z.string().min(4) }), req.body);
  const name = req.params.name;
  if (!getAccount(name)) throw new ApiError(404, "Account not found");
  setPassword(name, body.password);
  destroySessionsFor(name); // force re-login with the new password
  res.json({ ok: true });
}));

adminRouter.post("/config", asyncHandler(async (req, res) => {
  const body = parse(z.object({ allowSignups: z.boolean() }), req.body);
  res.json(setConfig(body));
}));
