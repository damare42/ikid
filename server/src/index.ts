import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";

const PORT = Number(process.env.PORT ?? 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

createApp().listen(PORT, () => {
  if (fs.existsSync(CLIENT_DIST)) {
    logger.info(`Ikid is running — open http://localhost:${PORT}`);
  } else {
    logger.info(`Ikid API listening on http://localhost:${PORT}`);
    logger.warn("client/dist not found — run `npm run build` once to serve the app here, or use `npm run dev`.");
  }
});
