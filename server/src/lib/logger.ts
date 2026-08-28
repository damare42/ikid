/** Minimal structured logger — no external dependency needed. */
type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  // Always a single argument. console.log(a, b) treats `a` as a format string,
  // so a "%s" anywhere in `msg` — a filename, a merchant, an error from a
  // parsed statement — would swallow the metadata and print something that
  // never happened. With one argument there is nothing to substitute into.
  out(meta ? `${line} ${JSON.stringify(meta)}` : line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
};
