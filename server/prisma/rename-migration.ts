/**
 * App-rename + upgrade-safety migration. Runs before every db:setup.
 * 1. Migrates databases/credentials from legacy app names (menged, eked)
 *    to the current name (ikid) — idempotent, no-op once migrated.
 * 2. Backs up every profile database whenever the app version changes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.resolve(__dirname, "../../database");
const LEGACY_NAMES = ["menged", "eked"];
const CURRENT = "ikid";

const REGISTRY = path.join(DB_DIR, "profiles.json");
const AUTH = path.join(DB_DIR, "auth.json");

for (const legacy of LEGACY_NAMES) {
  const oldDb = path.join(DB_DIR, `${legacy}.db`);
  const newDb = path.join(DB_DIR, `${CURRENT}.db`);
  if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
    fs.renameSync(oldDb, newDb);
    console.log(`Migrated database: ${legacy}.db → ${CURRENT}.db`);
  }

  try {
    const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf-8"));
    let changed = false;
    if (reg.active === legacy) {
      reg.active = CURRENT;
      changed = true;
    }
    if (reg.ids?.[legacy] && !reg.ids[CURRENT]) {
      reg.ids[CURRENT] = reg.ids[legacy];
      delete reg.ids[legacy];
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
      console.log(`Migrated profile registry: ${legacy} → ${CURRENT}`);
    }
  } catch {
    /* no registry yet */
  }

  try {
    const auth = JSON.parse(fs.readFileSync(AUTH, "utf-8"));
    if (auth[legacy] && !auth[CURRENT]) {
      auth[CURRENT] = auth[legacy];
      delete auth[legacy];
      fs.writeFileSync(AUTH, JSON.stringify(auth, null, 2), { mode: 0o600 });
      console.log(`Migrated credentials: ${legacy} → ${CURRENT}`);
    }
  } catch {
    /* no auth file yet */
  }
}

/**
 * Safety net for upgrades: whenever the app version changes, copy every
 * profile database to database/backups/pre-<version>/ BEFORE the schema
 * push runs.
 */
try {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"));
  const version: string = pkg.version ?? "0.0.0";
  const STAMP = path.join(DB_DIR, ".app-version");
  const previous = fs.existsSync(STAMP) ? fs.readFileSync(STAMP, "utf-8").trim() : null;

  if (previous !== version) {
    const dbs = fs.existsSync(DB_DIR)
      ? fs.readdirSync(DB_DIR).filter((f) => f.endsWith(".db") && !f.includes(".pre-restore"))
      : [];
    if (previous !== null && dbs.length > 0) {
      const dest = path.join(DB_DIR, "backups", `pre-${version}`);
      fs.mkdirSync(dest, { recursive: true });
      for (const f of dbs) fs.copyFileSync(path.join(DB_DIR, f), path.join(dest, f));
      console.log(`Upgrade ${previous} → ${version}: backed up ${dbs.length} database(s) to backups/pre-${version}/`);
    }
    fs.mkdirSync(DB_DIR, { recursive: true });
    fs.writeFileSync(STAMP, version);
  }
} catch (e) {
  console.warn("Pre-upgrade backup skipped:", (e as Error).message);
}
