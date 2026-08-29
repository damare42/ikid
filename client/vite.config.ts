import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

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
export default defineConfig(({ mode }) => {
  const isDemo = mode === "demo";
  return {
    plugins: [react()],
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
