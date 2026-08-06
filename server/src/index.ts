import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { DB_DIR, listProfiles } from "./lib/prisma.js";
import { authEnabled } from "./services/authService.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = process.env.IKID_CLIENT_DIST
  ? path.resolve(process.env.IKID_CLIENT_DIST)
  : path.resolve(__dirname, "../../client/dist");

// Startup diagnostics — makes "which folder / which mode" obvious in logs.
function logStartupContext() {
  try {
    const names = listProfiles().map((p) => `${p.name}${p.active ? "*" : ""}`);
    logger.info(`Data dir: ${DB_DIR}`);
    logger.info(`Profiles: ${names.join(", ") || "(none yet)"}  (* = active)`);
    logger.info(`Auth: ${authEnabled() ? "required (accounts mode)" : "open (no password set)"}`);
  } catch (e) {
    logger.warn("Could not read profiles at startup", { message: (e as Error).message });
  }
}

const server = createApp().listen(PORT, HOST, () => {
  logStartupContext();
  if (fs.existsSync(CLIENT_DIST)) {
    logger.info(`Ikid is running — open http://localhost:${PORT}`);
  } else {
    logger.info(`Ikid API listening on http://localhost:${PORT}`);
    logger.warn("client/dist not found — run `npm run build` once to serve the app here, or use `npm run dev`.");
  }
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(
      `Port ${PORT} is already in use — an old ikid server is probably still running. ` +
      `Stop it (macOS/Linux: lsof -ti :${PORT} | xargs kill) and start again, or set PORT to a free port.`,
    );
    process.exit(1);
  }
  throw err;
});
