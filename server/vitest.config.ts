import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * The server suite also covers the hosted demo's in-browser API, which lives
 * in client/src/demo. Those modules import the server's pure engines through
 * the same `@engine` / `@shared` aliases the client build uses, so the aliases
 * are repeated here — otherwise the demo could only be tested by loading a
 * browser, which is exactly the kind of verification that quietly stops
 * happening.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
      "@engine": path.resolve(__dirname, "src/services"),
    },
  },
  test: {
    include: ["src/tests/**/*.test.ts"],
  },
});
