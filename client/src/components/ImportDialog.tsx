import { useEffect, useState } from "react";
import type { AccountDTO, AccountStatusDTO, CategoryDTO, ImportPreview, ParsedRow } from "@shared/types";
import { api } from "../lib/api";
import { fmtDate, fmtMoney } from "../lib/format";
import { freshness } from "../pages/Accounts";
import { ErrorNote, Modal, Spinner } from "./ui";

type Stage = "pick" | "parsing" | "review" | "committing" | "done";
type ReviewRow = ParsedRow & { learn?: boolean; force?: boolean };

export function ImportDialog({ onClose, onImported, initialAccountId }: {
  onClose: () => void; onImported: () => void; initialAccountId?: number | null;
}) {
  const [stage, setStage] = useState<Stage>("pick");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [status, setStatus] = useState<AccountStatusDTO[]>([]);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [accountId, setAccountId] = useState<number | "">(initialAccountId ?? "");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{ created: number; duplicates: number } | null>(null);

  useEffect(() => {
    api.get<AccountDTO[]>("/api/accounts").then(setAccounts).catch(() => {});
    api.get<AccountStatusDTO[]>("/api/accounts/status").then(setStatus).catch(() => {});
    api.get<CategoryDTO[]>("/api/categories").then(setCategories).catch(() => {});
  }, []);

  // Status for the currently-selected account (or the Unassigned bucket).
  const selectedStatus = status.find((s) => s.id === (accountId === "" ? null : accountId));

  async function handleFile(file: File) {
    setError(null);
    setStage("parsing");
    const form = new FormData();
    form.append("file", file);
    if (accountId) form.append("accountId", String(accountId));
    try {
      const p = await api.upload<ImportPreview>("/api/imports/preview", form);
      setPreview(p);
      setRows(p.rows);
      setStage("review");
    } catch (e: any) {
      setError(e.message);
      setStage("pick");
    }
  }

  async function commit() {
    if (!preview) return;
    setStage("committing");
    try {
      const res = await api.post<{ created: number; duplicates: number }>("/api/imports/commit", {
        filename: preview.filename,
        fileType: preview.fileType,
        accountId: accountId || null,
        rows: rows.map((r) => ({
          date: r.date,
          description: r.description,
          amount: r.amount,
          balance: r.balance,
          refNumber: r.refNumber,
          merchant: r.merchant,
          categoryId: r.suggestedCategoryId,
          skip: !r.valid || (r.duplicate && !r.force),
          learn: r.learn ?? false,
          force: r.force ?? false,
        })),
      });
      setResult(res);
      setStage("done");
      onImported();
    } catch (e: any) {
      setError(e.message);
      setStage("review");
    }
  }

  function updateRow(i: number, patch: Partial<ReviewRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  const importable = rows.filter((r) => r.valid && (!r.duplicate || r.force)).length;
  const dupCount = rows.filter((r) => r.duplicate).length;
  const forcedCount = rows.filter((r) => r.duplicate && r.force).length;
  const allDupForced = dupCount > 0 && forcedCount === dupCount;
  function toggleAllDuplicates() {
    const next = !allDupForced;
    setRows((rs) => rs.map((r) => (r.duplicate ? { ...r, force: next } : r)));
  }

  return (
    <Modal title="Import statement" onClose={onClose} wide={stage === "review"}>
      {error && <div className="mb-3"><ErrorNote message={error} /></div>}

      {stage === "pick" && (
        <div className="space-y-4">
          <div>
            <label className="label">Account (optional)</label>
            <select className="input w-full" value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">— No account —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {selectedStatus && selectedStatus.txnCount > 0 ? (
              <div className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
                Latest on file: <b>{selectedStatus.latestTxnDate ? fmtDate(selectedStatus.latestTxnDate) : "—"}</b>
                {" "}<span className="text-slate-400">({freshness(selectedStatus.latestTxnDate).label})</span>.
                {selectedStatus.latestTxnDate && (
                  <> Upload transactions <b>after {fmtDate(selectedStatus.latestTxnDate)}</b> — duplicates are skipped automatically.</>
                )}
                {selectedStatus.lastImportFile && (
                  <div className="mt-0.5 text-slate-400">Last import: {selectedStatus.lastImportFile}</div>
                )}
              </div>
            ) : (
              <div className="mt-1.5 text-xs text-slate-400">
                {accountId === "" ? "Tip: pick the account to see where its last upload left off." : "No transactions imported for this account yet."}
              </div>
            )}
          </div>
          <div
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
              dragOver ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20" : "border-slate-300 dark:border-slate-700"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            onClick={() => document.getElementById("import-file-input")?.click()}
          >
            <div className="text-4xl">📄</div>
            <div className="font-medium">Drop a CSV or PDF statement here</div>
            <div className="text-sm text-slate-500">or click to browse. Any bank — columns are auto-detected.</div>
            <input
              id="import-file-input"
              type="file"
              accept=".csv,.pdf"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>
        </div>
      )}

      {(stage === "parsing" || stage === "committing") && <Spinner />}

      {stage === "review" && preview && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{preview.filename}</span>
            <span className="text-slate-500">{preview.totalRows} rows parsed</span>
            {dupCount > 0 && (
              <span className="flex items-center gap-2">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  {dupCount} duplicate{dupCount === 1 ? "" : "s"}{forcedCount > 0 ? ` · ${forcedCount} kept` : " skipped"}
                </span>
                <button className="text-xs text-brand-600 hover:underline" onClick={toggleAllDuplicates}>
                  {allDupForced ? "Skip all duplicates" : "Import all anyway"}
                </button>
              </span>
            )}
            <span className="ml-auto text-slate-500">Review & correct, then import</span>
          </div>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800">
                <tr>
                  <th className="th">Date</th><th className="th">Description</th><th className="th">Merchant</th>
                  <th className="th text-right">Amount</th><th className="th">Category</th><th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r, i) => (
                  <tr key={i} className={(r.duplicate && !r.force) || !r.valid ? "opacity-50" : ""}>
                    <td className="td">
                      <input className="input !py-0.5 w-32" value={r.date} onChange={(e) => updateRow(i, { date: e.target.value })} />
                    </td>
                    <td className="td max-w-56 truncate" title={r.description}>{r.description}</td>
                    <td className="td">
                      <input className="input !py-0.5 w-36" value={r.merchant} onChange={(e) => updateRow(i, { merchant: e.target.value })} />
                    </td>
                    <td className={`td text-right tabular-nums ${r.amount < 0 ? "" : "text-emerald-600"}`}>{fmtMoney(r.amount, { maximumFractionDigits: 2 })}</td>
                    <td className="td">
                      <select
                        className="input !py-0.5"
                        value={r.suggestedCategoryId ?? ""}
                        onChange={(e) => {
                          const id = e.target.value ? Number(e.target.value) : null;
                          // Manual correction — remember it as a learned rule on commit.
                          updateRow(i, {
                            suggestedCategoryId: id,
                            suggestedCategoryName: categories.find((c) => c.id === id)?.name ?? null,
                            learn: id != null,
                          });
                        }}
                      >
                        <option value="">Unknown</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className="td text-xs">
                      {!r.valid ? (
                        <span className="text-rose-500" title={r.problems.join("; ")}>invalid</span>
                      ) : r.duplicate ? (
                        <label className="flex cursor-pointer items-center gap-1" title="Flagged as a duplicate. Tick to import it anyway (e.g. two identical charges on the same day).">
                          <input
                            type="checkbox"
                            checked={!!r.force}
                            onChange={(e) => updateRow(i, { force: e.target.checked })}
                          />
                          <span className={r.force ? "text-emerald-500" : "text-amber-500"}>
                            {r.force ? "import" : "duplicate"}
                          </span>
                        </label>
                      ) : (
                        <span className="text-emerald-500">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setStage("pick")}>Back</button>
            <button className="btn-primary" onClick={commit} disabled={importable === 0}>
              Import {importable} transactions
            </button>
          </div>
        </div>
      )}

      {stage === "done" && result && (
        <div className="space-y-4 text-center">
          <div className="text-4xl">✅</div>
          <div className="font-medium">
            Imported {result.created} transactions
            {result.duplicates > 0 && `, skipped ${result.duplicates} duplicates`}.
          </div>
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      )}
    </Modal>
  );
}
