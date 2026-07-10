/** Minimal structured logger — no external dependency needed. */
type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (meta) out(line, JSON.stringify(meta));
  else out(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
};
