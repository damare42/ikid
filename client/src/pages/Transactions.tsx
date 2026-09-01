import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { AccountDTO, CategoryDTO, MerchantDTO, Paginated, TransactionDTO } from "@shared/types";
import { api, qs } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { fmtDate, fmtSigned } from "../lib/format";
import { Badge, Card, EmptyState, ErrorNote, Modal } from "../components/ui";

export default function Transactions() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const cameFromDrillDown = Boolean((location.state as any)?.back);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [categoryId, setCategoryId] = useState(params.get("categoryId") ?? "");
  const [merchantId, setMerchantId] = useState(params.get("merchantId") ?? "");
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [accountFilter, setAccountFilter] = useState(params.get("account") ?? "");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TransactionDTO | null>(null);
  const [adding, setAdding] = useState(false);
  // Opens automatically when a filter arrives from a URL — a chart drilling
  // into a category shouldn't leave the reason for the filtered list hidden.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Bulk account assignment
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [bulkAccount, setBulkAccount] = useState("");
  const [assigning, setAssigning] = useState(false);

  // Keep filters in sync when navigating here from a chart click or top-bar search.
  useEffect(() => {
    setSearch(params.get("search") ?? "");
    if (params.get("categoryId") !== null) setCategoryId(params.get("categoryId") ?? "");
    if (params.get("merchantId") !== null) setMerchantId(params.get("merchantId") ?? "");
    if (params.get("from") !== null) setFrom(params.get("from") ?? "");
    if (params.get("to") !== null) setTo(params.get("to") ?? "");
  }, [params]);
  useEffect(() => setPage(1), [search, categoryId, merchantId, accountFilter, from, to, minAmount, maxAmount]);
  // Clear any selection whenever the visible set changes.
  useEffect(() => { setSelected(new Set()); setSelectAllMatching(false); },
    [search, categoryId, merchantId, accountFilter, from, to, minAmount, maxAmount, page, sortBy, sortDir]);

  const accountParams =
    accountFilter === "none" ? { unassigned: "true" }
    : accountFilter ? { accountId: accountFilter }
    : {};

  const query = useMemo(
    () =>
      qs({
        search, categoryId, merchantId, ...accountParams, from, to,
        minAmount, maxAmount, sortBy, sortDir, page,
        // 50 rows is a lot of scrolling before the pager, and on a phone it is
        // several screens of near-identical lines. 25 fits a laptop viewport
        // and keeps the pager somewhere you'll actually meet it.
        pageSize: 25,
      }),
    [search, categoryId, merchantId, accountFilter, from, to, minAmount, maxAmount, sortBy, sortDir, page],
  );

  const { data, loading, error, refresh } = useFetch<Paginated<TransactionDTO>>(`/api/transactions${query}`);
  const { data: categories } = useFetch<CategoryDTO[]>("/api/categories");
  const { data: merchants } = useFetch<(MerchantDTO & { _count: { transactions: number } })[]>("/api/merchants");
  const { data: accounts } = useFetch<AccountDTO[]>("/api/accounts");

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  /** The filter the server should use for "assign all matching". */
  function filterObject() {
    return {
      ...(search ? { search } : {}),
      ...(categoryId ? { categoryId: Number(categoryId) } : {}),
      ...(merchantId ? { merchantId: Number(merchantId) } : {}),
      ...(accountFilter === "none" ? { unassigned: true } : accountFilter ? { accountId: Number(accountFilter) } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(minAmount ? { minAmount: Number(minAmount) } : {}),
      ...(maxAmount ? { maxAmount: Number(maxAmount) } : {}),
    };
  }

  const pageIds = data?.items.map((t) => t.id) ?? [];
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  function togglePage() {
    setSelectAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function toggleRow(id: number) {
    setSelectAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectionCount = selectAllMatching ? (data?.total ?? 0) : selected.size;

  async function applyAssign() {
    if (!bulkAccount) return;
    setAssigning(true);
    const accountId = bulkAccount === "none" ? null : Number(bulkAccount);
    try {
      await api.post<{ updated: number }>("/api/transactions/assign-account",
        selectAllMatching
          ? { accountId, filter: filterObject() }
          : { accountId, ids: [...selected] });
      setSelected(new Set());
      setSelectAllMatching(false);
      setBulkAccount("");
      refresh();
    } finally {
      setAssigning(false);
    }
  }

  function toggleSort(col: "date" | "amount") {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("desc"); }
  }

  const filtersActive = Boolean(
    search || categoryId || merchantId || accountFilter || from || to || minAmount || maxAmount,
  );

  function clearFilters() {
    setCategoryId(""); setMerchantId(""); setAccountFilter("");
    setFrom(""); setTo(""); setMinAmount(""); setMaxAmount("");
  }

  /**
   * One chip per filter that is actually doing something, labelled with the
   * value rather than the field — "Groceries", not "Category: Groceries".
   *
   * This is what makes hiding the controls safe. A filter you can't see and
   * can't remember setting is how people conclude their data has vanished; a
   * filter that names itself above the results, and clears on a tap, is just
   * tidy.
   */
  const activeChips: { label: string; clear: () => void }[] = [
    categoryId && {
      label: categories?.find((c) => String(c.id) === categoryId)?.name ?? "Category",
      clear: () => setCategoryId(""),
    },
    merchantId && {
      label: merchants?.find((m) => String(m.id) === merchantId)?.name ?? "Merchant",
      clear: () => setMerchantId(""),
    },
    accountFilter && {
      label: accountFilter === "none"
        ? "Unassigned"
        : accounts?.find((a) => String(a.id) === accountFilter)?.name ?? "Account",
      clear: () => setAccountFilter(""),
    },
    from && { label: `From ${from}`, clear: () => setFrom("") },
    to && { label: `To ${to}`, clear: () => setTo("") },
    minAmount && { label: `Min $${minAmount}`, clear: () => setMinAmount("") },
    maxAmount && { label: `Max $${maxAmount}`, clear: () => setMaxAmount("") },
  ].filter(Boolean) as { label: string; clear: () => void }[];

  const filterCount = activeChips.length;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div className="flex items-center gap-2">
          {cameFromDrillDown && (
            <button
              className="btn-ghost !px-2"
              onClick={() => navigate(-1)}
              title="Back to where you were"
            >
              ←
            </button>
          )}
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {data ? `${data.total.toLocaleString()} transaction${data.total === 1 ? "" : "s"} on file` : "Transactions"}
            </div>
            <h1 className="font-heading text-2xl font-extrabold tracking-tight">Transactions</h1>
          </div>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>+ Add transaction</button>
      </div>

      {/* Search stays out; the other seven live behind the funnel.
          They were all on screen at once, which on a phone meant a 362px block
          of controls — 45% of the viewport — before a single transaction. The
          honest split is that searching is what people come here to do, and the
          rest is refinement they reach for occasionally. Anything currently
          applied is shown as a removable chip, so nothing is hidden while it is
          actually affecting the list. */}
      <Card className="!p-3">
        <div className="flex items-center gap-2">
          <input
            className="input min-w-0 flex-1"
            placeholder="Search transactions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search transactions"
          />
          <button
            className={`btn-ghost shrink-0 gap-1.5 ${filterCount > 0 ? "!border-brand-600 !text-brand-700 dark:!text-brand-400" : ""}`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            aria-label={filtersOpen ? "Hide filters" : "Show filters"}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span className="hidden sm:inline">Filter</span>
            {filterCount > 0 && (
              <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-bold leading-[16px] text-white">
                {filterCount}
              </span>
            )}
          </button>
        </div>

        {activeChips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activeChips.map((chip) => (
              <button
                key={chip.label}
                onClick={chip.clear}
                className="inline-flex items-center gap-1 rounded-chrome bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                title={`Remove: ${chip.label}`}
              >
                {chip.label}
                <span aria-hidden="true" className="text-slate-500">✕</span>
              </button>
            ))}
            <button className="px-1 text-xs text-brand-700 hover:underline dark:text-brand-400" onClick={clearFilters}>
              Clear all
            </button>
          </div>
        )}

        {filtersOpen && (
          <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-200 pt-3 sm:grid-cols-2 lg:grid-cols-3 dark:border-slate-800">
            <label className="block">
              <span className="label">Category</span>
              <select className="input w-full" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">All categories</option>
                {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Merchant</span>
              <select className="input w-full" value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
                <option value="">All merchants</option>
                {merchants?.filter((m) => m._count.transactions > 0).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Account</span>
              <select className="input w-full" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
                <option value="">All accounts</option>
                <option value="none">⚠ Unassigned</option>
                {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">From</span>
              <input type="date" className="input w-full" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">To</span>
              <input type="date" className="input w-full" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="label">Min $</span>
                <input type="number" className="input w-full" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
              </label>
              <label className="block">
                <span className="label">Max $</span>
                <input type="number" className="input w-full" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
              </label>
            </div>
          </div>
        )}
      </Card>

      {error && <ErrorNote message={error} />}
      {loading && !data ? (
        <Card><TableSkeleton /></Card>
      ) : data && data.total === 0 ? (
        <Card>
          <EmptyState
            icon="🧾"
            title={filtersActive ? "No transactions match these filters" : "No transactions yet"}
            hint={filtersActive
              ? "Try clearing a filter or widening the date range."
              : "Import a bank statement (⬆ Import) or add one manually to get started."}
          />
        </Card>
      ) : (
        <Card>
          {/* Bulk account-assignment bar */}
          {selectionCount > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm dark:bg-brand-900/20">
              <span className="font-medium">{selectionCount} selected</span>
              {!selectAllMatching && data && data.total > selected.size && (
                <button className="text-xs text-brand-600 hover:underline" onClick={() => setSelectAllMatching(true)}>
                  Select all {data.total} matching
                </button>
              )}
              <span className="ml-auto flex items-center gap-2">
                <span className="text-slate-500">Assign to</span>
                <select className="input !py-1" value={bulkAccount} onChange={(e) => setBulkAccount(e.target.value)}>
                  <option value="">Choose account…</option>
                  {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  <option value="none">— Unassign —</option>
                </select>
                <button className="btn-primary !py-1 text-xs" disabled={!bulkAccount || assigning} onClick={applyAssign}>
                  {assigning ? "Assigning…" : "Apply"}
                </button>
                <button className="btn-ghost !py-1 text-xs" onClick={() => { setSelected(new Set()); setSelectAllMatching(false); }}>
                  Clear
                </button>
              </span>
            </div>
          ) : (
            <div className="mb-2 text-sm text-slate-500">
              {data?.total ?? 0} transactions
              {accountFilter === "none" && (data?.total ?? 0) > 0 && (
                <span className="ml-2 text-xs text-amber-600">— tick rows to assign them to an account</span>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="th w-8">
                    <input type="checkbox" checked={allPageSelected} onChange={togglePage} title="Select all on this page" />
                  </th>
                  <th className="th cursor-pointer select-none" onClick={() => toggleSort("date")}>
                    Date {sortBy === "date" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="th">Description</th>
                  <th className="th">Merchant</th>
                  <th className="th">Account</th>
                  <th className="th">Category</th>
                  <th className="th cursor-pointer select-none text-right" onClick={() => toggleSort("amount")}>
                    Amount {sortBy === "amount" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data?.items.map((t) => (
                  <tr key={t.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${selected.has(t.id) ? "bg-brand-50/60 dark:bg-brand-900/10" : ""}`}>
                    <td className="td">
                      <input type="checkbox" checked={selectAllMatching || selected.has(t.id)} onChange={() => toggleRow(t.id)} />
                    </td>
                    <td className="td whitespace-nowrap">{fmtDate(t.date)}</td>
                    <td className="td max-w-64 truncate" title={t.description}>
                      {t.description}
                      {t.isTransfer && <span className="ml-1.5 rounded bg-slate-200 px-1 text-[12px] dark:bg-slate-700">transfer</span>}
                      {/* Inline rather than its own column — reconciliation
                          state is context on a row, not a thing you scan a
                          whole column of. Glyph plus word, never colour alone. */}
                      {t.cleared && <span className="ml-1.5 whitespace-nowrap text-[12px] text-emerald-700 dark:text-emerald-300" title="Confirmed against a bank statement">✓ cleared</span>}
                    </td>
                    <td className="td whitespace-nowrap">{t.merchant?.name ?? "—"}</td>
                    <td className="td whitespace-nowrap text-xs">
                      {t.account
                        ? <span className="text-slate-600 dark:text-slate-300">{t.account.name}</span>
                        : <span className="text-amber-500">unassigned</span>}
                    </td>
                    <td className="td">{t.category && <Badge color={t.category.color}>{t.category.name}</Badge>}</td>
                    <td className={`td text-right tabular-nums ${t.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{fmtSigned(t.amount)}</td>
                    <td className="td">
                      <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => setEditing(t)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
            <span className="text-slate-500">Page {page} of {pages}</span>
            <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        </Card>
      )}

      {adding && categories && (
        <AddDialog
          categories={categories}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); refresh(); }}
        />
      )}

      {editing && categories && (
        <EditDialog
          txn={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

/** Loading placeholder for the table — pulsing rows (aria-busy). */
function TableSkeleton() {
  return (
    <div aria-busy="true" className="animate-pulse">
      <div className="mb-3 h-4 w-40 bg-slate-200 dark:bg-slate-800" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-t border-slate-100 py-3 dark:border-slate-800">
          <div className="h-3 w-4 bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 w-20 bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 flex-1 bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 w-24 bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 w-16 bg-slate-200 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

function AddDialog({ categories, onClose, onSaved }: {
  categories: CategoryDTO[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<"income" | "expense">("income");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [accountId, setAccountId] = useState<number | "">("");
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [notes, setNotes] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [repeatMonths, setRepeatMonths] = useState("5");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<AccountDTO[]>("/api/accounts").then(setAccounts).catch(() => {});
  }, []);

  /** Same day-of-month, i months earlier (day clamped to shorter months). */
  function shiftMonths(iso: string, i: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    const first = new Date(y, m - 1 - i, 1);
    const day = Math.min(d, new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate());
    return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Default the category to Salary for income entries.
  useEffect(() => {
    const fallback = kind === "income" ? categories.find((c) => c.name === "Salary") : undefined;
    setCategoryId(fallback?.id ?? "");
  }, [kind, categories]);

  const shownCategories = categories.filter((c) =>
    kind === "income" ? c.type === "income" : c.type !== "income",
  );

  async function save() {
    setSaving(true);
    setError(null);
    const abs = Math.abs(Number(amount));
    const extra = repeat ? Math.min(Math.max(Number(repeatMonths) || 0, 0), 36) : 0;
    const dates = Array.from({ length: extra + 1 }, (_, i) => shiftMonths(date, i));
    try {
      for (const d of dates) {
        await api.post("/api/transactions", {
          date: d,
          description: description.trim(),
          amount: kind === "income" ? abs : -abs,
          categoryId: categoryId === "" ? null : categoryId,
          accountId: accountId === "" ? null : accountId,
          notes: notes.trim() || null,
        });
      }
      onSaved();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="Add transaction" onClose={onClose}>
      <div className="space-y-3">
        {error && <ErrorNote message={error} />}
        <div className="flex gap-1 rounded-lg bg-slate-200 p-1 dark:bg-slate-800">
          {(["income", "expense"] as const).map((k) => (
            <button
              key={k}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm capitalize ${kind === k ? "bg-white font-medium shadow dark:bg-slate-700" : "text-slate-500"}`}
              onClick={() => setKind(k)}
            >
              {k === "income" ? "💵 Income" : "💸 Expense"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input w-full" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Amount ($)</label>
            <input type="number" min="0" step="0.01" className="input w-full" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <input
            className="input w-full"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={kind === "income" ? "Freelance payment, rent from tenant…" : "Cash purchase, reimbursement…"}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Category</label>
            <select className="input w-full" value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Auto-detect</option>
              {shownCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Account</label>
            <select className="input w-full" value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">— None —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Notes (optional)</label>
          <input className="input w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            Repeat for previous months
          </label>
          {repeat && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span>Also add the last</span>
              <input
                type="number"
                min="1"
                max="36"
                className="input w-20"
                value={repeatMonths}
                onChange={(e) => setRepeatMonths(e.target.value)}
              />
              <span>months</span>
            </div>
          )}
          {repeat && Number(repeatMonths) > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Adds {Number(repeatMonths) + 1} entries total — same amount on the same day each month, ending {date}. Great for backfilling a monthly salary.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={save}
            disabled={saving || !description.trim() || !Number(amount)}
          >
            {saving
              ? "Saving…"
              : repeat && Number(repeatMonths) > 0
                ? `Add ${Number(repeatMonths) + 1} entries`
                : `Add ${kind}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditDialog({ txn, categories, onClose, onSaved }: {
  txn: TransactionDTO;
  categories: CategoryDTO[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [categoryId, setCategoryId] = useState<number | "">(txn.category?.id ?? "");
  const [accountId, setAccountId] = useState<number | "">(txn.account?.id ?? "");
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [merchant, setMerchant] = useState(txn.merchant?.name ?? "");
  const [notes, setNotes] = useState(txn.notes ?? "");
  const [tags, setTags] = useState(txn.tags.map((t) => t.name).join(", "));
  const [isTransfer, setIsTransfer] = useState(txn.isTransfer);
  const [learn, setLearn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<AccountDTO[]>("/api/accounts").then(setAccounts).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/transactions/${txn.id}`, {
        categoryId: categoryId === "" ? null : categoryId,
        accountId: accountId === "" ? null : accountId,
        merchant: merchant.trim() || undefined,
        notes: notes.trim() || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        isTransfer,
        learn: learn && categoryId !== "" && categoryId !== txn.category?.id,
      });
      onSaved();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit transaction" onClose={onClose}>
      <div className="space-y-3">
        {error && <ErrorNote message={error} />}
        <div className="rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800">
          <div className="font-medium">{txn.description}</div>
          <div className="text-slate-500">{fmtDate(txn.date)} · {fmtSigned(txn.amount)}</div>
        </div>
        <div>
          <label className="label">Category</label>
          <select className="input w-full" value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">— None —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Account</label>
          <select className="input w-full" value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">— Unassigned —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Merchant</label>
          <input className="input w-full" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div>
          <label className="label">Tags (comma-separated)</label>
          <input className="input w-full" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vacation, reimbursable" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isTransfer} onChange={(e) => setIsTransfer(e.target.checked)} />
          This is a transfer (exclude from income/spending)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} />
          Learn: apply this category to future imports from this merchant
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}
