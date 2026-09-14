# ikid on a phone

There is no ikid app in the App Store or on Google Play, and there is no plan
for one. What there is: the same app, installable to your home screen, opening
full-screen with its own icon.

That is not a lesser version. It is the whole app — every page, every chart,
the same engines — because the client has been responsive since the mobile
navigation landed. The only thing installing changes is that it opens without
browser chrome and lives on the home screen.

## Installing it

First you need an instance to point at: the app running on your own machine
(`http://localhost:3001`) or on your own server (`docs/DEPLOY-ONLINE.md`). A
phone can only reach `localhost` on the same machine, so in practice installing
means you have it on a server, or on the same Wi-Fi as the computer running it.

**iOS (Safari)** — open the app, tap Share, then **Add to Home Screen**.
Safari is the only iOS browser that can do this; Chrome and Firefox on iOS
can't.

**Android (Chrome)** — open the app and take the **Install app** prompt, or
find it in the ⋮ menu.

**Desktop Chrome or Edge** — an install icon appears in the address bar. The
same manifest serves all three.

### iOS needs HTTPS

Safari will not install a page served over plain HTTP, and won't run a service
worker on one. `http://192.168.1.x:3001` on your home network is not enough.
If you're installing on iOS, the instance needs a certificate — which is what
`deploy/Caddyfile` sets up automatically. Android and desktop Chrome will
install from `localhost` without one.

## What it caches, and what it never caches

Installing registers a service worker. In a finance app that deserves a plain
answer, so:

**Cached:** the HTML, the hashed JavaScript and CSS, the icons. The app shell.
Identical bytes for every user, no account data in any of it. This is why the
installed app opens instantly.

**Never cached, in either direction:** anything under `/api`. Every
transaction, balance, budget and projection is fetched from your instance every
time, and none of it is written to disk by the browser. A cache in front of a
finance app is a way to leave someone's transactions on a shared laptop long
after they've logged out, so the bypass is absolute and there is a test that
runs the real service-worker handler to prove it.

The worker is also not registered in two places: the Electron desktop app,
which is already installed and updates by replacing its bundle wholesale, and
development, where a stale cache is just a way to doubt your own edits.

## The demo is not installable, on purpose

The [live demo](https://damare42.github.io/ikid/demo/) runs the real app
against fake data in your browser. It deliberately ships no manifest, so no
browser will offer to install it.

An icon on a home screen is divorced from the banner that explains none of this
is real. Someone would install what they took to be the app, then wonder why
their money is somebody else's and nothing they type survives. The demo is for
trying in a browser; the app is what gets installed.

The demo does keep the service worker, so it works with the network off. For an
app whose claim is that your data never leaves your machine, that is a
demonstration rather than a promise.

## Why not a native app

An App Store build would mean a developer account, signing certificates, review
for every update, and — the real problem — a server for the app to talk to. The
whole architecture is that your financial data lives on a machine you control.
A native app in a store implies a service behind it, which is the thing this
project doesn't have and hasn't decided to build
(see [ONLINE-PLAN.md](ONLINE-PLAN.md)).

If that changes, the client is already the mobile UI, and the work would be
wrapping rather than rewriting.

## For maintainers

| File | What it does |
|---|---|
| `client/public/manifest.webmanifest` | Name, icons, colours. Every path relative, so one file serves the app at a server root and the demo at `/ikid/demo/`. |
| `client/public/sw.js` | Shell caching, `/api` bypass. |
| `client/src/lib/installable.ts` | Registers the worker; skips Electron and dev, and unregisters where it shouldn't run. |
| `client/index.html` | Manifest link, Apple-specific tags, light/dark `theme-color`. |
| `scripts/build-icons.sh` | Regenerates the icons from the brand mark. Outputs are committed. |
| `server/src/tests/installable.test.ts` | Pins the relative paths, the icon sizes, the brand colour, and the `/api` bypass. |

The icons come from the mark in `client/index.html`, not from
`client/public/brand/*.svg` — those are an older green palette that nothing
references.
