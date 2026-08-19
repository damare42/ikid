/**
 * Lossless JSON export / import — the "no lock-in" guarantee, made real.
 *
 * The export is a single human-readable JSON document containing everything in
 * a profile: accounts, categories, merchants, tags, transactions, rules,
 * budgets, goals, assets and their value history, settings, saved calculations
 * and planner conversations.
 *
 * Design choices that matter:
 *
 *  - **Natural keys, not database IDs.** A transaction references its category,
 *    merchant and account *by name*. That makes the file readable, diffable,
 *    and portable into a different profile (or a rebuilt database) where the
 *    numeric IDs would be meaningless.
 *  - **Dedupe hashes are preserved**, so re-importing an export doesn't create
 *    duplicates and a later statement import still recognises what you have.
 *  - **The pure transforms are separated from the database**, so round-trip
 *    fidelity is unit-tested without needing a live SQLite file.
 *
 * Importing is treated as untrusted input: the document is validated with zod
 * before a single row is written.
 */
import { z } from "zod";

export const EXPORT_FORMAT = "ikid-export";
export const EXPORT_VERSION = 1;

// ---------- the document shape (also the validation schema) ----------

const isoDate = z.string().min(4);

const accountSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  currency: z.string().default("USD"),
});

const categorySchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  color: z.string(),
});

/**
 * Import history has no single natural key (two files can share a name), so a
 * transaction points at its import with the pair that *is* unique in practice:
 * the filename plus the exact moment it was imported. Still readable, still no
 * database IDs.
 */
const importRefSchema = z.object({ filename: z.string(), importedAt: z.string() });

const importSchema = importRefSchema.extend({
  fileType: z.string().default("csv"),
  status: z.string().default("completed"),
  transactionCount: z.number().default(0),
  duplicateCount: z.number().default(0),
  account: z.string().nullable().optional(),
});

const transactionSchema = z.object({
  date: isoDate,
  description: z.string(),
  amount: z.number(),
  balance: z.number().nullable().optional(),
  type: z.string().optional(),
  refNumber: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  hash: z.string(),
  isTransfer: z.boolean().optional(),
  category: z.string().nullable().optional(),
  merchant: z.string().nullable().optional(),
  account: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  import: importRefSchema.nullable().optional(),
});

const ruleSchema = z.object({
  keyword: z.string().min(1),
  priority: z.number().default(0),
  source: z.string().default("user"),
  category: z.string().min(1),
});

const budgetSchema = z.object({
  category: z.string().min(1),
  monthlyLimit: z.number(),
});

const goalSchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional(),
  targetAmount: z.number(),
  currentSaved: z.number().default(0),
  monthlyContribution: z.number().default(0),
  deadline: isoDate.nullable().optional(),
});

const assetSchema = z.object({
  name: z.string().min(1),
  kind: z.string(),
  isLiability: z.boolean(),
  icon: z.string().optional(),
  units: z.number().nullable().optional(),
  unitPrice: z.number().nullable().optional(),
  ratePct: z.number().nullable().optional(),
  monthlyPayment: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  snapshots: z.array(z.object({ date: isoDate, value: z.number() })).default([]),
});

const savedCalcSchema = z.object({
  kind: z.string(),
  name: z.string(),
  inputs: z.record(z.number()),
});

const conversationSchema = z.object({
  title: z.string(),
  messages: z.string(), // stored as serialized JSON
});

export const exportDocumentSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.number(),
  exportedAt: z.string(),
  appVersion: z.string().optional(),
  profile: z.string().optional(),
  counts: z.record(z.number()).optional(),
  data: z.object({
    accounts: z.array(accountSchema).default([]),
    categories: z.array(categorySchema).default([]),
    merchants: z.array(z.object({ name: z.string().min(1) })).default([]),
    tags: z.array(z.object({ name: z.string().min(1) })).default([]),
    imports: z.array(importSchema).default([]),
    transactions: z.array(transactionSchema).default([]),
    rules: z.array(ruleSchema).default([]),
    budgets: z.array(budgetSchema).default([]),
    goals: z.array(goalSchema).default([]),
    assets: z.array(assetSchema).default([]),
    settings: z.record(z.string()).default({}),
    savedCalculations: z.array(savedCalcSchema).default([]),
    conversations: z.array(conversationSchema).default([]),
  }),
});

