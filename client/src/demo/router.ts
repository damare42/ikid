/**
 * A tiny HTTP router that never touches the network.
 *
 * `api.ts` hands every request here when the demo build flag is set. Handlers
 * are registered against "METHOD /api/path" and may use `:params`, so the
 * routing table reads like the Express one it stands in for.
 */
import { ready } from "./store.js";

export interface DemoRequest {
  method: string;
  /** Path with the query string removed. */
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
}

export type DemoHandler = (req: DemoRequest) => unknown | Promise<unknown>;

/** Thrown by a handler to produce a non-200 the client will surface normally. */
export class DemoHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Route {
  method: string;
  segments: string[];
  handler: DemoHandler;
}

const routes: Route[] = [];

export function route(spec: string, handler: DemoHandler): void {
  const [method, path] = spec.split(" ");
  routes.push({ method, segments: path.split("/").filter(Boolean), handler });
}

function match(method: string, path: string): { handler: DemoHandler; params: Record<string, string> } | null {
  const parts = path.split("/").filter(Boolean);
  for (const r of routes) {
    if (r.method !== method || r.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < r.segments.length; i++) {
      const seg = r.segments[i];
      if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(parts[i]);
      else if (seg !== parts[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

/**
 * Handle one request. Mirrors what `fetch` would have returned, including the
 * small artificial delay — without it every screen paints synchronously, the
 * loading states never appear, and the demo misrepresents how the real app
 * behaves on a first paint.
 */
export async function handle(method: string, url: string, body: unknown): Promise<unknown> {
  await ready();
  const qIndex = url.indexOf("?");
  const path = qIndex >= 0 ? url.slice(0, qIndex) : url;
  const query = new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : "");

  const found = match(method, path);
  if (!found) throw new DemoHttpError(404, `Not available in the demo: ${method} ${path}`);

  await new Promise((r) => setTimeout(r, 60));
  return found.handler({ method, path, query, params: found.params, body });
}

// ---------- helpers shared by the handler modules ----------

export const num = (q: URLSearchParams, k: string): number | undefined => {
  const v = q.get(k);
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const str = (q: URLSearchParams, k: string): string | undefined => q.get(k) || undefined;

export const bool = (q: URLSearchParams, k: string): boolean | undefined => {
  const v = q.get(k);
  if (v == null || v === "") return undefined;
  return v === "true";
};
