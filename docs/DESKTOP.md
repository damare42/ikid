# ikid Desktop

The desktop app wraps the same local server + web UI in an Electron shell:
double-click, sign in, done — no terminal, no npm, no Docker. Your data lives
in the OS's per-user application folder:

- **macOS:** `~/Library/Application Support/ikid/data/`
- **Windows:** `%APPDATA%\ikid\data\`
- **Linux:** `~/.config/ikid/data/`

Everything else is identical to the web version: one SQLite file per person,
zero third-party calls, optional Ollama for the Planner (install Ollama
normally on the machine — the app finds it at `localhost:11434`).

## Getting a build

Tagged releases build installers automatically via GitHub Actions
(`release.yml`): a `.dmg` for macOS (arm64 + Intel), an `.exe` (NSIS) for
Windows, and an `.AppImage` for Linux. Push a tag:

```bash
git tag v0.3.0 && git push origin v0.3.0
```

then download the artifacts from the draft GitHub Release, test, and publish.

To build locally instead:

```bash
npm install && npm run build      # repo root: web app
cd desktop
npm install
npm run dist                      # → desktop/release/
```

## Unsigned builds — first-open instructions

The builds are **not code-signed** (signing needs a $99/yr Apple Developer ID
and a Windows certificate). Users will see a warning on first open:

- **macOS:** right-click the app → Open → Open (or System Settings →
  Privacy & Security → "Open Anyway"). Needed once.
- **Windows:** SmartScreen → "More info" → "Run anyway".

When you're ready to distribute widely, add signing credentials as CI secrets
(`CSC_LINK`/`CSC_KEY_PASSWORD` for electron-builder) and notarization for macOS.

## How the app is put together

`desktop/build.mjs` assembles four pieces: the server bundled to a single ESM
file (esbuild), the built web client, a freshly-seeded **template database**
that first launch copies into the user's data folder, and a **Prisma runtime**
(CLI + engines). On version upgrades the app backs up every profile database,
then runs `prisma db push` against each one using the bundled CLI — the same
safety flow as the npm and Docker installs.

## Updates

No auto-updater yet — users download the new installer; their data folder is
untouched and migrated on first launch (with automatic pre-upgrade backups in
`data/backups/`). electron-updater + GitHub Releases is the natural next step
once builds are signed.
