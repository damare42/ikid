import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AccountDTO } from "@shared/types";
import type {
  MarkClearedResultDTO, ReconcileBucket, ReconcileBucketDTO, ReconcileReportDTO, ReconcileTxnDTO,
} from "@shared/reconcile";
import { api, qs } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { fmtDate, fmtMoney, fmtSigned } from "../lib/format";
import { Card, EmptyState, ErrorNote, Spinner } from "../components/ui";

/**
 * ⚖️ Reconcile — "do my books match the bank?"
 *
 * Enter a statement's closing date and balance; the page shows the difference
 * against what ikid has on file and, more usefully, splits that difference
 * into the things that explain it (transactions not yet cleared, transactions
 * dated after the statement) and the residual that nothing explains.
 *
 * The residual is the part worth acting on: it means a transaction is missing,
 * duplicated, or has the wrong amount. Every component expands to the exact
 * transactions behind it (PRINCIPLES rule 3).
 *
 * Accessibility notes:
 *  - Cleared state is never colour alone — every marker carries a glyph and
 *    the word "Cleared"/"Uncleared".
 *  - The balanced/off banner likewise carries "✓ Reconciled" / "! Off by …".
 *  - Only colour pairs already shipped in the app are used, so the contrast
 *    suite in server/src/tests/contrast.test.ts still covers every one.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Default statement date: the last day of last month, the usual cycle end. */
function lastDayOfPreviousMonth(): string {
  const now = new Date();
  return ymd(new Date(now.getFullYear(), now.getMonth(), 0));
}

function dayAfter(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + 1));
}

interface Applied {
  accountId: number;
  statementDate: string;
  statementBalance: number;
  openingBalance: number;
}