export type ExportDocument = z.infer<typeof exportDocumentSchema>;
export type ExportData = ExportDocument["data"];

// ---------- pure transforms (unit-tested without a database) ----------

/** Raw rows as they come back from Prisma, with relations included. */
export interface RawSnapshot {
  accounts: { name: string; type: string; currency: string }[];
  categories: { name: string; type: string; color: string }[];
  merchants: { name: string }[];
  tags: { name: string }[];
  imports: {
    filename: string; fileType: string; status: string;
    transactionCount: number; duplicateCount: number; importedAt: Date;
    account: { name: string } | null;
  }[];
  transactions: {
    date: Date; description: string; amount: number; balance: number | null;
    type: string; refNumber: string | null; notes: string | null; hash: string;
    isTransfer: boolean;
    category: { name: string } | null;
    merchant: { name: string } | null;
    account: { name: string } | null;
    import: { filename: string; importedAt: Date } | null;
    tags: { name: string }[];
  }[];
  rules: { keyword: string; priority: number; source: string; category: { name: string } }[];
  budgets: { monthlyLimit: number; category: { name: string } }[];
  goals: {
    name: string; icon: string; targetAmount: number; currentSaved: number;
    monthlyContribution: number; deadline: Date | null;
  }[];
  assets: {
    name: string; kind: string; isLiability: boolean; icon: string;
    units: number | null; unitPrice: number | null; ratePct: number | null;
    monthlyPayment: number | null; notes: string | null;
    snapshots: { date: Date; value: number }[];
  }[];
  settings: { key: string; value: string }[];
  savedCalculations: { kind: string; name: string; inputs: string }[];
  conversations: { title: string; messages: string }[];
}

const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10);

/** Build the export document from raw rows. Pure — no I/O. */
export function toExportDocument(
  raw: RawSnapshot,
  meta: { profile?: string; appVersion?: string; now?: Date } = {},
): ExportDocument {
  const data: ExportData = {
    accounts: raw.accounts.map((a) => ({ name: a.name, type: a.type, currency: a.currency })),
    categories: raw.categories.map((c) => ({ name: c.name, type: c.type, color: c.color })),
    merchants: raw.merchants.map((m) => ({ name: m.name })),
    tags: raw.tags.map((t) => ({ name: t.name })),
    imports: raw.imports.map((i) => ({
      filename: i.filename,
      importedAt: new Date(i.importedAt).toISOString(),
      fileType: i.fileType,
      status: i.status,
      transactionCount: i.transactionCount,
      duplicateCount: i.duplicateCount,
      account: i.account?.name ?? null,
    })),
    transactions: raw.transactions.map((t) => ({
      date: ymd(t.date),
      description: t.description,
      amount: t.amount,
      balance: t.balance,
      type: t.type,
      refNumber: t.refNumber,
      notes: t.notes,
      hash: t.hash,
      isTransfer: t.isTransfer,
      category: t.category?.name ?? null,
      merchant: t.merchant?.name ?? null,
      account: t.account?.name ?? null,
      import: t.import
        ? { filename: t.import.filename, importedAt: new Date(t.import.importedAt).toISOString() }
        : null,
      tags: t.tags.map((x) => x.name),
    })),
    rules: raw.rules.map((r) => ({
      keyword: r.keyword, priority: r.priority, source: r.source, category: r.category.name,
    })),
    budgets: raw.budgets.map((b) => ({ category: b.category.name, monthlyLimit: b.monthlyLimit })),
    goals: raw.goals.map((g) => ({
      name: g.name, icon: g.icon, targetAmount: g.targetAmount,
      currentSaved: g.currentSaved, monthlyContribution: g.monthlyContribution,
      deadline: g.deadline ? ymd(g.deadline) : null,
    })),
    assets: raw.assets.map((a) => ({
      name: a.name, kind: a.kind, isLiability: a.isLiability, icon: a.icon,
      units: a.units, unitPrice: a.unitPrice, ratePct: a.ratePct,
      monthlyPayment: a.monthlyPayment, notes: a.notes,
      snapshots: a.snapshots.map((s) => ({ date: ymd(s.date), value: s.value })),
    })),
    settings: Object.fromEntries(raw.settings.map((s) => [s.key, s.value])),
    savedCalculations: raw.savedCalculations.map((c) => ({
      kind: c.kind, name: c.name, inputs: safeParseInputs(c.inputs),
    })),
    conversations: raw.conversations.map((c) => ({ title: c.title, messages: c.messages })),
  };

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: (meta.now ?? new Date()).toISOString(),
    appVersion: meta.appVersion,
    profile: meta.profile,
    counts: {
      accounts: data.accounts.length,
      categories: data.categories.length,
      merchants: data.merchants.length,
      tags: data.tags.length,
      imports: data.imports.length,
      transactions: data.transactions.length,
      rules: data.rules.length,
      budgets: data.budgets.length,
      goals: data.goals.length,
      assets: data.assets.length,
      savedCalculations: data.savedCalculations.length,
      conversations: data.conversations.length,
    },
    data,
  };
}

