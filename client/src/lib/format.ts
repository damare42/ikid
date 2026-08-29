let currency = "USD";
export function setCurrency(c: string) {
  currency = c || "USD";
}

export function fmtMoney(n: number, opts: Intl.NumberFormatOptions = {}): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
    ...opts,
  });
}

/**
 * Signed, always to the cent. For ledgers and reconciliation, where a single
 * cent is frequently the thing being looked for.
 */
export function fmtSigned(n: number): string {
  return (n > 0 ? "+" : "") + fmtMoney(n, { maximumFractionDigits: 2 });
}

/**
 * Signed, but following fmtMoney's magnitude rule — cents only below $1,000.
 *
 * For headline figures sitting next to other headline figures. On the
 * dashboard, Income and Spending round at four digits while Net Savings was
 * forcing cents, so one card read "+$1,057.95" beside "$3,387": visually
 * inconsistent, and two characters too wide for the card, which clipped it.
 */
export function fmtSignedCompact(n: number): string {
  return (n > 0 ? "+" : "") + fmtMoney(n);
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

export function monthInputValue(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
