import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorHandler } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
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

export function createApp() {
  const app = express();
  app.use(cors({ origin: /localhost/ }));
  app.use(express.json({ limit: "50mb" }));

  app.use((req, _res, next) => {
    if (!req.path.startsWith("/api/health")) logger.debug(`${req.method} ${req.path}`);
    next();
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true, app: "ikid" }));

  // Auth endpoints are public; every other /api route requires a session
  // when any profile has a password (multi-user mode).
  app.use("/api/auth", authRouter);

  // Production mode: serve the built client when client/dist exists
  // (created by `npm run build`). Static assets stay public — the login
  // and landing pages must load before a session exists.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");
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
