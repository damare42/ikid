import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { BillDTO, BillsSummary } from "@shared/bills";
import { useFetch } from "../hooks/useFetch";
import { fmtDate, fmtMoney } from "../lib/format";
import { Card, EmptyState, ErrorNote, Spinner, StatCard } from "../components/ui";

/*
 * Bills & renewal calendar.
 *
 * Colour rules followed here (client/tailwind.config.js + the contrast tests):
 *  - Only token classes, no hex.
 *  - Every pair used is at or above WCAG AA 4.5:1. Two near-misses are
 *    deliberately avoided: `text-slate-500` on a `slate-100` surface (4.25) and
 *    `text-amber-600` on `slate-50` (4.49). Muted text on a tinted panel uses
 *    slate-600 / dark:slate-300; muted text on a white card uses slate-500 /
 *    dark:slate-400.
 *  - Status is never colour alone: every badge carries a glyph and a word, and
 *    the row repeats the meaning in prose.
 *  - Where the date is uncertain the UI says "±N days" rather than printing a
 *    date that looks exact.
 */

const HORIZONS = [30, 60, 90] as const;
type Horizon = (typeof HORIZONS)[number];

const CADENCE_LABEL: Record<BillDTO["cadence"], string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Twice a year",
  annual: "Yearly",
  irregular: "Irregular",
};

