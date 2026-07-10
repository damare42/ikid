/**
 * ikid desktop — Electron main process.
 * Runs the bundled Express server as a child utility process against a data
 * directory in the OS's per-user application folder, then opens a window at
 * the local URL. No network access beyond localhost (and optional Ollama).
 */
const { app, BrowserWindow, dialog, shell, utilityProcess } = require("electron");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 34117;
let serverProc = null;
let win = null;

const res = (p) => (app.isPackaged ? path.join(process.resourcesPath, p) : path.join(__dirname, p));
const DATA_DIR = () => path.join(app.getPath("userData"), "data");

/* ---------- first run: install the template database ---------- */
function ensureData() {
  const dataDir = DATA_DIR();
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(path.join(dataDir, "ikid.db"))) {
    fs.cpSync(res("template-data"), dataDir, { recursive: true });
  }
}

/* ---------- upgrades: backup, then push the current schema ---------- */
function upgradeIfNeeded() {
  const dataDir = DATA_DIR();
  const stamp = path.join(dataDir, ".app-version");
  const prev = fs.existsSync(stamp) ? fs.readFileSync(stamp, "utf-8").trim() : null;
  if (prev === app.getVersion()) return;

  // Backup every database before touching the schema
  if (prev !== null) {
    const dest = path.join(dataDir, "backups", `pre-${app.getVersion()}`);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(dataDir).filter((f) => f.endsWith(".db"))) {
      fs.copyFileSync(path.join(dataDir, f), path.join(dest, f));
    }
  }

  // Apply the (possibly newer) schema to every profile database via the
  // bundled Prisma CLI, executed with Electron's own Node runtime.
  const prismaCli = res("prisma-runtime/node_modules/prisma/build/index.js");
  const schema = res("prisma-runtime/schema.prisma");
  for (const f of fs.readdirSync(dataDir).filter((f) => f.endsWith(".db"))) {
    const r = spawnSync(
      process.execPath,
      [prismaCli, "db", "push", "--skip-generate", `--schema=${schema}`],
      {
        cwd: res("prisma-runtime"),
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          IKID_DATABASE_URL: "file:" + path.join(dataDir, f),
        },
        timeout: 60_000,
      },
    );
    if (r.status !== 0) {
      console.error(`schema push failed for ${f}:`, r.stderr?.toString().slice(0, 500));
    }
  }
  fs.writeFileSync(stamp, app.getVersion());
}

/* ---------- run the server ---------- */
function startServer() {
  const dataDir = DATA_DIR();
  serverProc = utilityProcess.fork(res("server-bundle/index.mjs"), [], {
    env: {
      ...process.env,
      PORT: String(PORT),
      IKID_DATA_DIR: dataDir,
      IKID_DATABASE_URL: "file:" + path.join(dataDir, "ikid.db"),
      IKID_CLIENT_DIST: res("client-dist"),
      NODE_ENV: "production",
    },
    stdio: "pipe",
  });
  serverProc.stdout?.on("data", (d) => console.log("[server]", d.toString().trim()));
  serverProc.stderr?.on("data", (d) => console.error("[server]", d.toString().trim()));
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "ikid",
    backgroundColor: "#f8fafc",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // External links (Ollama docs, etc.) open in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://localhost:${PORT}`)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL(`http://localhost:${PORT}/#/`);
}

/* ---------- lifecycle ---------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      ensureData();
      upgradeIfNeeded();
      startServer();
      const up = await waitForServer();
      if (!up) {
        dialog.showErrorBox(
          "ikid could not start",
          "The local server did not come up. Your data is untouched in:\n" + DATA_DIR(),
        );
        app.quit();
        return;
      }
      createWindow();
    } catch (e) {
      dialog.showErrorBox("ikid could not start", String(e));
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverProc) createWindow();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    serverProc?.kill();
    serverProc = null;
  });
}
