import fs from "node:fs";
import path from "node:path";
import { ApiError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { DB_DIR, getActiveDbPath, currentProfile } from "../lib/prisma.js";

const BACKUP_DIR = path.join(DB_DIR, "backups");

/** Path of the active profile's database file. */
export function dbPath(): string {
  return getActiveDbPath();
}

export function createBackup(): { file: string; size: number } {
  const src = dbPath();
  if (!fs.existsSync(src)) throw new ApiError(404, "Database file not found");
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(BACKUP_DIR, `${currentProfile()}-${stamp}.db`);
  fs.copyFileSync(src, file);
  logger.info("Backup created", { file });
  return { file: path.basename(file), size: fs.statSync(file).size };
}

export function listBackups(): { file: string; size: number; createdAt: string }[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db"))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function restoreBackup(file: string): void {
  const safe = path.basename(file);
  const src = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(src)) throw new ApiError(404, `Backup ${safe} not found`);
  const target = dbPath();
  // Keep a safety copy of the current DB before overwriting.
  fs.copyFileSync(target, target + ".pre-restore");
  fs.copyFileSync(src, target);
  logger.warn("Database restored from backup — restart the server to reload", { file: safe });
}
