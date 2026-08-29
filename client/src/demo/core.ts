/**
 * Core read/write endpoints: transactions, the reference tables behind them,
 * budgets, goals and settings.
 *
 * Writes really write. Editing a category, ticking a transaction cleared or
 * adding a goal all mutate the in-memory store and are visible everywhere
 * afterwards — a demo where the buttons don't do anything teaches the visitor
 * that the app doesn't do anything.
 */
import type {
  BudgetStatusDTO, CategoryDTO, GoalDTO, Paginated, TransactionDTO, TransactionQuery,
} from "@shared/types";
import { computeGoal } from "@engine/goalMath.js";
import { DemoHttpError, bool, num, route, str } from "./router.js";
import { db, find, insert, remove } from "./store.js";
import {
  accountDTO, allTxns, asDate, categoryDTO, isExpense, latestDate, merchantDTO,
  queryTxns, round2, sumAmount, txnDTO, ymd,
} from "./data.js";

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

route("GET /api/transactions", ({ query }) => {
  const q: TransactionQuery = {
    search: str(query, "search"),
    categoryId: num(query, "categoryId"),
    merchantId: num(query, "merchantId"),
    accountId: num(query, "accountId"),
    unassigned: bool(query, "unassigned"),
    cleared: bool(query, "cleared"),
    from: str(query, "from"),
    to: str(query, "to"),
    minAmount: num(query, "minAmount"),
    maxAmount: num(query, "maxAmount"),
    sortBy: str(query, "sortBy") as TransactionQuery["sortBy"],
    sortDir: str(query, "sortDir") as TransactionQuery["sortDir"],
    page: num(query, "page"),
    pageSize: num(query, "pageSize"),
  };
  const { items, total } = queryTxns(q);
  const res: Paginated<TransactionDTO> = {
    items: items.map(txnDTO),
    total,
    page: q.page ?? 1,
    pageSize: q.pageSize ?? 50,
  };
  return res;
});

route("PATCH /api/transactions/:id", ({ params, body }) => {
  const t = find("transaction", Number(params.id));
  if (!t) throw new DemoHttpError(404, "Transaction not found");
  const b = (body ?? {}) as Record<string, unknown>;
  for (const k of ["categoryId", "merchantId", "accountId", "notes", "isTransfer", "cleared", "description"]) {
    if (k in b) t[k] = b[k];
  }
  return txnDTO(t);
});

route("POST /api/transactions", ({ body }) => {
  const b = (body ?? {}) as Record<string, unknown>;
  const amount = Number(b.amount ?? 0);
  const created = insert("transaction", {
    date: new Date(String(b.date ?? ymd(new Date()))),
    description: String(b.description ?? "Manual entry"),
    amount,
    balance: null,
    type: amount >= 0 ? "credit" : "debit",
    refNumber: null,
    notes: (b.notes as string) ?? null,
    hash: `demo-manual-${Date.now()}-${Math.random()}`,
    isTransfer: Boolean(b.isTransfer),
    cleared: false,
    categoryId: b.categoryId ?? null,
    merchantId: b.merchantId ?? null,
    accountId: b.accountId ?? null,
    importId: null,
  });
  return txnDTO(created);
});

route("DELETE /api/transactions/:id", ({ params }) => {
  remove("transaction", Number(params.id));
  return { ok: true };
});

route("POST /api/transactions/assign-account", ({ body }) => {
  const b = (body ?? {}) as { ids?: number[]; accountId?: number | null; filter?: TransactionQuery };
  const targets = b.ids
    ? allTxns().filter((t) => b.ids!.includes(t.id))
    : queryTxns({ ...(b.filter ?? {}), page: 1, pageSize: Number.MAX_SAFE_INTEGER }).items;
  for (const t of targets) t.accountId = b.accountId ?? null;
  return { updated: targets.length };
});

route("POST /api/transactions/recategorize", () => ({ scanned: allTxns().length, updated: 0 }));
route("POST /api/transactions/detect-transfers", () => ({
  scanned: allTxns().length,
  flagged: allTxns().filter((t) => t.isTransfer).length,
}));

// ---------------------------------------------------------------------------
// Reference tables
// ---------------------------------------------------------------------------

route("GET /api/categories", () =>
  db().category.map((c) => categoryDTO(c.id)).filter(Boolean) as CategoryDTO[]);

route("POST /api/categories", ({ body }) => {
  const b = (body ?? {}) as Record<string, unknown>;
  return categoryDTO(insert("category", {
    name: String(b.name ?? "New category"),
    type: b.type ?? "expense",
    color: b.color ?? "#645f5f",
  }).id);
});

route("PATCH /api/categories/:id", ({ params, body }) => {
  const c = find("category", Number(params.id));
  if (!c) throw new DemoHttpError(404, "Category not found");
  Object.assign(c, body ?? {});
  return categoryDTO(c.id);
});

route("DELETE /api/categories/:id", ({ params }) => {
  const id = Number(params.id);
  for (const t of allTxns()) if (t.categoryId === id) t.categoryId = null;
  remove("category", id);
  return { ok: true };
});

