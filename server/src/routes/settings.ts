import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { z } from "zod";
import { asyncHandler, parse, ApiError } from "../lib/errors.js";
import { settingRepo } from "../repositories/index.js";
import { createBackup, listBackups, restoreBackup, dbPath } from "../services/backupService.js";

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
