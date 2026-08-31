/**
 * Demo-mode UI.
 *
 *  - `DemoBanner`   — a persistent, unmissable strip shown on every screen
 *                     while a demo profile is active. Mount it in the shell.
 *  - `DemoModeCard` — the Settings entry point: load, reset, and an honest
 *                     explanation of where the data goes.
 *  - `useDemoStatus` — shared fetch, in case anything else needs to know.
 *
 * Two rules shape the styling:
 *  1. State is never signalled by colour alone (WCAG 1.4.1). The banner says
 *     the words "DEMO DATA" in a chip, plus a sentence of plain English. Strip
 *     every colour out and it still reads correctly.
 *  2. Only existing Tailwind tokens, no hex. The pairs used here were measured
 *     against WCAG AA (4.5:1) and are pinned by assertions in
 *     server/src/tests/demo-data.test.ts:
 *       light  amber-800 on amber-50   7.67:1   heading
 *              slate-700 on amber-50   7.17:1   body
 *              white     on amber-800  8.25:1   chip
 *              amber-600 on amber-50   4.39:1   2px rule (non-text, needs 3:1)
 *       dark   amber-300 on slate-900  8.13:1   heading
 *              slate-300 on slate-900 11.19:1   body
 *              slate-950 on amber-300  8.93:1   chip
 */
import { useState } from "react";
import type { DemoLoadResultDTO, DemoStatusDTO } from "@shared/demo";
import { api } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import { Card, ErrorNote, Spinner } from "./ui";

export function useDemoStatus() {
  return useFetch<DemoStatusDTO>("/api/demo/status");
}

/** The chip that carries the actual word. Reused by the banner and the card. */
function DemoChip({ children = "DEMO DATA" }: { children?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-chrome bg-amber-800 px-2 py-0.5 text-[12px] font-extrabold uppercase tracking-[0.14em] text-white dark:bg-amber-300 dark:text-slate-950">
      {children}
    </span>
  );
}

/**
 * Shown on every screen while the active profile holds generated data.
 * Renders nothing at all in a normal profile, so the cost of demo mode to a
 * real user is exactly zero pixels.
 */
export default function DemoBanner() {
  const { data, refresh } = useDemoStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data?.isDemo) return null;

  async function reset() {
    if (!confirm("Regenerate the demo data from its seed? Anything you changed in this profile will be replaced.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<DemoLoadResultDTO>("/api/demo/reset");
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      refresh();
    }
  }

  return (
    <div className="no-print border-l-2 border-amber-600 bg-amber-50 px-4 py-2 dark:border-amber-300 dark:bg-slate-900">
      <div
        role="status"
        className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-2 gap-y-1"
      >
        <DemoChip />
        {/* One line, always. The full paragraph moved behind the ⓘ: the banner
            has to be on every screen, and a five-line block of explanation
            repeated on every screen stops being read and starts being scrolled
            past — on a phone it was consuming the entire first viewport.
            What survives here is the only sentence that must land. */}
        <span className="min-w-0 flex-1 text-[13px] font-bold text-amber-800 dark:text-amber-300">
          None of these numbers are real.
        </span>
        <DetailToggle profile={data.profile} range={data.range} />
        <button className="btn-ghost shrink-0 !py-1 text-xs" onClick={reset} disabled={busy}>
          {busy ? "Regenerating…" : "↺ Reset"}
        </button>
      </div>
      {error && (
        <div className="mx-auto mt-2 w-full max-w-[1200px]">
          <ErrorNote message={error} />
        </div>
      )}
    </div>
  );
}

/**
 * The ⓘ that holds the rest of the explanation.
 *
 * Hover alone would have been wrong. A phone has no hover, and the phone is
 * where the space was being wasted — so the detail would have become
 * unreachable on exactly the device the change was made for. This opens on
 * hover *and* on click/tap, and closes on Escape and on blur, which is also
 * what WCAG 1.4.13 asks of content shown on hover: dismissible, hoverable,
 * persistent.
 *
 * It expands inline underneath rather than floating in a positioned tooltip.
 * A popover anchored to an icon near the right edge of a 375px screen has to
 * be measured and flipped to avoid running off; a block that takes the banner's
 * full width cannot go wrong, and this text is a paragraph, not a label.
 */
