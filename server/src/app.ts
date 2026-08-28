import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorHandler } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import {
  API_MAX, API_WINDOW_MS, AUTH_MAX, AUTH_WINDOW_MS, RateLimiter, rateLimit,
} from "./lib/rateLimit.js";
import { transactionsRouter } from "./routes/transactions.js";
import { importsRouter } from "./routes/imports.js";
import { metaRouter } from "./routes/meta.js";
import { budgetsRouter } from "./routes/budgets.js";
import { goalsRouter } from "./routes/goals.js";
import { analyticsRouter } from "./routes/analytics.js";
import { reportsRouter } from "./routes/reports.js";
import { settingsRouter } from "./routes/settings.js";
import { profilesRouter } from "./routes/profiles.js";
import { plannerRouter } from "./routes/planner.js";
import { authRouter, authMiddleware } from "./routes/auth.js";
import { netWorthRouter } from "./routes/networth.js";
import { calcRouter } from "./routes/calc.js";
import { retirementRouter } from "./routes/retirement.js";
import { adminRouter } from "./routes/admin.js";
import { trackRouter } from "./routes/track.js";

export function createApp() {
  const app = express();

  // Behind a reverse proxy (Caddy/nginx/Fly), trust X-Forwarded-* so Secure
  // cookies and client-IP rate limiting work. IKID_TRUST_PROXY=1 (or a hop
  // count) enables it; off by default for direct local use.
  const trust = process.env.IKID_TRUST_PROXY;
  if (trust) app.set("trust proxy", /^\d+$/.test(trust) ? Number(trust) : 1);

  // Same-origin in production (the server serves the built client), so CORS
  // normally isn't exercised. When it is, restrict to configured origins:
  // IKID_ORIGIN="https://money.example.com" (comma-separated for several).
  const origins = (process.env.IKID_ORIGIN ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : /localhost/, credentials: true }));

  app.use(express.json({ limit: "50mb" }));

  app.use((req, _res, next) => {
    if (!req.path.startsWith("/api/health")) logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // Health stays unlimited — Docker and the desktop shell poll it, and a
  // limiter that can fail a healthcheck is worse than no limiter.
  app.get("/api/health", (_req, res) => res.json({ ok: true, app: "ikid" }));

  // Rate limiting. On localhost this never fires (see lib/rateLimit.ts for the
  // headroom calculation); it exists for the hosted mode, where the server is
  // reachable from the internet. Auth is much tighter than the rest, because
  // that's where passwords get guessed.
  app.use("/api/auth", rateLimit(
    new RateLimiter(AUTH_MAX, AUTH_WINDOW_MS),
    "Too many sign-in attempts from this address. Wait a few minutes and try again.",
  ));
  app.use("/api", rateLimit(
    new RateLimiter(API_MAX, API_WINDOW_MS),
    "Too many requests. Slow down and try again shortly.",
  ));

  // Auth endpoints are public; every other /api route requires a session
  // when any profile has a password (multi-user mode).
  app.use("/api/auth", authRouter);

  // Production mode: serve the built client when client/dist exists
  // (created by `npm run build`). Static assets stay public — the login
  // and landing pages must load before a session exists.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const CLIENT_DIST = process.env.IKID_CLIENT_DIST
    ? path.resolve(process.env.IKID_CLIENT_DIST)
    : path.resolve(__dirname, "../../client/dist");
  const serveClient = fs.existsSync(CLIENT_DIST);
  if (serveClient) {
    app.use(express.static(CLIENT_DIST));
  }

  app.use("/api", authMiddleware);

  app.use("/api/transactions", transactionsRouter);
  app.use("/api/imports", importsRouter);
  app.use("/api", metaRouter);
  app.use("/api/budgets", budgetsRouter);
  app.use("/api/goals", goalsRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/profiles", profilesRouter);
  app.use("/api/planner", plannerRouter);
  app.use("/api/networth", netWorthRouter);
  app.use("/api/calc", calcRouter);
  app.use("/api/retirement", retirementRouter);
  app.use("/api/track", trackRouter);
  app.use("/api/admin", adminRouter);

  // SPA fallback for non-API paths (hash router, so mostly "/")
  if (serveClient) {
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(CLIENT_DIST, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