function safeParseInputs(json: string): Record<string, number> {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object") {
      return Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === "number"),
      ) as Record<string, number>;
    }
  } catch { /* corrupt row — export it as empty rather than failing the whole file */ }
  return {};
}

export class ImportFormatError extends Error {}

/**
 * Validate an untrusted document. Throws ImportFormatError with a readable
 * message rather than a zod dump.
 */
export function parseExportDocument(input: unknown): ExportDocument {
  const result = exportDocumentSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.errors[0];
    const where = first?.path.join(".") || "the file";
    throw new ImportFormatError(
      `This doesn't look like an ikid export (${where}: ${first?.message ?? "invalid"}).`,
    );
  }
  if (result.data.version > EXPORT_VERSION) {
    throw new ImportFormatError(
      `This export was made by a newer version of ikid (format v${result.data.version}; this build understands v${EXPORT_VERSION}). Update ikid and try again.`,
    );
  }
  return result.data;
}

/** Summary of what an import would (or did) write. */
export interface ImportSummary {
  accounts: number;
  categories: number;
  merchants: number;
  tags: number;
  imports: number;
  transactions: number;
  duplicateTransactions: number;
  rules: number;
  budgets: number;
  goals: number;
  assets: number;
  settings: number;
  savedCalculations: number;
  conversations: number;
}

export const emptySummary = (): ImportSummary => ({
  accounts: 0, categories: 0, merchants: 0, tags: 0, imports: 0, transactions: 0,
  duplicateTransactions: 0, rules: 0, budgets: 0, goals: 0, assets: 0,
  settings: 0, savedCalculations: 0, conversations: 0,
});

/** Stable in-file key for an import record (filename + exact import moment). */
export const importKey = (ref: { filename: string; importedAt: string }): string =>
  `${ref.importedAt} ${ref.filename}`;

/**
 * Every entity name a document references, so an import can create the
 * supporting rows even if the file's own lists are incomplete (hand-edited
 * files, or one exported from an older version).
 */
export function referencedNames(data: ExportData): {
  accounts: Set<string>; categories: Set<string>; merchants: Set<string>; tags: Set<string>;
} {
  const accounts = new Set(data.accounts.map((a) => a.name));
  const categories = new Set(data.categories.map((c) => c.name));
  const merchants = new Set(data.merchants.map((m) => m.name));
  const tags = new Set(data.tags.map((t) => t.name));

  for (const i of data.imports) if (i.account) accounts.add(i.account);
  for (const t of data.transactions) {
    if (t.account) accounts.add(t.account);
    if (t.category) categories.add(t.category);
    if (t.merchant) merchants.add(t.merchant);
    for (const tag of t.tags ?? []) tags.add(tag);
  }
  for (const r of data.rules) categories.add(r.category);
  for (const b of data.budgets) categories.add(b.category);
  return { accounts, categories, merchants, tags };
}
