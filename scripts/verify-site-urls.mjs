#!/usr/bin/env node
/**
 * Checks that every absolute URL on the marketing site agrees with
 * site.config.json — and, if a custom domain is configured, that the domain,
 * the config and the URLs are all the same domain.
 *
 * This exists for one specific bad day. Moving a GitHub Pages site to a custom
 * domain touches several unrelated-looking things: a CNAME file, the demo's
 * asset base, and the handful of absolute URLs in the HTML head. Miss the
 * base and every asset 404s. Miss the canonical tag and the site keeps telling
 * search engines that the real page is the old address, so the new domain
 * never ranks and the old one keeps the traffic — a failure with no error
 * message, no broken pixel, and a months-long feedback loop.
 *
 * None of that is hard. It is just easy to half-finish, and impossible to
 * notice by looking at the page. So it is checked instead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");

const cfg = JSON.parse(fs.readFileSync(path.join(root, "site.config.json"), "utf8"));
const problems = [];
const ok = [];

// --- the config is well formed ---
if (!/^https:\/\/[^/]+$/.test(cfg.origin)) {
  problems.push(`site.config.json origin must be "https://host" with no trailing slash; got "${cfg.origin}".`);
}
if (!cfg.base.startsWith("/") || !cfg.base.endsWith("/")) {
  problems.push(`site.config.json base must start and end with "/"; got "${cfg.base}".`);
}
const siteUrl = `${cfg.origin}${cfg.base}`;

// --- a CNAME, if present, is the authority on the domain ---
// GitHub Pages serves whatever host is in site/CNAME. If the config disagrees,
// the config loses and the site half-works, so the disagreement is the bug.
const cnamePath = path.join(site, "CNAME");
if (fs.existsSync(cnamePath)) {
  const cname = fs.readFileSync(cnamePath, "utf8").trim();
  const host = cfg.origin.replace(/^https:\/\//, "");
  if (cname !== host) {
    problems.push(`site/CNAME is "${cname}" but site.config.json origin is "${host}". Pages serves the CNAME; the URLs would point somewhere else.`);
  } else {
    ok.push(`CNAME matches the configured origin (${cname})`);
  }
  // A custom domain serves from the root of that domain, so a project-path
  // base is left over from the github.io layout and would 404 every asset.
  if (cfg.base !== "/") {
    problems.push(`A custom domain (${cname}) serves from the root, but base is "${cfg.base}". Set base to "/" or the demo's assets will 404.`);
  }
}

// --- every absolute self-reference agrees ---
const checks = [
  ["index.html", /<link rel="canonical" href="([^"]+)"/, siteUrl, "canonical URL"],
  ["index.html", /<meta property="og:url" content="([^"]+)"/, siteUrl, "og:url"],
  ["index.html", /<meta property="og:image" content="([^"]+)"/, `${siteUrl}og.png`, "og:image"],
  ["index.html", /<meta name="twitter:image" content="([^"]+)"/, `${siteUrl}og.png`, "twitter:image"],
  ["sitemap.xml", /<loc>([^<]+)<\/loc>/, siteUrl, "sitemap <loc>"],
  ["robots.txt", /Sitemap:\s*(\S+)/, `${siteUrl}sitemap.xml`, "robots.txt Sitemap"],
];

for (const [file, pattern, expected, label] of checks) {
  const full = path.join(site, file);
  if (!fs.existsSync(full)) { problems.push(`site/${file} is missing.`); continue; }
  const m = fs.readFileSync(full, "utf8").match(pattern);
  if (!m) { problems.push(`site/${file}: no ${label} found.`); continue; }
  if (m[1] !== expected) {
    problems.push(`site/${file}: ${label} is "${m[1]}", expected "${expected}".`);
  } else {
    ok.push(`${file} ${label}`);
  }
}

// --- nothing anywhere still points at an address we have left ---
// Catches the stray hardcoded link the checks above don't name.
const stale = [];
for (const file of fs.readdirSync(site)) {
  const full = path.join(site, file);
  if (!fs.statSync(full).isFile()) continue;
  if (!/\.(html|xml|txt|webmanifest)$/.test(file)) continue;
  const text = fs.readFileSync(full, "utf8");
  for (const url of text.match(/https:\/\/[a-z0-9.-]+\.github\.io\/\S*/gi) ?? []) {
    if (!url.startsWith(cfg.origin)) stale.push(`site/${file}: ${url}`);
  }
}
if (stale.length) {
  problems.push(`Links to an old github.io address remain:\n      ${stale.join("\n      ")}`);
} else {
  ok.push("no leftover github.io links");
}

for (const m of ok) console.log(`  ok   ${m}`);
for (const m of problems) console.error(`  FAIL ${m}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s) — the site's URLs and its deploy target disagree.`);
  process.exit(1);
}
console.log(`\nSite URLs agree with ${siteUrl}`);
