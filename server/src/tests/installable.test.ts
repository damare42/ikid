/**
 * The install path: web manifest, icons, service worker.
 *
 * There is no mobile app and no app store here. "Mobile" is the same
 * responsive client, installed to a home screen — which means the things that
 * make it installable are three static files nobody imports, nothing
 * typechecks, and no screen renders. Exactly the category that rots silently.
 *
 * Two properties are worth more than the rest:
 *
 *   1. Every path in the manifest is *relative*. One manifest serves the app
 *      at a server root and the demo at /ikid/demo/ (and /demo/ after a domain
 *      move). An absolute "/icons/icon-192.png" works in one and 404s in the
 *      other, and a 404 icon means the browser silently declines to install.
 *
 *   2. The service worker never caches anything under /api. It exists because
 *      Chromium won't offer to install without one — but a cache in front of a
 *      finance app is a way to leave someone's transactions on disk after they
 *      log out. That bypass is asserted by running the real handler, not by
 *      grepping for a comment about it.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const clientPublic = path.resolve(__dirname, "../../../client/public");
const read = (p: string) => fs.readFileSync(path.join(clientPublic, p), "utf8");

const manifest = JSON.parse(read("manifest.webmanifest")) as {
  name: string; short_name: string; start_url: string; scope: string;
  display: string; background_color: string; theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
  shortcuts: { name: string; url: string }[];
};

/** Width and height straight out of the PNG IHDR, so no image library. */
function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(path.join(clientPublic, file));
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("web app manifest", () => {
  it("has what a browser needs before it will offer to install", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("keeps every URL relative, so one file serves both deploy bases", () => {
    const urls = [
      manifest.start_url,
      manifest.scope,
      ...manifest.icons.map((i) => i.src),
      ...manifest.shortcuts.map((s) => s.url),
    ];
    for (const u of urls) {
      expect(u.startsWith("/"), `${u} is absolute; it would 404 under /ikid/demo/`).toBe(false);
      expect(/^https?:/.test(u), `${u} points off-origin`).toBe(false);
    }
  });

  it("ships the icons it promises, at the sizes it claims", () => {
    const pngs = manifest.icons.filter((i) => i.type === "image/png");
    expect(pngs.length).toBeGreaterThanOrEqual(3);
    for (const icon of pngs) {
      const file = icon.src.replace(/^\.\//, "");
      expect(fs.existsSync(path.join(clientPublic, file)), `${file} is missing`).toBe(true);
      const [w, h] = icon.sizes.split("x").map(Number);
      expect(pngSize(file)).toEqual({ width: w, height: h });
    }
  });

  it("includes a maskable icon, and a 192 and a 512", () => {
    // Without a maskable icon Android crops the square one to its launcher
    // shape and takes the corners off the mark.
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const size of ["192x192", "512x512"]) {
      expect(manifest.icons.some((i) => i.sizes === size && i.purpose === "any")).toBe(true);
    }
  });

  it("uses the brand mark the rest of the app uses", () => {
    // client/public/brand/*.svg are an older green palette that nothing
    // references. Generating icons from those would have produced a home-screen
    // icon in a colour that appears nowhere else in the product.
    const svg = read("icons/icon.svg");
    const favicon = fs.readFileSync(path.resolve(__dirname, "../../../client/index.html"), "utf8");
    for (const hex of ["c62f14", "8a1f0c"]) {
      expect(svg.toLowerCase(), "icon is not the brand red").toContain(hex);
      expect(favicon.toLowerCase(), "favicon drifted from the app icon").toContain(hex);
    }
    expect(svg).not.toContain("1cb474"); // the retired green
  });

  it("matches the app's own background, so the splash doesn't flash", () => {
    // body is bg-slate-100 in light mode; slate-100 is #f3f2f2.
    expect(manifest.background_color.toLowerCase()).toBe("#f3f2f2");
  });
});

/** Runs the real service worker source against a fake worker global. */
function loadServiceWorker() {
  const src = read("sw.js");
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
    location: { origin: "https://example.com" },
    clients: { claim: () => Promise.resolve() },
  };
  const caches = {
    open: () => Promise.resolve({ put: () => Promise.resolve(), add: () => Promise.resolve() }),
    match: () => Promise.resolve(undefined),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
  };
  new Function("self", "caches", "fetch", src)(self, caches, () => Promise.resolve(new Response("")));
  return handlers;
}

describe("service worker", () => {
  const handlers = loadServiceWorker();

  /** Returns whether the worker took over the request. */
  function intercepts(url: string, init: { method?: string; mode?: string } = {}) {
    let handled = false;
    handlers.fetch({
      request: {
        url,
        method: init.method ?? "GET",
        mode: init.mode ?? "no-cors",
      },
      respondWith: () => { handled = true; },
    });
    return handled;
  }

  it("registers a fetch handler at all — without one, no install prompt", () => {
    expect(typeof handlers.fetch).toBe("function");
  });

  it("never touches the API", () => {
    // The whole point. Cached financial data is the failure this guards.
    expect(intercepts("https://example.com/api/transactions")).toBe(false);
    expect(intercepts("https://example.com/api/auth/status")).toBe(false);
    expect(intercepts("https://example.com/ikid/demo/api/reports")).toBe(false);
  });

  it("never caches writes, or anyone else's origin", () => {
    expect(intercepts("https://example.com/assets/app.js", { method: "POST" })).toBe(false);
    expect(intercepts("https://cdn.example.net/assets/app.js")).toBe(false);
  });

  it("does handle the shell, which is the part that has no user data in it", () => {
    expect(intercepts("https://example.com/assets/index-a1b2c3.js")).toBe(true);
    expect(intercepts("https://example.com/icons/icon-192.png")).toBe(true);
    expect(intercepts("https://example.com/", { mode: "navigate" })).toBe(true);
  });
});
