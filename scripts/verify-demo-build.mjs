#!/usr/bin/env node
/**
 * Checks the built demo before it can be deployed.
 *
 * This exists because of a specific failure: the demo build ran from the repo
 * root, Tailwind resolved its config and content globs against the working
 * directory, found nothing, and emitted a stylesheet with no utility classes.
 * The build succeeded. The bundle was valid. The deployed app was a column of
 * unstyled text — and nothing in the pipeline noticed, because "it compiled"
 * and "it looks right" are different questions.
 *
 * So these assertions are about the output a visitor actually receives.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "site", "demo");
const assets = path.join(dir, "assets");

const problems = [];
const ok = [];

function fail(msg) { problems.push(msg); }
function pass(msg) { ok.push(msg); }

// --- the build produced something at all ---
if (!fs.existsSync(path.join(dir, "index.html"))) {
  fail("site/demo/index.html is missing — the demo build didn't run.");
} else {
  pass("index.html present");
}
if (!fs.existsSync(assets)) {
  console.error("✗ site/demo/assets is missing — nothing to check.");
  process.exit(1);
}

const files = fs.readdirSync(assets);
const css = files.filter((f) => f.endsWith(".css")).map((f) => path.join(assets, f));
const js = files.filter((f) => f.endsWith(".js")).map((f) => path.join(assets, f));

// --- the stylesheet is real ---
if (css.length === 0) {
  fail("No CSS was emitted.");
} else {
  const text = css.map((f) => fs.readFileSync(f, "utf8")).join("");
  // A handful of utilities the app cannot render without. Checking for classes
  // rather than a byte size, because a size threshold is a guess and this is a
  // fact: if `.flex` isn't in the stylesheet, the layout is gone.
  const required = ["flex", "grid", "rounded", "text-sm", "tabular-nums"];
  const missing = required.filter((c) => !text.includes(`.${c}`));
  if (missing.length) {
    fail(
      `The stylesheet is missing utility classes (${missing.join(", ")}). ` +
      "Tailwind almost certainly didn't find its content globs — check the build's working directory.",
    );
  } else {
    pass(`stylesheet has utilities (${(text.length / 1024).toFixed(0)}KB)`);
  }
}

// --- the demo API is in there, and the server is not ---
const bundle = js.map((f) => fs.readFileSync(f, "utf8")).join("");
if (!bundle.includes("Northbrook")) {
  fail("The generated demo data isn't in the bundle — the demo would load empty.");
} else {
  pass("demo dataset present");
}
if (/PrismaClient|@prisma\/client/.test(bundle)) {
  fail("Server database code leaked into the demo bundle; it would throw for every visitor.");
} else {
  pass("no server database code");
}

// --- asset URLs match where this is actually served from ---
const html = fs.existsSync(path.join(dir, "index.html"))
  ? fs.readFileSync(path.join(dir, "index.html"), "utf8")
  : "";
if (html && !html.includes("/ikid/demo/assets/")) {
  fail("index.html doesn't reference /ikid/demo/assets/ — the --base is wrong, so nothing will load.");
} else if (html) {
  pass("asset paths match the deploy base");
}

for (const m of ok) console.log(`  ok   ${m}`);
for (const m of problems) console.error(`  FAIL ${m}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s) with the demo build — not safe to deploy.`);
  process.exit(1);
}
console.log("\nDemo build looks deployable.");
