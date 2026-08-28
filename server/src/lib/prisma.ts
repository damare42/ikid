/**
 * Profile-aware Prisma access. Each profile is its own SQLite file in
 * database/ (full isolation — separate transactions, budgets, goals, rules).
 *
 * The exported `prisma` proxy resolves the right client PER REQUEST:
 * when authentication is enabled, the auth middleware binds the logged-in
 * user's profile to the request via AsyncLocalStorage, so multiple users can
 * hit the API concurrently, each reading/writing only their own database.
 * With auth off, it falls back to the single "active" profile (open mode).
 */
import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** All user data lives here. Overridable so the desktop app (and any host)
 *  can point it at the OS application-data folder. */
export const DB_DIR = process.env.IKID_DATA_DIR
  ? path.resolve(process.env.IKID_DATA_DIR)
  : path.resolve(__dirname, "../../../database");
const REGISTRY = path.join(DB_DIR, "profiles.json");
const DEFAULT_PROFILE = "ikid";

/** Per-request profile binding (set by the auth middleware). */
export const profileContext = new AsyncLocalStorage<{ profile: string }>();

export function sanitizeProfileName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9-_ ]/g, "").replace(/\s+/g, "-").slice(0, 40);
}

let cachedActive: string | null = null;

/** Registry: the active profile plus a permanent account ID per profile.
 *  IDs are assigned once and survive renames — they are the stable identity. */
interface Registry {
  active: string;
  ids: Record<string, string>;
}

function readRegistry(): Registry {
  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRY, "utf-8"));
    if (typeof parsed.active === "string") {
      return { active: parsed.active, ids: parsed.ids ?? {} };
    }
  } catch {
    /* first run */
  }
  return { active: DEFAULT_PROFILE, ids: {} };
}

function writeRegistry(reg: Registry): void {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
  cachedActive = reg.active;
}

/** Get (or lazily assign) a profile's permanent account ID. */
export function getProfileId(name: string): string {
  const reg = readRegistry();
  if (!reg.ids[name]) {
    reg.ids[name] = randomBytes(4).toString("hex");
    writeRegistry(reg);
  }
  return reg.ids[name];
}

/**
 * A profile name is a *filename*, never a path.
 *
 * Callers are supposed to have run the name through sanitizeProfileName
 * already — createProfile and renameProfile do. switchProfile didn't, and the
 * login route passes a name straight from the request body, so the guarantee
 * only held by convention. This is the single place every database path is
 * built, which makes it the one place worth being certain: anything that would
 * escape DB_DIR is rejected outright rather than quietly opening a file
 * somewhere else on disk.
 *
 * Not known to have been exploitable — /activate is refused entirely once
 * accounts are enabled, and login still needs the password — but "you'd need
 * another bug first" is a poor thing to rest a finance app on.
 */
export function getDbPath(name: string): string {
  // Two checks, because neither alone is enough. The first says the name is a
  // bare filename — it rejects "sub/dir" and "/etc/passwd", which the second
  // misses because path.join flattens them back inside DB_DIR. The second says
  // the result actually lands in DB_DIR — it rejects "../evil", which the
  // first misses because basename("../evil") is just "evil".
  const isFilename = name !== "" && name !== "." && name !== ".." && path.basename(name) === name;
  const target = path.join(DB_DIR, `${name}.db`);
  if (!isFilename || path.dirname(path.resolve(target)) !== DB_DIR) {
    throw new Error(`Invalid profile name: ${JSON.stringify(name)}`);
  }
  return target;
}

export function getActiveProfile(): string {
  if (cachedActive == null) cachedActive = readRegistry().active;
  return cachedActive;
}

/** The profile this request should use: session profile, else active. */
export function currentProfile(): string {
  return profileContext.getStore()?.profile ?? getActiveProfile();
}

export function getActiveDbPath(): string {
  return getDbPath(currentProfile());
}

