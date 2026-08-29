import type { ReactNode } from "react";

export function Card({ title, action, children, className = "" }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={`card ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h3 className="font-heading text-[15px] font-bold tracking-tight text-slate-800 dark:text-slate-100">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, tone = "default" }: {
  label: string; value: string; sub?: string; tone?: "default" | "good" | "bad";
}) {
  const toneCls =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "bad" ? "text-brand-600 dark:text-brand-400"
    : "text-slate-900 dark:text-slate-100";
  return (
    <div className="card min-w-0">
      {/* Two lines are reserved whether the label needs them or not. Otherwise
          "Savings Rate" wraps while "Income" doesn't, and the numbers in a row
          of cards sit at different heights. */}
      <div className="min-h-[2rem] text-[12px] font-semibold uppercase leading-4 tracking-[0.14em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      {/* Fluid rather than a fixed text-3xl: with seven cards across, a card is
          about 155px, and a value like "+$1,057.95" simply didn't fit and was
          clipped mid-digit. Shrinking is the right failure — a number that is
          slightly smaller is readable, half a number is not. nowrap keeps it
          from breaking between the sign and the digits. */}
      <div
        className={`mt-1.5 whitespace-nowrap font-heading font-extrabold leading-tight tracking-tight tabular-nums ${toneCls}`}
        style={{ fontSize: "clamp(1.25rem, 1.6vw + 0.5rem, 1.875rem)" }}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}

export function ProgressBar({ pct, color }: { pct: number; color?: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const barColor = color ?? (pct > 100 ? "#a4123a" : pct > 85 ? "#9a6a10" : "#1a7f5a");
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
      <div className="h-full rounded-full transition-all" style={{ width: `${clamped}%`, backgroundColor: barColor }} />
    </div>
  );
}

export function Badge({ children, color = "#64748b" }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: color + "22", color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

export function Modal({ title, onClose, children, wide = false }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-12" onClick={onClose}>
      <div
        className={`card w-full ${wide ? "max-w-5xl" : "max-w-lg"} shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="btn-ghost !px-2" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center p-8">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <div className="text-4xl">{icon}</div>
      <div className="font-medium">{title}</div>
      {hint && <div className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  // Modernist error device: 2px accent left rule on a tinted panel, square.
  return (
    <div role="alert" className="border-l-2 border-brand-600 bg-brand-50 py-3 pl-6 pr-3 text-sm text-brand-800 dark:bg-brand-900/20 dark:text-brand-200">
      {message}
    </div>
  );
}