const STATUS: Record<BillDTO["status"], { glyph: string; label: string; cls: string }> = {
  active: {
    glyph: "●",
    label: "On track",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  late: {
    glyph: "▲",
    label: "Overdue",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  stopped: {
    glyph: "■",
    label: "Stopped",
    cls: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
};

const CONFIDENCE_NOTE: Record<BillDTO["confidence"], string> = {
  high: "This merchant has kept to the same date for several cycles.",
  medium: "The date moves a little between cycles — treat it as approximate.",
  low: "The date moves a lot between cycles. Ikid is showing its best guess, not a promise.",
};

function StatusBadge({ status }: { status: BillDTO["status"] }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold ${s.cls}`}
    >
      <span aria-hidden="true">{s.glyph}</span>
      {s.label}
    </span>
  );
}

/** "Jul 12" or "around Jul 12 (±3 days)" — never a bare date we can't stand behind. */
function whenLabel(date: string, windowDays: number): string {
  const d = fmtDate(date);
  if (windowDays <= 0) return d;
  return `around ${d} (±${windowDays} day${windowDays === 1 ? "" : "s"})`;
}

export default function Bills() {
  // Horizon lives in the URL so Back returns to the exact view (same pattern
  // as the Analytics tabs).
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get("horizon"));
  const horizon: Horizon = (HORIZONS as readonly number[]).includes(raw) ? (raw as Horizon) : 30;
  const { data, loading, error } = useFetch<BillsSummary>(`/api/bills?horizon=${horizon}`);

  function setHorizon(h: Horizon) {
    const next = new URLSearchParams(params);
    next.set("horizon", String(h));
    setParams(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">Bills</h1>
        <div
          className="flex gap-1 rounded-lg bg-slate-200 p-1 dark:bg-slate-800"
          role="group"
          aria-label="Projection horizon"
        >
          {HORIZONS.map((h) => (
            <button
              key={h}
              aria-pressed={horizon === h}
              className={`rounded-md px-3 py-1 text-sm ${
                horizon === h
                  ? "bg-white font-bold shadow dark:bg-slate-700 dark:text-slate-100"
                  : "font-medium text-slate-600 dark:text-slate-300"
              }`}
              onClick={() => setHorizon(h)}
            >
              {h} days
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <Spinner />}
      {error && <ErrorNote message={error} />}
      {data && <BillsBody data={data} horizon={horizon} />}
    </div>
  );
}

function BillsBody({ data, horizon }: { data: BillsSummary; horizon: Horizon }) {
  const navigate = useNavigate();

  /** Rule 3: every figure reaches the transactions behind it. */
  function openTransactions(bill: BillDTO) {
    if (bill.merchantId == null) return;
    navigate(`/transactions?merchantId=${bill.merchantId}`, { state: { back: true } });
  }

  const timeline = useMemo(() => {
    const rows = data.bills.flatMap((b) => b.upcoming.map((o) => ({ bill: b, occ: o })));
    rows.sort((a, b) => a.occ.date.localeCompare(b.occ.date));
    let running = 0;
    return rows.map((r) => {
      running = Math.round((running + r.occ.amount) * 100) / 100;
      return { ...r, running };
    });
  }, [data.bills]);

  const priceMoves = useMemo(
    () =>
      [...data.bills, ...data.stopped]
        .flatMap((b) => b.priceChanges.map((c) => ({ bill: b, change: c })))
        .sort((a, b) => b.change.date.localeCompare(a.change.date))
        .slice(0, 8),
    [data.bills, data.stopped],
  );

  const hasAnything = data.bills.length > 0 || data.stopped.length > 0;

  return (
    <div className="space-y-4">
      {data.dataStale && (
        <div
          role="status"
          className="border-l-2 border-amber-600 bg-amber-50 py-3 pl-6 pr-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
        >
          <strong className="font-semibold">Your data stops on{" "}
            {data.observedThrough ? fmtDate(data.observedThrough) : "an unknown date"}.</strong>{" "}
          Everything below the timeline is measured against that date, not today — otherwise a gap
          in your imports would look exactly like a pile of cancelled subscriptions. Import a recent
          statement to make these verdicts trustworthy.
        </div>
      )}

      {!hasAnything ? (
        <Card>
          <EmptyState
            icon="🗓️"
            title="No repeating charges found yet"
            hint="Ikid needs at least three charges from the same merchant before it will call something a bill — two charges can't tell a subscription from a coincidence. Import a few more months of statements and this fills in."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label={`Next ${horizon} days`}
              value={fmtMoney(data.horizonTotal)}
              sub={`${timeline.length} charge${timeline.length === 1 ? "" : "s"} across ${data.bills.length} bill${data.bills.length === 1 ? "" : "s"}`}
            />
            <StatCard
              label="Average surplus"
              value={data.surplusForHorizon != null ? fmtMoney(data.surplusForHorizon) : "—"}
              sub={
                data.surplusMonths > 0
                  ? `income − expenses, ${horizon} days at ${fmtMoney(data.avgMonthlySurplus)}/mo`
                  : "no complete month of income yet"
              }
              tone={
                data.surplusForHorizon != null && data.surplusForHorizon < 0 ? "bad" : "default"
              }
            />
            <StatCard
              label="Share of surplus"
              value={data.pctOfSurplus != null ? `${data.pctOfSurplus}%` : "—"}
              sub={
                data.pctOfSurplus == null
                  ? "needs income history to mean anything"
                  : data.pctOfSurplus > 100
                    ? "these bills exceed what you usually keep"
                    : "of what you usually have left over"
              }
              tone={data.pctOfSurplus != null && data.pctOfSurplus > 100 ? "bad" : "default"}
            />
            <StatCard
              label="Committed / month"
              value={fmtMoney(data.monthlyCommitted)}
              sub="every live bill, normalised to a month"
            />
          </div>

          <SurplusNote data={data} horizon={horizon} />

          <Card
            title={`Upcoming — ${fmtDate(data.from)} to ${fmtDate(data.to)}`}
            action={
              data.overdueTotal > 0 ? (
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  ▲ {fmtMoney(data.overdueTotal)} overdue, included
                </span>
              ) : undefined
            }
          >
            {timeline.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Nothing is expected in the next {horizon} days. Try a longer horizon — annual and
                quarterly bills often sit outside a 30-day window.
              </div>
            ) : (
              <ol className="space-y-0">
                {timeline.map(({ bill, occ, running }, i) => {
                  const newDay = i === 0 || timeline[i - 1].occ.date !== occ.date;
                  return (
                    <li
                      key={`${bill.merchant}-${occ.date}`}
                      className="border-l-2 border-slate-200 pl-4 dark:border-slate-700"
                    >
                      {newDay && (
                        <div className="pt-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                          {fmtDate(occ.date)}
                          {occ.windowDays > 0 && ` · ±${occ.windowDays}d`}
                          {occ.overdue && " · expected, not seen"}
                        </div>
                      )}
                      <button
                        className="flex w-full items-center justify-between gap-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => openTransactions(bill)}
                        title={`See the ${bill.chargeCount} transactions behind this`}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {occ.overdue && <span aria-hidden="true">▲ </span>}
                          {bill.merchant}
                          <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                            {CADENCE_LABEL[bill.cadence]}
                            {bill.variableAmount && " · amount varies"}
                          </span>
                        </span>
                        <span className="whitespace-nowrap text-sm font-semibold tabular-nums">
                          {bill.variableAmount && "~"}
                          {fmtMoney(occ.amount)}
                        </span>
                        <span className="hidden w-24 whitespace-nowrap text-right text-xs tabular-nums text-slate-500 sm:inline dark:text-slate-400">
                          {fmtMoney(running)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Right-hand column is the running total. Every row is a projection from past charges,
              not a confirmed debit — click one to see the transactions it came from.
            </div>
          </Card>

          {priceMoves.length > 0 && (
            <Card title="Price changes">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="th">Merchant</th>
                    <th className="th">Changed</th>
                    <th className="th text-right">Was</th>
                    <th className="th text-right">Now</th>
                    <th className="th text-right">Difference</th>
                    <th className="th">Confirmed by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {priceMoves.map(({ bill, change }) => {
                    const up = change.to > change.from;
                    return (
                      <tr key={`${bill.merchant}-${change.date}`}>
                        <td className="td font-medium">
                          <button
                            className="text-left hover:underline"
                            onClick={() => openTransactions(bill)}
                          >
                            {bill.merchant}
                          </button>
                        </td>
                        <td className="td whitespace-nowrap">{fmtDate(change.date)}</td>
                        <td className="td text-right tabular-nums">{fmtMoney(change.from)}</td>
                        <td className="td text-right tabular-nums">{fmtMoney(change.to)}</td>
                        <td
                          className={`td whitespace-nowrap text-right font-semibold tabular-nums ${
                            up
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          <span aria-hidden="true">{up ? "▲" : "▼"}</span>{" "}
                          {up ? "+" : ""}
                          {fmtMoney(change.to - change.from, { maximumFractionDigits: 2 })} (
                          {change.deltaPct > 0 ? "+" : ""}
                          {change.deltaPct}%)
                        </td>
                        <td className="td text-xs text-slate-500 dark:text-slate-400">
                          {change.chargesAtNewPrice === 1
                            ? "1 charge — not repeated yet"
                            : `${change.chargesAtNewPrice} charges`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                A change is only counted when the amount moves by more than 2% or 25¢, whichever is
                larger — below that it is rounding, not repricing. One-off purchases from a merchant
                you also subscribe to are ignored rather than reported as a change and back again.
              </div>
            </Card>
          )}

          {data.bills.length > 0 && (
            <Card title="All bills">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="th">Merchant</th>
                    <th className="th">Cadence</th>
                    <th className="th text-right">Expected</th>
                    <th className="th">Next</th>
                    <th className="th">Status</th>
                    <th className="th text-right">Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.bills.map((b) => (
                    <tr key={b.merchant}>
                      <td className="td font-medium">
                        <button
                          className="text-left hover:underline"
                          onClick={() => openTransactions(b)}
                          title={CONFIDENCE_NOTE[b.confidence]}
                        >
                          {b.merchant}
                        </button>
                        {b.confidence !== "high" && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {b.confidence === "low" ? "date is a guess" : "date moves a little"}
                          </div>
                        )}
                      </td>
                      <td className="td whitespace-nowrap">{CADENCE_LABEL[b.cadence]}</td>
                      <td className="td text-right tabular-nums">
                        {b.variableAmount && "~"}
                        {fmtMoney(b.expectedAmount)}
                        {b.variableAmount && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {fmtMoney(b.amountRange.min)}–{fmtMoney(b.amountRange.max)}
                          </div>
                        )}
                      </td>
                      <td className="td whitespace-nowrap text-sm">
                        {b.upcoming[0]
                          ? whenLabel(b.upcoming[0].date, b.upcoming[0].windowDays)
                          : `not within ${horizon} days`}
                      </td>
                      <td className="td">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="td text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {b.chargeCount}× since {fmtDate(b.firstDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.bills.some((b) => b.status === "late") && (
                <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
                  <span aria-hidden="true">▲</span> Overdue means the charge was expected and hasn&apos;t
                  appeared. That could be a slow merchant, a failed payment, or a cancellation —
                  bank data alone cannot tell those apart.
                </div>
              )}
            </Card>
          )}

          {data.stopped.length > 0 && (
            <Card title={`Stopped charging — ${data.stopped.length}`}>
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
                These merchants have missed two or more expected charges. Ikid can tell you they
                stopped; it <strong className="font-semibold">cannot</strong> tell you whether you
                cancelled, the payment failed, or your card expired — all three look identical in a
                statement. None of them are counted in the totals above.
              </p>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.stopped.map((b) => (
                  <li key={b.merchant} className="py-2">
                    <button
                      className="flex w-full flex-wrap items-center gap-2 text-left hover:underline"
                      onClick={() => openTransactions(b)}
                    >
                      <StatusBadge status="stopped" />
                      <span className="font-medium">{b.merchant}</span>
                      <span className="text-sm tabular-nums">{fmtMoney(b.expectedAmount)}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {CADENCE_LABEL[b.cadence]} · last charged {fmtDate(b.lastDate)} (
                        {b.daysSinceLast} days ago)
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                If one of these was a cancellation, you are saving{" "}
                {fmtMoney(
                  Math.round(data.stopped.reduce((s, b) => s + b.monthlyEquivalent, 0) * 100) / 100,
                )}{" "}
                a month. If it was a failed payment, you may be about to lose the service.
              </div>
            </Card>
          )}

          {data.belowFloorMerchants.length > 0 && (
            <Card title="Seen twice, not enough to call">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {data.belowFloorMerchants.join(", ")}
                {data.belowFloorMerchants.length === 1 ? " has" : " have"} charged exactly twice. Two
                charges give one gap, which cannot be told apart from coincidence, so
                {data.belowFloorMerchants.length === 1 ? " it is" : " they are"} not projected. A
                third charge is enough.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** The sentence that gives the headline number its meaning. */
function SurplusNote({ data, horizon }: { data: BillsSummary; horizon: Horizon }) {
  if (data.horizonTotal <= 0) return null;

  let body: string;
  if (data.surplusForHorizon == null || data.surplusMonths === 0) {
    body =
      "Ikid can't set this against your income yet — it needs at least one complete month of " +
      "income and spending to work out what you usually have left over.";
  } else if (data.surplusForHorizon <= 0) {
    body =
      `Over the last ${data.surplusMonths} complete months you spent more than you earned ` +
      `(${fmtMoney(data.avgMonthlySurplus)} a month on average), so there is no surplus for these ` +
      `bills to come out of. They are being funded from savings or credit.`;
  } else {
    body =
      `That is ${data.pctOfSurplus}% of the ${fmtMoney(data.surplusForHorizon)} you would normally ` +
      `have left over across ${horizon} days, based on the last ${data.surplusMonths} complete ` +
      `months (${fmtMoney(data.avgMonthlySurplus)} a month).`;
  }

  return (
    <Card>
      <p className="text-sm text-slate-700 dark:text-slate-200">
        <strong className="font-semibold">
          {fmtMoney(data.horizonTotal)} of repeating charges over the next {horizon} days.
        </strong>{" "}
        {body}
      </p>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Surplus is income minus expenses, with transfers between your own accounts and investment
        contributions excluded — the same definition the Analytics page uses. Complete months only;
        a part-month always looks like a surplus.
      </p>
    </Card>
  );
}