export function listProfiles(): { name: string; id: string; active: boolean; size: number }[] {
  const active = getActiveProfile();
  if (!fs.existsSync(DB_DIR)) return [{ name: active, id: getProfileId(active), active: true, size: 0 }];
  const names = fs
    .readdirSync(DB_DIR)
    .filter((f) => f.endsWith(".db") && !f.includes(".pre-restore"))
    .map((f) => f.replace(/\.db$/, ""));
  if (!names.includes(active)) names.push(active);
  return names.sort().map((name) => ({
    name,
    id: getProfileId(name),
    active: name === active,
    size: fs.existsSync(getDbPath(name)) ? fs.statSync(getDbPath(name)).size : 0,
  }));
}

// One cached client per profile — safe for concurrent users.
const clients = new Map<string, PrismaClient>();

function clientFor(name: string): PrismaClient {
  let client = clients.get(name);
  if (!client) {
    client = new PrismaClient({ datasources: { db: { url: `file:${getDbPath(name)}` } } });
    clients.set(name, client);
  }
  return client;
}

/** Always delegates to the current request's profile (or the active one). */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return (clientFor(currentProfile()) as any)[prop];
  },
});

/**
 * Rename a profile: closes its client, renames the database file, and keeps
 * the active-profile registry consistent. Credentials/sessions are updated
 * by the caller (authService) so this module stays auth-agnostic.
 */
export async function renameProfile(oldName: string, rawNewName: string): Promise<string> {
  const newName = sanitizeProfileName(rawNewName);
  if (!newName) throw new Error("Name must contain letters or numbers");
  if (newName === oldName) return oldName;
  const src = getDbPath(oldName);
  const dst = getDbPath(newName);
  if (!fs.existsSync(src)) throw new Error(`Profile "${oldName}" does not exist`);
  if (fs.existsSync(dst)) throw new Error(`A profile named "${newName}" already exists`);

  // Release the SQLite file handle before renaming (required on Windows).
  const client = clients.get(oldName);
  if (client) {
    await client.$disconnect().catch(() => {});
    clients.delete(oldName);
  }
  fs.renameSync(src, dst);

  // The account ID follows the rename — identity is the ID, not the name.
  const reg = readRegistry();
  if (reg.ids[oldName]) {
    reg.ids[newName] = reg.ids[oldName];
    delete reg.ids[oldName];
  }
  if (reg.active === oldName) reg.active = newName;
  writeRegistry(reg);
  return newName;
}

export async function switchProfile(rawName: string): Promise<void> {
  // createProfile and renameProfile both sanitise; this one didn't, which made
  // it the odd one out and meant an unsanitised name could be written into the
  // registry as the active profile.
  const name = sanitizeProfileName(rawName);
  if (!name) throw new Error("Profile name must contain letters or numbers");
  if (!fs.existsSync(getDbPath(name))) throw new Error(`Profile "${name}" does not exist`);
  writeRegistry({ ...readRegistry(), active: name });
}

/**
 * Create a new empty profile. The schema is cloned by copying the active
 * profile's database file, then all rows are wiped and defaults re-seeded.
 */
export async function createProfile(rawName: string): Promise<string> {
  const name = sanitizeProfileName(rawName);
  if (!name) throw new Error("Profile name must contain letters or numbers");
  const target = getDbPath(name);
  if (fs.existsSync(target)) throw new Error(`Profile "${name}" already exists`);
  const source = getDbPath(currentProfile());
  if (!fs.existsSync(source)) throw new Error("Active database not found — run npm run dev first");

  fs.copyFileSync(source, target);
  const client = clientFor(name);
  // FK-safe wipe order
  await client.transaction.deleteMany();
  await client.import.deleteMany();
  await client.rule.deleteMany();
  await client.budget.deleteMany();
  await client.goal.deleteMany();
  await client.tag.deleteMany();
  await client.merchant.deleteMany();
  await client.category.deleteMany();
  await client.account.deleteMany();
  await client.setting.deleteMany();
  await client.conversation.deleteMany();
  const { seedDefaults } = await import("../services/seedDefaults.js");
  await seedDefaults(client);
  getProfileId(name); // assign the permanent account ID at birth
  return name;
}
