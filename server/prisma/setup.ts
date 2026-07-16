/**
 * Database setup orchestrator — the single entry point behind `npm run
 * db:setup` (and `db:reset` with --reset).
 *
 * 1. Resolves the data directory (IKID_DATA_DIR, default <repo>/database)
 *    and exports IKID_DATABASE_URL for the Prisma schema.
 * 2. Runs the legacy-name migration + pre-upgrade backup.
 * 3. prisma generate + db push (+ --force-reset when asked).
 * 4. Seeds default categories/rules on an empty database.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.IKID_DATA_DIR
  ? path.resolve(process.env.IKID_DATA_DIR)
  : path.resolve(__dirname, "../../database");
process.env.IKID_DATA_DIR = DATA_DIR;
process.env.IKID_DATABASE_URL ??= "file:" + path.join(DATA_DIR, "ikid.db");
fs.mkdirSync(DATA_DIR, { recursive: true });

const schema = path.join(__dirname, "schema.prisma");
const reset = process.argv.includes("--reset");
// --generate-only: just produce the typed client (used by `npm run build`
// so a fresh clone can typecheck before ever touching a database).
const generateOnly = process.argv.includes("--generate-only");

function run(cmd: string, env: NodeJS.ProcessEnv = process.env): void {
  execSync(cmd, { stdio: "inherit", env, cwd: path.resolve(__dirname, "..") });
}

run(`npx prisma generate --schema "${schema}"`);

if (!generateOnly) {
  // Legacy renames + version-change backup (side-effect module, env-aware)
  await import("./rename-migration.js");
  run(`npx prisma db push --skip-generate ${reset ? "--force-reset" : ""} --schema "${schema}"`);
  await import("./seed.js");

  // Every profile is its own SQLite file — apply the same schema to all of
  // them, not just the default, so switching profiles after an upgrade works.
  // (--force-reset is deliberately NOT propagated: resetting wipes data and
  // should only ever hit the database it was explicitly aimed at.)
  const primary = process.env.IKID_DATABASE_URL;
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (!f.endsWith(".db")) continue;
    const url = "file:" + path.join(DATA_DIR, f);
    if (url === primary) continue;
    console.log(`→ updating schema for profile database ${f}`);
    run(`npx prisma db push --skip-generate --schema "${schema}"`, {
      ...process.env,
      IKID_DATABASE_URL: url,
    });
  }
}
