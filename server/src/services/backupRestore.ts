/**
 * Database side of the JSON export/import: read everything out, and write a
 * validated document back in. The pure shape/validation logic lives in
 * exportService.ts and is unit-tested there.
 */
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import {
  emptySummary, importKey, parseExportDocument, referencedNames, toExportDocument,
  type ExportDocument, type ImportSummary, type RawSnapshot,
} from "./exportService.js";

/** Read the entire active profile into an export document. */
export async function buildExport(meta: { profile?: string; appVersion?: string } = {}): Promise<ExportDocument> {
  const [
    accounts, categories, merchants, tags, imports, transactions, rules, budgets, goals, assets,
    settings, savedCalculations, conversations,
  ] = await Promise.all([
    prisma.account.findMany({ orderBy: { name: "asc" } }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.merchant.findMany({ orderBy: { name: "asc" } }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
    prisma.import.findMany({ orderBy: { importedAt: "asc" }, include: { account: true } }),
    prisma.transaction.findMany({
      orderBy: [{ date: "asc" }, { id: "asc" }],
      include: { category: true, merchant: true, account: true, tags: true, import: true },
    }),
    prisma.rule.findMany({ orderBy: { keyword: "asc" }, include: { category: true } }),
    prisma.budget.findMany({ include: { category: true } }),
    prisma.goal.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.asset.findMany({
      orderBy: { name: "asc" },
      include: { snapshots: { orderBy: { date: "asc" } } },
    }),
    prisma.setting.findMany(),
    prisma.savedCalculation.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.conversation.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  return toExportDocument(
    {
      accounts, categories, merchants, tags, imports, transactions, rules, budgets, goals,
      assets, settings, savedCalculations, conversations,
    } as unknown as RawSnapshot,
    meta,
  );
}

export type ImportMode = "merge" | "replace";

/**
 * Write a document into the active profile.
 *
 *  - `merge` (default): add what's missing, skip transactions whose dedupe hash
 *    already exists. Safe — nothing is deleted.
 *  - `replace`: wipe the profile first. Destructive; the caller must be explicit.
 *
 * Relations are resolved by name, so a file exported from one profile imports
 * cleanly into another.
 */
export async function importExport(input: unknown, mode: ImportMode = "merge"): Promise<ImportSummary> {
  const doc = parseExportDocument(input); // throws ImportFormatError on bad input
  const { data } = doc;
  const summary = emptySummary();

  if (mode === "replace") {
    // FK-safe order.
    await prisma.transaction.deleteMany();
    await prisma.assetSnapshot.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.import.deleteMany();
    await prisma.rule.deleteMany();
    await prisma.budget.deleteMany();
    await prisma.goal.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.merchant.deleteMany();
    await prisma.category.deleteMany();
    await prisma.account.deleteMany();
    await prisma.savedCalculation.deleteMany();
    await prisma.conversation.deleteMany();
    logger.warn("Import: existing profile data replaced");
  }

  const refs = referencedNames(data);

  // --- supporting entities first, so transactions can point at them ---
  // Counts report what was *created*, not what was touched: re-importing the
  // same file should read "0 accounts", not "12 accounts".
  const accountMeta = new Map(data.accounts.map((a) => [a.name, a]));
  const accountIds = new Map<string, number>();
  for (const name of refs.accounts) {
    const found = await prisma.account.findUnique({ where: { name } });
    if (found) { accountIds.set(name, found.id); continue; }
    const meta = accountMeta.get(name);
    const row = await prisma.account.create({
      data: { name, type: meta?.type ?? "checking", currency: meta?.currency ?? "USD" },
    });
    accountIds.set(name, row.id);
    summary.accounts++;
  }

  const categoryMeta = new Map(data.categories.map((c) => [c.name, c]));
  const categoryIds = new Map<string, number>();
  for (const name of refs.categories) {
    const found = await prisma.category.findUnique({ where: { name } });
    if (found) { categoryIds.set(name, found.id); continue; }
    const meta = categoryMeta.get(name);
    const row = await prisma.category.create({
      data: { name, type: meta?.type ?? "expense", color: meta?.color ?? "#64748b" },
    });
    categoryIds.set(name, row.id);
    summary.categories++;
  }

  const merchantIds = new Map<string, number>();
  for (const name of refs.merchants) {
    const found = await prisma.merchant.findUnique({ where: { name } });
    if (found) { merchantIds.set(name, found.id); continue; }
    const row = await prisma.merchant.create({ data: { name } });
    merchantIds.set(name, row.id);
    summary.merchants++;
  }

  const tagIds = new Map<string, number>();
  for (const name of refs.tags) {
    const found = await prisma.tag.findUnique({ where: { name } });
    if (found) { tagIds.set(name, found.id); continue; }
    const row = await prisma.tag.create({ data: { name } });
    tagIds.set(name, row.id);
    summary.tags++;
  }

  // --- import history, so "Undo import" still works after a restore ---
  const importIds = new Map<string, number>();
  for (const i of data.imports) {
    const importedAt = new Date(i.importedAt);
    const found = await prisma.import.findFirst({ where: { filename: i.filename, importedAt } });
    if (found) { importIds.set(importKey(i), found.id); continue; }
    const row = await prisma.import.create({
      data: {
        filename: i.filename, fileType: i.fileType, status: i.status,
        transactionCount: i.transactionCount, duplicateCount: i.duplicateCount, importedAt,
        accountId: i.account ? accountIds.get(i.account) ?? null : null,
      },
    });
    importIds.set(importKey(i), row.id);
    summary.imports++;
  }

  // --- transactions (dedupe by hash so re-importing is idempotent) ---
  const existing = new Set(
    (await prisma.transaction.findMany({ select: { hash: true } })).map((t) => t.hash),
  );
  for (const t of data.transactions) {
    if (existing.has(t.hash)) { summary.duplicateTransactions++; continue; }
    await prisma.transaction.create({
      data: {
        date: new Date(t.date),
        description: t.description,
        amount: t.amount,
        balance: t.balance ?? null,
        type: t.type ?? (t.amount >= 0 ? "credit" : "debit"),
        refNumber: t.refNumber ?? null,
        notes: t.notes ?? null,
        hash: t.hash,
        isTransfer: t.isTransfer ?? false,
        categoryId: t.category ? categoryIds.get(t.category) ?? null : null,
        merchantId: t.merchant ? merchantIds.get(t.merchant) ?? null : null,
        accountId: t.account ? accountIds.get(t.account) ?? null : null,
        importId: t.import ? importIds.get(importKey(t.import)) ?? null : null,
        tags: { connect: (t.tags ?? []).map((n) => ({ id: tagIds.get(n)! })).filter((x) => x.id) },
      },
    });
    existing.add(t.hash);
    summary.transactions++;
  }

  // --- the rest ---
  for (const r of data.rules) {
    const categoryId = categoryIds.get(r.category);
    if (!categoryId) continue;
    await prisma.rule.upsert({
      where: { keyword_categoryId: { keyword: r.keyword, categoryId } },
      update: { priority: r.priority, source: r.source },
      create: { keyword: r.keyword, categoryId, priority: r.priority, source: r.source },
    });
    summary.rules++;
  }

  for (const b of data.budgets) {
    const categoryId = categoryIds.get(b.category);
    if (!categoryId) continue;
    await prisma.budget.upsert({
      where: { categoryId },
      update: { monthlyLimit: b.monthlyLimit },
      create: { categoryId, monthlyLimit: b.monthlyLimit },
    });
    summary.budgets++;
  }

  for (const g of data.goals) {
    const already = await prisma.goal.findFirst({ where: { name: g.name } });
    if (already) continue;
    await prisma.goal.create({
      data: {
        name: g.name, icon: g.icon ?? "🎯", targetAmount: g.targetAmount,
        currentSaved: g.currentSaved, monthlyContribution: g.monthlyContribution,
        deadline: g.deadline ? new Date(g.deadline) : null,
      },
    });
    summary.goals++;
  }

  for (const a of data.assets) {
    const already = await prisma.asset.findFirst({ where: { name: a.name } });
    if (already) continue;
    await prisma.asset.create({
      data: {
        name: a.name, kind: a.kind, isLiability: a.isLiability, icon: a.icon ?? "💰",
        units: a.units ?? null, unitPrice: a.unitPrice ?? null, ratePct: a.ratePct ?? null,
        monthlyPayment: a.monthlyPayment ?? null, notes: a.notes ?? null,
        snapshots: { create: a.snapshots.map((s) => ({ date: new Date(s.date), value: s.value })) },
      },
    });
    summary.assets++;
  }

  for (const [key, value] of Object.entries(data.settings)) {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    summary.settings++;
  }

  for (const c of data.savedCalculations) {
    const already = await prisma.savedCalculation.findFirst({ where: { name: c.name, kind: c.kind } });
    if (already) continue;
    await prisma.savedCalculation.create({
      data: { kind: c.kind, name: c.name, inputs: JSON.stringify(c.inputs) },
    });
    summary.savedCalculations++;
  }

  for (const c of data.conversations) {
    const already = await prisma.conversation.findFirst({ where: { title: c.title } });
    if (already) continue;
    await prisma.conversation.create({ data: { title: c.title, messages: c.messages } });
    summary.conversations++;
  }

  logger.info("Import complete", { mode, ...summary });
  return summary;
}
