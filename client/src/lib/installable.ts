/**
 * Registers the app-shell service worker, which is what lets a browser offer
 * "Install" / "Add to Home Screen".
 *
 * Two places deliberately don't get one:
 *
 * **The desktop app.** Electron loads the client over http://localhost, which
 * counts as a secure origin, so the worker would happily register there. It
 * has nothing to offer — the desktop app is already installed, and its assets
 * already ship on disk — and something to cost: the app updates by replacing
 * client-dist wholesale, and a cache sitting in front of that is a way for a
 * freshly updated app to keep serving the old build. The detection is the
 * `Electron/` token Electron puts in its user agent; main.cjs doesn't override
 * the UA, and if it ever does, this check needs revisiting.
 *
 * **Dev.** A worker caching the Vite dev server produces exactly the bug where
 * your change doesn't appear and you doubt your own edit.
 *
 * Both cases also *unregister* an existing worker rather than just skipping.
 * Someone who ran the web app on localhost and later opens the desktop app hits
 * the same origin, and would otherwise inherit a worker nothing will clean up.
 */

const isElectron = () => / Electron\//.test(navigator.userAgent);

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  if (!import.meta.env.PROD || isElectron()) {
    void navigator.serviceWorker.getRegistrations()
      .then((rs) => rs.forEach((r) => void r.unregister()))
      .catch(() => {});
    return;
  }

  // After load: registration competes with the app's own first paint and data
  // fetches for connections, and the app being usable matters more than the
  // second visit being fast.
  window.addEventListener("load", () => {
    // Relative to the document, so this resolves correctly both for the app at
    // a server root and the demo under /ikid/demo/. The scope follows the
    // worker's location, which is what keeps the demo's worker from claiming
    // the whole site it is hosted on.
    void navigator.serviceWorker.register("sw.js").catch(() => {
      // An unavailable worker costs the install prompt and nothing else. The
      // app works; there is nothing here worth interrupting anyone over.
    });
  });
}
