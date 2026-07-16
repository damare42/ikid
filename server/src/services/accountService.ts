/**
 * Central account registry — the "who can use this app" layer that sits above
 * the per-profile databases. Each profile (its own SQLite file) is a user
 * account; this store adds a role, an enabled/disabled flag, and timestamps,
 * plus deployment-wide config (whether new sign-ups are allowed).
 *
 * Local-first & privacy: this file holds ACCOUNT metadata only — never any
 * financial data. Admins can manage accounts and see usage analytics, but
 * profiles stay fully isolated, so no admin can read another user's money.
 *
 * Stored as accounts.json in the data dir (mode 0600), alongside the existing
 * auth.json / sessions.json / profiles.json. This is the natural seam a hosted
 * version would swap for a shared database (see docs/GO-PUBLIC.md).
 */
import fs from "node:fs";
import path from "node:path";
import { DB_DIR, listProfiles } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

export type Role = "admin" | "user";

export interface Account {
  role: Role;
  disabled: boolean;
  createdAt: string; // ISO
  lastLogin: string | null;
}

export interface AdminConfig {
  allowSignups: boolean;
}

interface Store {
  accounts: Record<string, Account>;
  config: AdminConfig;
}

const STORE_FILE = path.join(DB_DIR, "accounts.json");
const DEFAULT_CONFIG: AdminConfig = { allowSignups: true };

function readStore(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
    return {
      accounts: parsed.accounts ?? {},
      config: { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) },
    };
  } catch {
    return { accounts: {}, config: { ...DEFAULT_CONFIG } };
  }
}

function writeStore(store: Store): void {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}

/**
 * One-time bootstrap: if the store is empty but profiles already exist (e.g.
 * an existing local install adopting the admin layer), create metadata for
 * each and make one an admin. The admin is IKID_ADMIN if set, else the active
 * profile, else the first alphabetically.
 */
function bootstrap(store: Store): Store {
  if (Object.keys(store.accounts).length > 0) return store;
  const profiles = listProfiles();
  if (profiles.length === 0) return store;

  const envAdmin = process.env.IKID_ADMIN;
  const active = profiles.find((p) => p.active)?.name;
  const adminName =
    (envAdmin && profiles.some((p) => p.name === envAdmin) && envAdmin) ||
    active ||
    profiles[0].name;

  const now = new Date().toISOString();
  for (const p of profiles) {
    store.accounts[p.name] = {
      role: p.name === adminName ? "admin" : "user",
      disabled: false,
      createdAt: now,
      lastLogin: null,
    };
  }
  writeStore(store);
  logger.info("Account store bootstrapped", { admin: adminName, count: profiles.length });
  return store;
}

function load(): Store {
  return bootstrap(readStore());
}

// ---------- queries ----------

export function getAccount(name: string): Account | null {
  return load().accounts[name] ?? null;
}

export function listAccounts(): (Account & { name: string })[] {
  const store = load();
  return Object.entries(store.accounts)
    .map(([name, a]) => ({ name, ...a }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isAdmin(name: string | null | undefined): boolean {
  return !!name && getAccount(name)?.role === "admin";
}

export function isDisabled(name: string): boolean {
  return getAccount(name)?.disabled === true;
}

export function getConfig(): AdminConfig {
  return load().config;
}

export function accountCount(): number {
  return Object.keys(load().accounts).length;
}

function enabledAdminCount(store: Store, exclude?: string): number {
  return Object.entries(store.accounts).filter(
    ([n, a]) => n !== exclude && a.role === "admin" && !a.disabled,
  ).length;
}

// ---------- mutations ----------

/**
 * Register a profile as an account. The very first account created (empty
 * store, no existing profiles) becomes the admin automatically.
 */
export function ensureAccount(name: string): Account {
  const store = load();
  if (store.accounts[name]) return store.accounts[name];
  const firstEver = Object.keys(store.accounts).length === 0;
  const account: Account = {
    role: firstEver ? "admin" : "user",
    disabled: false,
    createdAt: new Date().toISOString(),
    lastLogin: null,
  };
  store.accounts[name] = account;
  writeStore(store);
  logger.info("Account created", { name, role: account.role });
  return account;
}

export function recordLogin(name: string): void {
  const store = load();
  const a = store.accounts[name] ?? ensureAccount(name);
  a.lastLogin = new Date().toISOString();
  store.accounts[name] = a;
  writeStore(store);
}

export function setRole(name: string, role: Role): void {
  const store = load();
  const a = store.accounts[name];
  if (!a) throw new Error(`Account "${name}" not found`);
  if (a.role === "admin" && role !== "admin" && enabledAdminCount(store, name) === 0) {
    throw new Error("Can't demote the last remaining admin");
  }
  a.role = role;
  writeStore(store);
  logger.info("Role changed", { name, role });
}

export function setDisabled(name: string, disabled: boolean): void {
  const store = load();
  const a = store.accounts[name];
  if (!a) throw new Error(`Account "${name}" not found`);
  if (disabled && a.role === "admin" && enabledAdminCount(store, name) === 0) {
    throw new Error("Can't disable the last remaining admin");
  }
  a.disabled = disabled;
  writeStore(store);
  logger.warn("Account " + (disabled ? "disabled" : "enabled"), { name });
}

export function setConfig(patch: Partial<AdminConfig>): AdminConfig {
  const store = load();
  store.config = { ...store.config, ...patch };
  writeStore(store);
  return store.config;
}

/** Keep account metadata attached to a renamed profile. */
export function renameAccount(oldName: string, newName: string): void {
  if (oldName === newName) return;
  const store = load();
  if (store.accounts[oldName]) {
    store.accounts[newName] = store.accounts[oldName];
    delete store.accounts[oldName];
    writeStore(store);
  }
}

/** Testing/support hook: wipe the in-file store. */
export function _resetStoreForTests(): void {
  try {
    fs.unlinkSync(STORE_FILE);
  } catch {
    /* already gone */
  }
}
