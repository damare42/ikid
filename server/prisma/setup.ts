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

// Legacy renames + version-change backup (side-effect module, env-aware)
await import("./rename-migration.js");

const schema = path.join(__dirname, "schema.prisma");
const reset = process.argv.includes("--reset");

function run(cmd: string): void {
  execSync(cmd, { stdio: "inherit", env: process.env, cwd: path.resolve(__dirname, "..") });
}

run(`npx prisma generate --schema "${schema}"`);
run(`npx prisma db push --skip-generate ${reset ? "--force-reset" : ""} --schema "${schema}"`);

await import("./seed.js");
