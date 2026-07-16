/**
 * Fire-and-forget usage tracking. Sends a short feature key to the local
 * server, which records it for the signed-in user (no financial data, ever).
 * Failures are silently ignored — telemetry must never disrupt the app.
 */
import { api } from "./api";

let last = "";
let lastAt = 0;

export function track(event: string, meta?: string): void {
  // De-dupe identical events fired within 800ms (e.g. double route renders).
  const now = Date.now();
  if (event === last && now - lastAt < 800) return;
  last = event;
  lastAt = now;
  api.post("/api/track", { event, ...(meta ? { meta } : {}) }).catch(() => {});
}

/** Map a router path to a stable feature key for page-view events. */
export function pageEvent(pathname: string): string {
  const seg = pathname.replace(/^\//, "").split("/")[0] || "dashboard";
  const clean = seg.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "dashboard";
  return `view:${clean}`;
}