export default function Reconcile() {
  const { data: accounts } = useFetch<AccountDTO[]>("/api/accounts");

  const [accountId, setAccountId] = useState("");
  const [statementDate, setStatementDate] = useState(lastDayOfPreviousMonth());
  const [statementBalance, setStatementBalance] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [applied, setApplied] = useState<Applied | null>(null);

  const [open, setOpen] = useState<ReconcileBucket | null>(null);
  const [rows, setRows] = useState<ReconcileTxnDTO[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ ids: number[]; cleared: boolean } | null>(null);

  const query = useMemo(
    () =>
      applied
        ? `/api/reconcile/summary${qs({
            accountId: applied.accountId,
            statementDate: applied.statementDate,
            statementBalance: applied.statementBalance,
            openingBalance: applied.openingBalance,
          })}`
        : null,
    [applied],
  );
  const { data: report, loading, error, refresh } = useFetch<ReconcileReportDTO>(query);

  const balanceValid = statementBalance.trim() !== "" && Number.isFinite(Number(statementBalance));
  const canRun = accountId !== "" && /^\d{4}-\d{2}-\d{2}$/.test(statementDate) && balanceValid;

  function run() {
    if (!canRun) return;
    setOpen(null);
    setRows([]);
    setUndo(null);
    setActionError(null);
    setApplied({
      accountId: Number(accountId),
      statementDate,
      statementBalance: Number(statementBalance),
      openingBalance: openingBalance.trim() === "" ? 0 : Number(openingBalance),
    });
  }

  async function loadBucket(bucket: ReconcileBucket) {
    if (!applied) return;
    setRowsLoading(true);
    setActionError(null);
    try {
      setRows(
        await api.get<ReconcileTxnDTO[]>(
          `/api/reconcile/transactions${qs({
            accountId: applied.accountId,
            statementDate: applied.statementDate,
            bucket,
          })}`,
        ),
      );
    } catch (e) {
      setActionError((e as Error).message);
      setRows([]);
    } finally {
      setRowsLoading(false);
    }
  }

  function toggleBucket(bucket: ReconcileBucket) {
    if (open === bucket) {
      setOpen(null);
      setRows([]);
      return;
    }
    setOpen(bucket);
    void loadBucket(bucket);
  }

  /** Every mutation goes through here so undo is always recorded. */
  async function mark(body: Record<string, unknown>, cleared: boolean) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.post<MarkClearedResultDTO>("/api/reconcile/mark", { ...body, cleared });
      // Remember exactly the rows that changed, so undo restores the previous
      // state and never touches rows that were already in the target state.
      setUndo(res.updated > 0 ? { ids: res.undoIds, cleared: !cleared } : null);
      refresh();
      if (open) await loadBucket(open);
      return res;
    } catch (e) {
      setActionError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function undoLast() {
    if (!undo) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post<MarkClearedResultDTO>("/api/reconcile/mark", {
        ids: undo.ids,
        cleared: undo.cleared,
      });
      setUndo(null);
      refresh();
      if (open) await loadBucket(open);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const accountName = accounts?.find((a) => String(a.id) === accountId)?.name;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          Reconcile
        </div>
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">Match your books to the bank</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Type in a statement's closing date and balance. ikid works out what its own records say the
          balance should be, then splits any difference into the parts that explain it — and the part
          that doesn't.
        </p>
      </div>

      <Card title="Statement">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="rec-account">Account</label>
            <select
              id="rec-account"
              className="input w-full"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Choose an account…</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="rec-date">Closing date</label>
            <input
              id="rec-date"
              type="date"
              className="input w-full"
              value={statementDate}
              onChange={(e) => setStatementDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="rec-balance">Closing balance</label>
            <input
              id="rec-balance"
              type="number"
              step="0.01"
              className="input w-full tabular-nums"
              placeholder="0.00"
              value={statementBalance}
              onChange={(e) => setStatementBalance(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="rec-opening">Opening balance</label>
            <input
              id="rec-opening"
              type="number"
              step="0.01"
              className="input w-full tabular-nums"
              placeholder="0.00"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          Balances are signed the same way transactions are: money you owe on a card is negative.
          Leave the opening balance at 0 if you imported this account's whole history — otherwise it
          is the balance just before your earliest transaction on file.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button className="btn-primary" onClick={run} disabled={!canRun}>
            Reconcile{accountName ? ` ${accountName}` : ""}
          </button>
          {!canRun && (
            <span className="text-xs text-slate-600 dark:text-slate-400">
              Pick an account and enter the closing balance.
            </span>
          )}
        </div>
      </Card>

      {error && <ErrorNote message={error} />}
      {actionError && <ErrorNote message={actionError} />}

      {!applied ? (
        <Card>
          <EmptyState
            icon="⚖️"
            title="Nothing reconciled yet"
            hint="Grab your latest statement, enter its closing date and balance above, and ikid will tell you whether its records agree — and what to look for if they don't."
          />
        </Card>
      ) : loading && !report ? (
        <Spinner />
      ) : report ? (
        <>
          <Verdict report={report} />

          {/* Undo lives at the top level, not inside a group, so collapsing
              the list you just bulk-marked can't strand you without it. */}
          {undo && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 border-l-2 border-brand-600 bg-brand-50 px-3 py-2 text-sm text-slate-900 dark:bg-brand-900/20 dark:text-slate-100"
            >
              <span>
                {undo.ids.length.toLocaleString()} transaction{undo.ids.length === 1 ? "" : "s"}{" "}
                marked {undo.cleared ? "uncleared" : "cleared"} — reversible, exactly.
              </span>
              <button className="btn-ghost !py-0.5 text-xs" onClick={undoLast} disabled={busy}>
                ↶ Undo
              </button>
              <button className="btn-ghost !py-0.5 text-xs" onClick={() => setUndo(null)} disabled={busy}>
                Dismiss
              </button>
            </div>
          )}

          <Card title="Where the difference comes from">
            <div className="overflow-x-auto">
              {/* Scrolls sideways rather than squashing. On a phone these columns are
                  wider than the screen, and a table that drags the whole page into
                  horizontal scrolling is the worse of the two failures. */}
              <table className="w-full">
                <caption className="sr-only">
                  Difference between the statement balance and the balance on file, broken into causes
                </caption>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  <Line label="Balance on file (all transactions ikid has)" value={report.bookBalance} />
                  <Line label={`Statement closing balance on ${report.statementDate}`} value={report.statementBalance} />
                  <Line label="Difference" value={report.difference} strong />
                  <BucketLine
                    bucket={report.uncleared}
                    text={`Not yet cleared, on or before ${report.statementDate}`}
                    open={open === "uncleared"}
                    onToggle={() => toggleBucket("uncleared")}
                  />
                  <BucketLine
                    bucket={report.afterStatement}
                    text={`Dated after ${report.statementDate}`}
                    open={open === "after"}
                    onToggle={() => toggleBucket("after")}
                  />
                  <Line
                    label="Unexplained residual"
                    value={report.residual}
                    strong
                    tone={report.balanced ? "good" : "bad"}
                  />
                  <BucketLine
                    bucket={report.clearedInPeriod}
                    text={`Already cleared, on or before ${report.statementDate}`}
                    open={open === "cleared"}
                    onToggle={() => toggleBucket("cleared")}
                    muted
                  />
                </tbody>
              </table>
            </div>

            <ul className="mt-3 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
              {report.explanation.map((line, i) => (
                <li key={i} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">{line}</li>
              ))}
            </ul>

            {report.suggestedOpeningBalance != null &&
              report.suggestedOpeningBalance !== report.openingBalance && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-l-2 border-amber-500 bg-amber-50 py-2 pl-3 pr-2 text-sm text-slate-800 dark:bg-amber-900/20 dark:text-slate-100">
                  <span>
                    Your earliest imported statement line implies an opening balance of{" "}
                    <strong className="tabular-nums">{fmtMoney(report.suggestedOpeningBalance)}</strong>.
                  </span>
                  <button
                    className="btn-ghost !py-0.5 text-xs"
                    onClick={() => {
                      setOpeningBalance(String(report.suggestedOpeningBalance));
                      setApplied((a) =>
                        a ? { ...a, openingBalance: report.suggestedOpeningBalance as number } : a,
                      );
                    }}
                  >
                    Use it
                  </button>
                </div>
              )}
          </Card>

          {open && (
            <Card
              title={`${bucketTitle(open)} — ${bucketFor(report, open).count.toLocaleString()} transaction${
                bucketFor(report, open).count === 1 ? "" : "s"
              }`}
              action={
                <Link
                  className="text-xs font-semibold text-brand-700 underline dark:text-brand-400"
                  to={`/transactions${qs({
                    account: report.accountId,
                    ...(open === "after"
                      ? { from: dayAfter(report.statementDate) }
                      : { to: report.statementDate }),
                  })}`}
                >
                  Open in Transactions
                </Link>
              }
            >
              {open === "uncleared" && rows.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2 bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
                  <span>
                    Statement covers everything up to <strong>{fmtDate(report.statementDate)}</strong>.
                  </span>
                  <button
                    className="btn-primary !py-1 text-xs"
                    disabled={busy}
                    onClick={() =>
                      mark(
                        { accountId: report.accountId, upToDate: report.statementDate },
                        true,
                      )
                    }
                  >
                    {busy
                      ? "Working…"
                      : `Mark all ${bucketFor(report, "uncleared").count.toLocaleString()} cleared`}
                  </button>
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    One click undoes it — only rows that actually change are touched.
                  </span>
                </div>
              )}

              {rowsLoading ? (
                <Spinner />
              ) : rows.length === 0 ? (
                <EmptyState icon="✓" title="Nothing in this group" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800">
                        <th className="th">Date</th>
                        <th className="th">Description</th>
                        <th className="th">Status</th>
                        <th className="th text-right">Amount</th>
                        <th className="th" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {rows.map((t) => (
                        <tr key={t.id}>
                          <td className="td whitespace-nowrap">{fmtDate(t.date)}</td>
                          <td className="td max-w-64 truncate" title={t.description}>
                            {t.description}
                            {t.isTransfer && (
                              <span className="ml-1.5 bg-slate-200 px-1 text-[12px] dark:bg-slate-700">
                                transfer
                              </span>
                            )}
                          </td>
                          <td className="td"><ClearedPill cleared={t.cleared} /></td>
                          <td className="td text-right tabular-nums">{fmtSigned(t.amount)}</td>
                          <td className="td text-right">
                            <button
                              className="btn-ghost !px-2 !py-0.5 text-xs"
                              disabled={busy}
                              onClick={() => mark({ ids: [t.id] }, !t.cleared)}
                            >
                              {t.cleared ? "Un-clear" : "Mark cleared"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length < bucketFor(report, open).count && (
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                      Showing the {rows.length.toLocaleString()} most recent of{" "}
                      {bucketFor(report, open).count.toLocaleString()}. The totals above cover all of
                      them.
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

/** The report's exact figures for a bucket — counts here are never truncated. */
function bucketFor(report: ReconcileReportDTO, bucket: ReconcileBucket): ReconcileBucketDTO {
  return bucket === "uncleared"
    ? report.uncleared
    : bucket === "after"
      ? report.afterStatement
      : report.clearedInPeriod;
}

function bucketTitle(bucket: ReconcileBucket): string {
  return bucket === "uncleared"
    ? "Not yet cleared"
    : bucket === "after"
      ? "Dated after the statement"
      : "Already cleared";
}

/** ✓/! plus words — the verdict never depends on colour (WCAG 1.4.1). */
function Verdict({ report }: { report: ReconcileReportDTO }) {
  return (
    <Card>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={`font-heading text-2xl font-extrabold tracking-tight ${
            report.balanced
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
          }`}
        >
          {report.balanced ? "✓ Reconciled" : `! Off by ${fmtMoney(Math.abs(report.residual))}`}
        </span>
        <span className="text-sm text-slate-600 dark:text-slate-300">
          {report.accountName} · statement dated {fmtDate(report.statementDate)}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
        {report.balanced
          ? "Every penny on the statement is accounted for by transactions ikid already has."
          : "Something on the statement isn't in ikid, or something in ikid isn't on the statement."}
      </p>
    </Card>
  );
}

function Line({ label, value, strong = false, tone, muted = false }: {
  label: string; value: number; strong?: boolean; tone?: "good" | "bad"; muted?: boolean;
}) {
  const toneCls =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "bad" ? "text-rose-600 dark:text-rose-400"
    : muted ? "text-slate-600 dark:text-slate-400"
    : "";
  return (
    <tr>
      <th scope="row" className={`td text-left font-normal ${muted ? "text-slate-600 dark:text-slate-400" : ""}`}>
        {label}
      </th>
      <td className={`td text-right tabular-nums ${strong ? "font-bold" : ""} ${toneCls}`}>
        {fmtSigned(value)}
      </td>
    </tr>
  );
}

/** A component of the difference, expandable to the transactions behind it. */
function BucketLine({ bucket, text, open, onToggle, muted = false }: {
  bucket: ReconcileBucketDTO; text: string; open: boolean; onToggle: () => void; muted?: boolean;
}) {
  return (
    <tr>
      <th scope="row" className={`td text-left font-normal ${muted ? "text-slate-600 dark:text-slate-400" : ""}`}>
        <button
          className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid disabled:no-underline"
          onClick={onToggle}
          disabled={bucket.count === 0}
          aria-expanded={open}
        >
          {text} <span className="tabular-nums">({bucket.count})</span> {bucket.count > 0 && (open ? "▾" : "▸")}
        </button>
      </th>
      <td className={`td text-right tabular-nums ${muted ? "text-slate-600 dark:text-slate-400" : ""}`}>
        {fmtSigned(bucket.total)}
      </td>
    </tr>
  );
}

/**
 * Cleared marker. Shape (✓ / ○) AND the word, so it reads correctly in
 * greyscale and for colour-blind users; the tint is only reinforcement.
 * Both pairs are ones the app already ships (see contrast.test.ts).
 */
export function ClearedPill({ cleared }: { cleared: boolean }) {
  return cleared ? (
    <span className="inline-flex items-center gap-1 whitespace-nowrap bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
      <span aria-hidden="true">✓</span> Cleared
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 whitespace-nowrap bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      <span aria-hidden="true">○</span> Uncleared
    </span>
  );
}
