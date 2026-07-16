/**
 * Authentication for multi-user (multi-profile) use.
 *
 * Design (local-first, no external dependencies):
 * - Each profile can have a password. Hashes are scrypt (N=16384) with a
 *   per-profile random salt, stored in database/auth.json (mode 0600).
 * - Verification uses timing-safe comparison; login attempts are rate-limited
 *   (5 failures → 30s lockout per profile).
 * - Sessions are 32-byte random tokens held in server memory (24h TTL),
 *   delivered as an HttpOnly SameSite=Strict cookie — JS can never read it.
 * - Auth activates the moment ANY profile has a password. With no passwords
 *   set, the app behaves exactly as before (single-user open mode).
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DB_DIR, listProfiles } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const AUTH_FILE = path.join(DB_DIR, "auth.json");
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

export interface Credential {
  salt: string;
  hash: string;
}

// ---------- password hashing (pure, unit-tested) ----------

export function hashPassword(password: string, salt?: string): Credential {
  const s = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, s, 64).toString("hex");
  return { salt: s, hash };
}

export function verifyPassword(password: string, cred: Credential): boolean {
  const candidate = scryptSync(password, cred.salt, 64);
  const expected = Buffer.from(cred.hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------- credential store ----------

function readCreds(): Record<string, Credential> {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeCreds(creds: Record<string, Credential>): void {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

/** Auth is on as soon as any profile has a password — or always, when the
 *  deployment demands it (IKID_REQUIRE_AUTH=1, set by the Docker image so a
 *  networked instance never runs in open mode). */
export function authEnabled(): boolean {
  const forced = process.env.IKID_REQUIRE_AUTH;
  if (forced === "1" || forced === "true") return true;
  return Object.keys(readCreds()).length > 0;
}

export function isProtected(profile: string): boolean {
  return profile in readCreds();
}

export function setPassword(profile: string, password: string): void {
  const creds = readCreds();
  creds[profile] = hashPassword(password);
  writeCreds(creds);
  logger.info("Password set", { profile });
}

export function removePassword(profile: string): void {
  const creds = readCreds();
  delete creds[profile];
  writeCreds(creds);
  logger.warn("Password removed", { profile });
}

// ---------- login with rate limiting ----------

const failures = new Map<string, { count: number; lockedUntil: number }>();

export function checkLogin(profile: string, password: string): { ok: boolean; error?: string } {
  const f = failures.get(profile);
  if (f && f.lockedUntil > Date.now()) {
    return { ok: false, error: `Too many attempts — try again in ${Math.ceil((f.lockedUntil - Date.now()) / 1000)}s` };
  }
  const creds = readCreds();
  const cred = creds[profile];
  // Unprotected profiles can be entered without a password (until one is set).
  const ok = cred ? verifyPassword(password, cred) : true;
  if (!ok) {
    const next = { count: (f?.count ?? 0) + 1, lockedUntil: 0 };
    if (next.count >= MAX_ATTEMPTS) {
      next.lockedUntil = Date.now() + LOCKOUT_MS;
      next.count = 0;
    }
    failures.set(profile, next);
    logger.warn("Failed login", { profile });
    return { ok: false, error: "Wrong password" };
  }
  failures.delete(profile);
  return { ok: true };
}

// ---------- sessions (persisted so restarts don't log everyone out) ----------

const SESSIONS_FILE = path.join(DB_DIR, "sessions.json");

function loadSessions(): Map<string, { profile: string; expires: number }> {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
    const now = Date.now();
    return new Map(
      Object.entries(raw).filter(
        ([, s]: [string, any]) => s && typeof s.profile === "string" && s.expires > now,
      ) as [string, { profile: string; expires: number }][],
    );
  } catch {
    return new Map();
  }
}

const sessions = loadSessions();

function saveSessions(): void {
  try {
    fs.mkdirSync(DB_DIR, { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
  } catch (e) {
    logger.warn("Could not persist sessions", { message: (e as Error).message });
  }
}

export function createSession(profile: string): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { profile, expires: Date.now() + SESSION_TTL_MS });
  saveSessions();
  return token;
}

export function getSessionProfile(token: string | undefined): string | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) {
    sessions.delete(token);
    saveSessions();
    return null;
  }
  return s.profile;
}

export function destroySession(token: string | undefined): void {
  if (token && sessions.delete(token)) saveSessions();
}

/** Invalidate every live session for a profile (on disable / password reset). */
export function destroySessionsFor(profile: string): void {
  let changed = false;
  for (const [token, s] of sessions) {
    if (s.profile === profile) {
      sessions.delete(token);
      changed = true;
    }
  }
  if (changed) saveSessions();
}

/** Keep credentials and live sessions pointing at a renamed profile. */
export function renameProfileAuth(oldName: string, newName: string): void {
  if (oldName === newName) return;
  const creds = readCreds();
  if (creds[oldName]) {
    creds[newName] = creds[oldName];
    delete creds[oldName];
    writeCreds(creds);
  }
  let changed = false;
  for (const s of sessions.values()) {
    if (s.profile === oldName) {
      s.profile = newName;
      changed = true;
    }
  }
  if (changed) saveSessions();
  failures.delete(oldName);
}

/** Login-screen data: which profiles exist and which need a password. */
export function loginOptions(): { name: string; id: string; protected: boolean }[] {
  return listProfiles().map((p) => ({ name: p.name, id: p.id, protected: isProtected(p.name) }));
}

// ---------- cookie helpers ----------

export const SESSION_COOKIE = "ikid_session";

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Set IKID_SECURE_COOKIES=1 when serving over HTTPS (reverse proxy). */
function secureFlag(): string {
  return process.env.IKID_SECURE_COOKIES ? "; Secure" : "";
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secureFlag()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secureFlag()}`;
}
