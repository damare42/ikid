/**
 * The demo's in-browser database.
 *
 * This exists so a stranger can use the *real* application — every screen,
 * every filter, every chart — without installing anything and without a server
 * holding their data. Describing a finance app is weak; letting someone drive
 * it is the whole argument.
 *
 * The trick that makes it honest rather than a mock-up: the dataset is built
 * by `loadDemoInto()`, the same function the installed app uses for demo mode,
 * against an in-memory object that satisfies the same `DemoDb` interface it
 * normally gets from Prisma. So the demo can't drift from the product — if the
 * generator changes, this changes with it.
 *
 * Everything here is per-tab and lives in memory. Reload and it regenerates,
 * identically, because the generator is seeded.
 */
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from "@engine/defaults.js";
import { loadDemoInto, type DemoDb } from "@engine/demoData.js";

export interface Row {
  id: number;
  [k: string]: unknown;
}

/** Every table the app reads, keyed exactly as Prisma names its models. */
export interface DemoStore {
  account: Row[];
  category: Row[];
  merchant: Row[];
  tag: Row[];
  transaction: Row[];
  rule: Row[];
  budget: Row[];
  goal: Row[];
  asset: Row[];
  assetSnapshot: Row[];
  import: Row[];
  setting: Row[];
  savedCalculation: Row[];
  conversation: Row[];
}

const EMPTY = (): DemoStore => ({
  account: [], category: [], merchant: [], tag: [], transaction: [], rule: [],
  budget: [], goal: [], asset: [], assetSnapshot: [], import: [], setting: [],
  savedCalculation: [], conversation: [],
});

export type TableName = keyof DemoStore;

let store: DemoStore = EMPTY();
let nextId = 0;

export const db = (): DemoStore => store;

/** Autoincrement, shared across tables exactly like the fake db in the tests. */
export const newId = (): number => ++nextId;

export function insert<T extends Record<string, unknown>>(table: TableName, row: T): Row {
  const created = { id: newId(), ...row } as Row;
  store[table].push(created);
  return created;
}

export function find(table: TableName, id: number): Row | undefined {
  return store[table].find((r) => r.id === id);
}

export function remove(table: TableName, id: number): boolean {
  const i = store[table].findIndex((r) => r.id === id);
  if (i < 0) return false;
  store[table].splice(i, 1);
  return true;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * The subset of Prisma's surface `loadDemoInto` actually calls. Written out
 * rather than reached for generically, so a change in the generator's calls
 * fails here loudly instead of silently returning undefined.
 */
/**
 * Columns the Prisma schema fills with `@default(now())`. The generator relies
 * on that and never sets them, so an in-memory store has to supply them or
 * every date-formatting call downstream gets `undefined` and throws
 * "Invalid time value" — which is precisely how this was found.
 */
function withDefaults(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if (!("importedAt" in out)) delete out.importedAt;
  return {
    ...out,
    ...(row.importedAt === undefined && "filename" in row ? { importedAt: new Date() } : {}),
    ...(row.createdAt === undefined ? { createdAt: new Date() } : {}),
  };
}

function demoDbAdapter(): DemoDb {
  const model = (name: TableName) => ({
    count: async () => store[name].length,
    findMany: async () => store[name],
    create: async ({ data }: { data: Record<string, unknown> }) => insert(name, withDefaults(data)),
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
      for (const row of data) insert(name, withDefaults(row));
      return { count: data.length };
    },
    deleteMany: async () => {
      const count = store[name].length;
      store[name] = [];
      return { count };
    },
    upsert: async ({ where, create, update }: {
      where: { key?: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const found = store[name].find((r) => r.key === where.key);
      if (found) return Object.assign(found, update);
      // Settings are keyed by `key`, not by id — no autoincrement here.
      const created = { ...create } as Row;
      store[name].push(created);
      return created;
    },
  });

  return {
    account: model("account"),
    category: model("category"),
    merchant: model("merchant"),
    transaction: model("transaction"),
    budget: model("budget"),
    goal: model("goal"),
    asset: model("asset"),
    assetSnapshot: model("assetSnapshot"),
    import: model("import"),
    setting: model("setting"),
  } as unknown as DemoDb;
}

/** Categories and rules, mirroring seedDefaults() — the generator needs them
 *  to exist before it can attach transactions to them. */
function seedCategoriesAndRules(): void {
  for (const c of DEFAULT_CATEGORIES) insert("category", { ...c });
  const byName = new Map(store.category.map((c) => [c.name as string, c.id]));
  for (const [keyword, categoryName] of DEFAULT_RULES) {
    const categoryId = byName.get(categoryName);
    if (categoryId == null) continue;
    insert("rule", {
      keyword,
      categoryId,
      // Longer keywords are more specific, so they win — same rule the real
      // categorizer applies.
      priority: keyword.length,
      source: "default",
    });
  }
}

let seeded: Promise<void> | null = null;

/**
 * Build the demo world. Idempotent and cached: every handler awaits this, so
 * whichever screen loads first pays the cost and the rest are instant.
 *
 * The anchor is today, deliberately. A demo whose newest transaction is from
 * two years ago looks abandoned, and the bills projections would have nothing
 * to project.
 */
export function ready(): Promise<void> {
  if (!seeded) {
    seeded = (async () => {
      store = EMPTY();
      nextId = 0;
      seedCategoriesAndRules();
      await loadDemoInto(demoDbAdapter(), { anchor: new Date() });
    })();
  }
  return seeded;
}

/** Throw the world away and rebuild it — what the "Reset demo" button does. */
export function reset(): Promise<void> {
  seeded = null;
  return ready();
}
