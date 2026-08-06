import type { AccountStatusDTO } from "@shared/types";
import { useFetch } from "../hooks/useFetch";
import { fmtDate, fmtMoney } from "../lib/format";
import { Card, EmptyState, ErrorNote, Spinner } from "../components/ui";

/**
 * 🏦 Accounts — per card/account, when you last imported and the latest
 * transaction on file, so you know exactly where to resume the next upload.
 */

const TYPE_ICON: Record<string, string> = {
  checking: "🏦", savings: "🐷", credit: "💳", loan: "📄", none: "❓",
};

export function daysSince(ymd: string | null): number | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((midnight - then) / 86_400_000);
}

/** Human "how long ago" + a staleness tone for a latest-transaction date. */
export function freshness(ymd: string | null): { label: string; tone: "good" | "warn" | "bad" | "none" } {
  const d = daysSince(ymd);
  if (d === null) return { label: "never imported", tone: "bad" };
  if (d <= 0) return { label: "today", tone: "good" };
  if (d === 1) return { label: "yesterday", tone: "good" };
  if (d <= 21) return { label: `${d} days ago`, tone: "good" };
  if (d <= 45) return { label: `${d} days ago`, tone: "warn" };
  return { label: `${d} days ago`, tone: "bad" };
}

const TONE_CLASS: Record<string, string> = {
  good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  bad: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  none: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function openImport(accountId: number | null) {
  window.dispatchEvent(new CustomEvent("ikid:open-import", { detail: { accountId } }));
}

export default function Accounts() {
  const { data, loading, error } = useFetch<AccountStatusDTO[]>("/api/accounts/status");

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} />;

  const realAccounts = (data ?? []).filter((a) => a.id !== null);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Accounts</h1>
          <p className="text-xs text-slate-500">Where each card/account left off — so you know what to upload next.</p>
        </div>
        <button className="btn-primary" onClick={() => openImport(null)}>⬆ Import statement</button>
      </div>

      {realAccounts.length === 0 ? (
        <Card>
          <EmptyState
            icon="🏦"
            title="No accounts yet"
            hint="Add accounts in Settings, or pick one while importing a statement. Then this page tracks the latest upload per account."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(data ?? []).map((a) => {
            const f = freshness(a.latestTxnDate);
            const unassigned = a.id === null;
            return (
              <Card key={a.id ?? "unassigned"}>
                <div className="mb-2 flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{TYPE_ICON[a.type] ?? "🏦"}</span>
                    <div>
                      <div className="font-semibold">{a.name}</div>
                      <div className="text-xs capitalize text-slate-500">{unassigned ? "no account set" : a.type}</div>
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[f.tone]}`}>{f.label}</span>
                </div>

                <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Latest transaction</span>
                    <span className="font-medium tabular-nums">
                      {a.latestTxnDate ? fmtDate(a.latestTxnDate) : "—"}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-slate-500">Transactions</span>
                    <span className="tabular-nums">{a.txnCount.toLocaleString()}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-slate-500">Net on file</span>
                    <span className="tabular-nums">{fmtMoney(a.balance, { maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-slate-500">Last import</span>
                    <span className="text-xs text-slate-500" title={a.lastImportFile ?? undefined}>
                      {a.lastImportAt
                        ? `${fmtDate(a.lastImportAt)}${a.lastImportFile ? ` · ${a.lastImportFile}` : ""}`
                        : "—"}
                    </span>
                  </div>
                </div>

                {!unassigned && (
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      {a.latestTxnDate
                        ? `Next upload should start after ${fmtDate(a.latestTxnDate)}.`
                        : "No statements imported yet."}
                    </span>
                    <button className="btn-ghost !py-1 text-xs" onClick={() => openImport(a.id)}>Upload →</button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
