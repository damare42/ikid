/**
 * Service worker — app shell only. Never financial data.
 *
 * This exists because Chromium will not offer to install a web app unless a
 * service worker with a real fetch handler is controlling the page. On its own
 * that's a box to tick; a service worker in a finance app is also a way to
 * leave someone's transactions sitting in a browser cache on a shared laptop,
 * long after they've logged out. So the rule here is narrow and absolute:
 *
 *   **Nothing under /api is ever read from, or written to, the cache.**
 *
 * What is cached is the shell — the HTML, the hashed JS and CSS, the icons.
 * Those are identical for every user and contain no account data. The benefit
 * is real: the app opens instantly, and the demo works with the network off,
 * which for an app that claims your data never leaves your machine is a
 * demonstration rather than a promise.
 *
 * Update strategy, and why:
 *
 *   - Hashed build assets are cache-first. Vite puts a content hash in the
 *     filename, so a given URL's bytes never change. Cache-first is safe by
 *     construction, and it is what makes the launch instant.
 *   - The HTML document is network-first with a cache fallback. The document
 *     URL is stable while its contents change every deploy, so serving it from
 *     cache is how an app gets permanently stuck on an old version. Network
 *     first means a reachable server always wins; the cache is only there for
 *     offline.
 *   - No skipWaiting(). A new worker takes over on the next full load rather
 *     than mid-session. Swapping the worker under a running page can leave it
 *     asking the new build for chunks the old build named, which fails in a
 *     way users experience as the app randomly breaking.
 *
 * Bumping CACHE below is what evicts everything from the previous version.
 */

const CACHE = "ikid-shell-v1";

// Resolved against the worker's own URL, so this works unchanged whether the
// app is served from a server root or the demo from /ikid/demo/.
const SHELL = ["./", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (event) => {
  // Best-effort: a failed precache must not stop the worker from installing,
  // or a single 404 leaves the app with no worker at all and no install
  // prompt. The fetch handler fills the cache as things are used anyway.
  event.waitUntil(
    caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Anything that could carry account data. Never cached, in either direction. */
function isPrivate(url) {
  return url.pathname.includes("/api/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only ever touch same-origin GETs. A POST is a write; a cross-origin
  // request is someone else's server and not ours to cache.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (isPrivate(url)) return; // straight to the network, uncached

  // The document: network first, so a deploy lands immediately.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("./"))),
    );
    return;
  }

  // Everything else is a hashed asset or an icon: cache first.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        // Don't cache errors or opaque responses — an opaque response has an
        // unknown status, so caching one can pin a failure in place.
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      });
    }),
  );
});