route("GET /api/merchants", () =>
  db().merchant.map((m) => ({
    id: m.id,
    name: m.name as string,
    _count: { transactions: allTxns().filter((t) => t.merchantId === m.id).length },
  })));

route("PATCH /api/merchants/:id", ({ params, body }) => {
  const m = find("merchant", Number(params.id));
  if (!m) throw new DemoHttpError(404, "Merchant not found");
  m.name = String((body as { name?: string })?.name ?? m.name);
  return merchantDTO(m.id);
});

route("POST /api/merchants/merge", ({ body }) => {
  const b = (body ?? {}) as { ids?: number[]; name?: string };
  const ids = b.ids ?? [];
  if (ids.length < 2) throw new DemoHttpError(400, "Pick at least two merchants to merge");
  const targetId = ids[0];
  const target = find("merchant", targetId);
  if (target && b.name) target.name = b.name;
  for (const t of allTxns()) if (ids.includes(t.merchantId as number)) t.merchantId = targetId;
  for (const id of ids.slice(1)) remove("merchant", id);
  return { ok: true, targetId };
});

route("POST /api/merchants/normalize", () => ({ groups: 0, merchantsTouched: 0 }));

route("GET /api/accounts", () => {
  const totals = new Map<number, number>();
  for (const t of allTxns()) {
    if (t.accountId == null) continue;
    totals.set(t.accountId as number, (totals.get(t.accountId as number) ?? 0) + (t.amount as number));
  }
  return db().account.map((a) => ({ ...accountDTO(a.id)!, balance: round2(totals.get(a.id) ?? 0) }));
});

route("POST /api/accounts", ({ body }) => {
  const b = (body ?? {}) as Record<string, unknown>;
  return accountDTO(insert("account", {
    name: String(b.name ?? "New account"),
    type: b.type ?? "checking",
    currency: "USD",
  }).id);
});

route("GET /api/accounts/status", () => {
  const buckets: Record<string, unknown>[] = [];
  const imports = db().import;
  for (const a of db().account) {
    const rows = allTxns().filter((t) => t.accountId === a.id);
    const dates = rows.map((t) => ymd(t.date)).sort();
    const lastImport = imports
      .filter((i) => i.accountId === a.id)
      .sort((x, y) => asDate(y.importedAt).getTime() - asDate(x.importedAt).getTime())[0];
    buckets.push({
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency ?? "USD",
      txnCount: rows.length,
      balance: sumAmount(rows),
      latestTxnDate: dates.at(-1) ?? null,
      earliestTxnDate: dates[0] ?? null,
      lastImportAt: lastImport ? asDate(lastImport.importedAt).toISOString() : null,
      lastImportFile: (lastImport?.filename as string) ?? null,
    });
  }
  return buckets;
});

route("GET /api/tags", () => []);

route("GET /api/rules", () =>
  db().rule.map((r) => ({
    id: r.id,
    keyword: r.keyword,
    priority: r.priority,
    source: r.source,
    categoryId: r.categoryId,
    categoryName: categoryDTO(r.categoryId)?.name,
  })));

route("POST /api/rules", ({ body }) => {
  const b = (body ?? {}) as { keyword?: string; categoryId?: number };
  const created = insert("rule", {
    keyword: String(b.keyword ?? "").toUpperCase(),
    categoryId: b.categoryId,
    priority: String(b.keyword ?? "").length,
    source: "user",
  });
  return { ...created, categoryName: categoryDTO(created.categoryId)?.name };
});

