import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { z } from "zod";
import { asyncHandler, parse, ApiError } from "../lib/errors.js";
import { settingRepo } from "../repositories/index.js";
import { createBackup, listBackups, restoreBackup, dbPath } from "../services/backupService.js";
import { buildExport, importExport } from "../services/backupRestore.js";
import { ImportFormatError } from "../services/exportService.js";
import { currentProfile } from "../lib/prisma.js";

export const settingsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

settingsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const s = await settingRepo.getAll();
    res.json({
      currency: s.currency ?? "USD",
      dateFormat: s.dateFormat ?? "MM/DD/YYYY",
      theme: s.theme ?? "system",
    });
  }),
);

const settingsSchema = z.object({
  currency: z.string().optional(),
  dateFormat: z.string().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
});

settingsRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const body = parse(settingsSchema, req.body);
    for (const [k, v] of Object.entries(body)) if (v !== undefined) await settingRepo.set(k, v);
    res.json(await settingRepo.getAll());
  }),
);

// --- database backup / restore / export ---
settingsRouter.post("/backup", asyncHandler(async (_req, res) => res.json(createBackup())));
settingsRouter.get("/backups", asyncHandler(async (_req, res) => res.json(listBackups())));

settingsRouter.post(
  "/restore",
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ file: z.string() }), req.body);
    restoreBackup(body.file);
    res.json({ ok: true, note: "Restored. Restart the app (npm run dev) to load the restored data." });
  }),
);

/** Restore by uploading a .db file directly. */
settingsRouter.post(
  "/restore-upload",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, "No file uploaded");
    const target = dbPath();
    fs.copyFileSync(target, target + ".pre-restore");
    fs.writeFileSync(target, req.file.buffer);
    res.json({ ok: true, note: "Restored. Restart the app to load the restored data." });
  }),
);

/** Export (download) the SQLite database. */
settingsRouter.get(
  "/export",
  asyncHandler(async (_req, res) => {
    const target = dbPath();
    if (!fs.existsSync(target)) throw new ApiError(404, "Database not found");
    res.download(target, `${path.basename(target, ".db")}-${new Date().toISOString().slice(0, 10)}.db`);
  }),
);

// --- lossless JSON export / import (portable, human-readable, no lock-in) ---

/** Everything in this profile as one readable JSON document. */
settingsRouter.get(
  "/export.json",
  asyncHandler(async (_req, res) => {
    const profile = currentProfile();
    const doc = await buildExport({ profile, appVersion: process.env.npm_package_version });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ikid-${profile}-${stamp}.json"`);
    res.send(JSON.stringify(doc, null, 2));
  }),
);

/**
 * Import a previously exported document.
 * mode=merge (default) adds what's missing and skips known transactions;
 * mode=replace wipes this profile first and must be asked for explicitly.
 */
settingsRouter.post(
  "/import.json",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const mode = req.query.mode === "replace" || req.body?.mode === "replace" ? "replace" : "merge";

    let payload: unknown;
    if (req.file) {
      try {
        payload = JSON.parse(req.file.buffer.toString("utf-8"));
      } catch {
        throw new ApiError(400, "That file isn't valid JSON.");
      }
    } else if (req.body && typeof req.body === "object" && "format" in req.body) {
      payload = req.body;
    } else {
      throw new ApiError(400, "No export file uploaded (field name: file).");
    }

    try {
      const summary = await importExport(payload, mode);
      res.json({ ok: true, mode, summary });
    } catch (e) {
      if (e instanceof ImportFormatError) throw new ApiError(400, e.message);
      throw e;
    }
  }),
);
