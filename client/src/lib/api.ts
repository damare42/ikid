/** Tiny typed fetch wrapper for the Ikid API. */

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The hosted demo builds this whole client with no server behind it, and
 * answers requests from an in-browser dataset instead. This is the single
 * switch: every page, hook and component below it is the real one, unmodified,
 * which is the point — a demo that forked the UI would stop being evidence
 * that the app works.
 *
 * The demo code is kept out of the normal app by module resolution: "@demo"
 * points at the real implementation only when VITE_IKID_DEMO is set, and at a
 * throwing stub otherwise (client/vite.config.ts). A normal build is 687
 * modules, the demo build 709.
 */
export const IS_DEMO = import.meta.env.VITE_IKID_DEMO === "1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // "@demo" resolves to the real in-browser API only in a demo build; in a
  // normal build it resolves to a stub (see vite.config.ts and
  // src/demo/disabled.ts). Exclusion is done by module resolution rather than
  // dead-code elimination because the latter didn't actually work — Vite kept
  // the dynamic import reachable and the normal build failed trying to bundle
  // node:crypto.
  if (import.meta.env.VITE_IKID_DEMO === "1") {
    const { handle, DemoHttpError } = await import("@demo");
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (init?.body instanceof FormData) body = init.body;
    else if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    try {
      return (await handle(method, path, body)) as T;
    } catch (e) {
      if (e instanceof DemoHttpError) throw new ApiRequestError(e.status, e.message);
      throw new ApiRequestError(500, (e as Error).message);
    }
  }

  const res = await fetch(path, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* not json */
    }
    // Session expired / signed out — let the app show the login screen.
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event("ikid:unauthorized"));
    }
    throw new ApiRequestError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body != null ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};

export function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
}
