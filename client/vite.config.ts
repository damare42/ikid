import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The hosted demo builds this same client with no server behind it.
const isDemo = process.env.VITE_IKID_DEMO === "1";

export default defineConfig({
  plugins: [react()],
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
});
