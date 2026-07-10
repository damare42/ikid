/**
 * Desktop build: assembles everything the Electron app ships.
 *  1. server-bundle/   — the Express server bundled to one ESM file (esbuild)
 *  2. client-dist/     — the built web app (from client/dist)
 *  3. template-data/   — a freshly-initialized database (schema + seed) that
 *                        first launch copies into the user's data folder
 *  4. prisma-runtime/  — Prisma CLI + engines so upgrades can `db push`
 *                        on the user's machine without npm
 */
import { build } from "esbuild";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

// ---- 1. bundle the server (ESM so import.meta.url keeps working) ----
console.log("• bundling server…");
rimraf(path.join(here, "server-bundle"));
await build({
  entryPoints: [path.join(repo, "server/src/index.ts")],
  outfile: path.join(here, "server-bundle/index.mjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // Native engine + generated client stay external (shipped in prisma-runtime)
  external: ["@prisma/client", ".prisma"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

// ---- 2. client ----
console.log("• copying client…");
const clientDist = path.join(repo, "client/dist");
if (!fs.existsSync(clientDist)) {
  console.error("client/dist missing — run `npm run build` at the repo root first.");
  process.exit(1);
}
rimraf(path.join(here, "client-dist"));
copyDir(clientDist, path.join(here, "client-dist"));

// ---- 3. template database (fresh schema + seeded defaults) ----
console.log("• creating template database…");
const templateDir = path.join(here, "template-data");
rimraf(templateDir);
execSync("npm run db:setup --workspace server", {
  cwd: repo,
  stdio: "inherit",
  env: {
    ...process.env,
    IKID_DATA_DIR: templateDir,
    IKID_DATABASE_URL: "file:" + path.join(templateDir, "ikid.db"),
  },
});
// A template must never carry credentials or sessions
for (const f of ["auth.json", "sessions.json"]) rimraf(path.join(templateDir, f));

// ---- 4. Prisma runtime (CLI + engines + generated client) ----
console.log("• copying prisma runtime…");
const prt = path.join(here, "prisma-runtime");
rimraf(prt);
fs.mkdirSync(path.join(prt, "node_modules"), { recursive: true });
for (const mod of ["prisma", "@prisma", ".prisma"]) {
  const src = path.join(repo, "node_modules", mod);
  if (fs.existsSync(src)) copyDir(src, path.join(prt, "node_modules", mod));
}
fs.copyFileSync(path.join(repo, "server/prisma/schema.prisma"), path.join(prt, "schema.prisma"));

console.log("✓ desktop build assets ready");
