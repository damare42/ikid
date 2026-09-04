import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

/**
 * The demo's asset URLs are absolute from the site root, so they depend on
 * where the site is served from: `/ikid/demo/` under a GitHub Pages project
 * path, `/demo/` under a custom domain at the apex.
 *
 * This used to be a `--base=/ikid/demo/` flag hardcoded in the build script,
 * with the matching string hardcoded again in the build verifier and a third
 * time in the site's canonical URLs. Three copies of one fact, and getting the
 * base wrong doesn't error — it emits a perfectly valid page whose every asset
 * 404s. Reading it from site.config.json makes the move a one-file edit and
 * keeps the verifier honest, because it checks against the same value.
 */
const siteConfig = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../site.config.json"), "utf8"),
) as { origin: string; base: string };

/**
 * The hosted demo builds this same client with no server behind it.
 *
 * Keyed on Vite's `--mode demo` rather than an environment variable, for two
 * reasons: `VAR=1 npm run ...` isn't valid on Windows cmd, and the build has to
 * run *inside* this directory anyway — Tailwind resolves its config and its
 * content globs from the working directory, so building from the repo root
 * silently produced a stylesheet with no utility classes in it and shipped an
 * unstyled app.
 */
/**
 * The installed app loads its webfonts from Google. That's a defensible choice
 * on localhost — it's your machine, your call. It is not defensible on the
 * public marketing site, which argues at length that it makes no third-party
 * requests: a visitor clicking "Try the live demo" would go straight from that
 * claim to a page handing their IP to Google for three font families.
 *
 * So the demo build strips the font links and falls back to the system stack,
 * exactly as site/index.html does.
 */
const stripWebfonts = () => ({
  name: "ikid-strip-webfonts",
  transformIndexHtml(html: string) {
    return html
      .replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.[^"]*"[^>]*>/g, "")
      .replace(/\s*<link[^>]*href="https:\/\/fonts\.googleapis\.com[^"]*"[^>]*>/g, "");
  },
});

export default defineConfig(({ mode }) => {
  const isDemo = mode === "demo";
  return {
    // Only the demo is served from a subpath of a static site. The installed
    // app is served from its own server's root.
    ...(isDemo ? { base: `${siteConfig.base}demo/` } : {}),
    plugins: [react(), ...(isDemo ? [stripWebfonts()] : [])],
    // The client reads import.meta.env.VITE_IKID_DEMO; set it from the mode so
    // there's one source of truth and no env var to forget.
    define: {
      "import.meta.env.VITE_IKID_DEMO": JSON.stringify(isDemo ? "1" : ""),
    },
    resolve: {
      alias: {
        "@shared": path.resolve(__dirname, "../shared"),
        // The server's pure calculation modules, shared with the hosted demo.
        // See client/tsconfig.json for the rule about what may be imported.
        "@engine": path.resolve(__dirname, "../server/src/services"),
        // The in-browser API, or a stub that throws if anything reaches for it.
        "@demo": path.resolve(__dirname, isDemo ? "src/demo/index.ts" : "src/demo/disabled.ts"),
        // Demo build only: services/dedupe.ts hashes with node:crypto, which a
        // browser doesn't have. The shim explains what it is and isn't.
        ...(isDemo
          ? { "node:crypto": path.resolve(__dirname, "src/demo/node-crypto-shim.ts") }
          : {}),
      },
    },
    server: {
      port: 5173,
      fs: { allow: [".."] },
      proxy: { "/api": "http://localhost:3001" },
    },
  };
});