function DetailToggle({ profile, range }: {
  profile: string; range?: { from: string; to: string } | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="shrink-0 rounded-full border border-amber-800/40 px-[7px] text-[12px] font-bold leading-[18px] text-amber-800 hover:bg-amber-800 hover:text-white dark:border-amber-300/40 dark:text-amber-300 dark:hover:bg-amber-300 dark:hover:text-slate-950"
        aria-expanded={open}
        aria-label={open ? "Hide demo details" : "What is demo data?"}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
      >
        i
      </button>
      {open && (
        <p className="basis-full text-[13px] text-slate-700 dark:text-slate-300">
          You are in the <b>{profile}</b> profile, filled with invented accounts and made-up
          merchants generated on this machine
          {range && <> covering {range.from} to {range.to}</>}
          . Your own data is in a separate database file and is untouched.
        </p>
      )}
    </>
  );
}

/**
 * Settings entry point. Also usable from an empty-state ("nothing here yet —
 * want to look around with sample data?").
 */
export function DemoModeCard({ onMessage }: { onMessage?: (m: string) => void } = {}) {
  const { data, loading, error, refresh } = useDemoStatus();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function load() {
    if (!data) return;
    // With accounts enabled the server refuses to switch profiles at all, so
    // the only available destination is this profile — which the server will
    // still refuse unless it is empty.
    const target = data.authEnabled ? "current" : "demo";
    if (
      !confirm(
        target === "demo"
          ? 'Create (or refresh) the separate "demo" profile and switch to it? Your own data stays where it is.'
          : "Fill this profile with generated demo data? This only works while the profile is empty.",
      )
    )
      return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.post<DemoLoadResultDTO>("/api/demo/load", { target });
      onMessage?.(`${r.note} (${r.counts.transactions.toLocaleString()} transactions, seed ${r.seed}.)`);
      // The active profile changed, so reload rather than trying to invalidate
      // every cached page — this is what the profile switcher already does.
      window.location.reload();
    } catch (e) {
      setFailure((e as Error).message);
      setBusy(false);
      refresh();
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  return (
    <Card title="Demo mode">
      {failure && (
        <div className="mb-3">
          <ErrorNote message={failure} />
        </div>
      )}

      {data.isDemo ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <DemoChip>Active</DemoChip>
          <span className="text-slate-700 dark:text-slate-300">
            This profile holds generated data (seed <b>{data.seed}</b>
            {data.generatedAt && <>, made {data.generatedAt.slice(0, 10)}</>}). Use the banner at the
            top of the page to regenerate it.
          </span>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Fill a profile with {" "}
            <b>two years of invented transactions</b> — fake banks, fake merchants, fake salary — so
            every screen has something to show before you import a real statement. It is generated
            locally from a fixed seed, so it is the same every time.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-400">
            <li>
              {data.authEnabled ? (
                <>Goes into this profile, and only while it is completely empty.</>
              ) : (
                <>
                  Goes into a separate <b>demo</b> profile with its own database file — your data is
                  never written over.
                </>
              )}
            </li>
            <li>Delete it any time by switching profiles; reset it from the demo banner.</li>
          </ul>

          {!data.canLoadHere && data.authEnabled && (
            <p className="mt-3 border-l-2 border-amber-600 bg-amber-50 py-2 pl-4 pr-3 text-sm text-slate-700 dark:border-amber-300 dark:bg-slate-800 dark:text-slate-300">
              <b className="text-amber-800 dark:text-amber-300">Not available here.</b>{" "}
              {data.blockedReason}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn-primary"
              onClick={load}
              disabled={busy || (data.authEnabled && !data.canLoadHere)}
            >
              {busy ? "Generating…" : "Explore with demo data"}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