route("DELETE /api/rules/:id", ({ params }) => {
  remove("rule", Number(params.id));
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

route("GET /api/budgets", ({ query }) => {
  const now = latestDate();
  const year = num(query, "year") ?? now.getFullYear();
  const month = num(query, "month") ?? now.getMonth() + 1;
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

  // Pro-rate the forecast by how far through the month we are — but only when
  // this *is* the running month, otherwise a finished month would be scaled up.
  const real = new Date();
  const isCurrent = real.getFullYear() === year && real.getMonth() + 1 === month;
  const daysElapsed = isCurrent ? Math.max(1, real.getDate()) : daysInMonth;

  const out: BudgetStatusDTO[] = [];
  for (const b of db().budget) {
    const cat = categoryDTO(b.categoryId);
    if (!cat) continue;
    const spent = round2(
      -allTxns()
        .filter((t) => t.categoryId === b.categoryId && isExpense(t) && ymd(t.date) >= from && ymd(t.date) <= to)
        .reduce((s, t) => s + (t.amount as number), 0),
    );
    const limit = b.monthlyLimit as number;
    out.push({
      id: b.id,
      categoryId: b.categoryId as number,
      categoryName: cat.name,
      categoryColor: cat.color,
      monthlyLimit: limit,
      spent,
      remaining: round2(limit - spent),
      pctUsed: limit > 0 ? Math.round((spent / limit) * 100) : 0,
      overBudget: spent > limit,
      forecast: round2((spent / daysElapsed) * daysInMonth),
    });
  }
  return out.sort((a, b) => b.pctUsed - a.pctUsed);
});

route("PUT /api/budgets", ({ body }) => {
  const b = (body ?? {}) as { categoryId?: number; monthlyLimit?: number };
  const existing = db().budget.find((r) => r.categoryId === b.categoryId);
  if (existing) {
    existing.monthlyLimit = b.monthlyLimit;
    return existing;
  }
  return insert("budget", { categoryId: b.categoryId, monthlyLimit: b.monthlyLimit });
});

route("DELETE /api/budgets/:id", ({ params }) => {
  remove("budget", Number(params.id));
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

function goalDTO(g: Record<string, unknown>): GoalDTO {
  const computed = computeGoal({
    targetAmount: g.targetAmount as number,
    currentSaved: g.currentSaved as number,
    monthlyContribution: g.monthlyContribution as number,
    deadline: g.deadline ? new Date(String(g.deadline)) : null,
  });
  return {
    id: g.id as number,
    name: g.name as string,
    icon: (g.icon as string) ?? "🎯",
    targetAmount: g.targetAmount as number,
    currentSaved: g.currentSaved as number,
    monthlyContribution: g.monthlyContribution as number,
    deadline: g.deadline ? ymd(g.deadline) : null,
    ...computed,
  };
}

route("GET /api/goals", () => db().goal.map(goalDTO));

route("POST /api/goals", ({ body }) => {
  const b = (body ?? {}) as Record<string, unknown>;
  return goalDTO(insert("goal", {
    name: String(b.name ?? "New goal"),
    icon: b.icon ?? "🎯",
    targetAmount: Number(b.targetAmount ?? 0),
    currentSaved: Number(b.currentSaved ?? 0),
    monthlyContribution: Number(b.monthlyContribution ?? 0),
    deadline: b.deadline ? new Date(String(b.deadline)) : null,
  }));
});

route("PATCH /api/goals/:id", ({ params, body }) => {
  const g = find("goal", Number(params.id));
  if (!g) throw new DemoHttpError(404, "Goal not found");
  const b = (body ?? {}) as Record<string, unknown>;
  if ("deadline" in b) g.deadline = b.deadline ? new Date(String(b.deadline)) : null;
  for (const k of ["name", "icon", "targetAmount", "currentSaved", "monthlyContribution"]) {
    if (k in b) g[k] = b[k];
  }
  return goalDTO(g);
});

route("DELETE /api/goals/:id", ({ params }) => {
  remove("goal", Number(params.id));
  return { ok: true };
});

route("POST /api/goals/what-if", ({ body }) => {
  const b = (body ?? {}) as Record<string, unknown>;
  return computeGoal({
    targetAmount: Number(b.targetAmount ?? 0),
    currentSaved: Number(b.currentSaved ?? 0),
    monthlyContribution: Number(b.monthlyContribution ?? 0),
    deadline: b.deadline ? new Date(String(b.deadline)) : null,
  });
});

// ---------------------------------------------------------------------------
// Settings + imports
// ---------------------------------------------------------------------------

route("GET /api/settings", () => {
  const get = (k: string) => db().setting.find((s) => s.key === k)?.value as string | undefined;
  return {
    currency: get("currency") ?? "USD",
    dateFormat: get("dateFormat") ?? "MM/DD/YYYY",
    theme: get("theme") ?? "system",
  };
});

route("PATCH /api/settings", ({ body }) => {
  const b = (body ?? {}) as Record<string, string>;
  for (const [key, value] of Object.entries(b)) {
    const found = db().setting.find((s) => s.key === key);
    if (found) found.value = value;
    else db().setting.push({ id: 0, key, value });
  }
  return b;
});

route("GET /api/imports", () =>
  db().import
    .map((i) => ({
      id: i.id,
      filename: i.filename,
      fileType: i.fileType ?? "csv",
      status: i.status ?? "completed",
      transactionCount: i.transactionCount ?? 0,
      duplicateCount: i.duplicateCount ?? 0,
      importedAt: asDate(i.importedAt).toISOString(),
      accountId: i.accountId ?? null,
    }))
    .sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt))));

route("PATCH /api/imports/:id", ({ params, body }) => {
  const i = find("import", Number(params.id));
  if (!i) throw new DemoHttpError(404, "Import not found");
  i.filename = String((body as { filename?: string })?.filename ?? i.filename);
  return i;
});

route("POST /api/imports/:id/assign-account", ({ params, body }) => {
  const id = Number(params.id);
  const accountId = (body as { accountId?: number | null })?.accountId ?? null;
  const i = find("import", id);
  if (i) i.accountId = accountId;
  let updated = 0;
  for (const t of allTxns()) {
    if (t.importId === id) { t.accountId = accountId; updated++; }
  }
  return { updated };
});

route("DELETE /api/imports/:id", ({ params }) => {
  const id = Number(params.id);
  const store = db();
  store.transaction = store.transaction.filter((t) => t.importId !== id);
  remove("import", id);
  return { ok: true };
});
