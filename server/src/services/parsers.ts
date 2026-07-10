/**
 * Pure statement-parsing helpers: CSV column detection, date/amount parsing,
 * and generic PDF text-line extraction. No DB access — unit-testable.
 */

export interface RawRow {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // signed, negative = money out
  balance: number | null;
  type: "debit" | "credit";
  refNumber: string | null;
  problems: string[];
}

// ---------- column detection ----------

const COLUMN_SYNONYMS: Record<string, string[]> = {
  date: ["date", "transaction date", "posted date", "posting date", "trans date", "value date"],
  description: ["description", "details", "memo", "payee", "name", "transaction", "narrative"],
  amount: ["amount", "transaction amount", "amt"],
  debit: ["debit", "withdrawal", "withdrawals", "money out", "outflow", "charge"],
  credit: ["credit", "deposit", "deposits", "money in", "inflow", "payment received"],
  balance: ["balance", "running balance", "current balance", "ending balance"],
  type: ["type", "transaction type", "trans type", "dr/cr"],
  refNumber: ["reference", "reference number", "ref", "check number", "check #", "transaction id"],
};

export function detectColumns(headers: string[]): Record<string, string | null> {
  const result: Record<string, string | null> = {
    date: null, description: null, amount: null, debit: null,
    credit: null, balance: null, type: null, refNumber: null,
  };
  const normalized = headers.map((h) => h.toLowerCase().replace(/[_-]/g, " ").trim());
  for (const [field, synonyms] of Object.entries(COLUMN_SYNONYMS)) {
    // exact synonym match first, then substring
    let idx = normalized.findIndex((h) => synonyms.includes(h));
    if (idx === -1) idx = normalized.findIndex((h) => synonyms.some((s) => h.includes(s)));
    if (idx !== -1) result[field] = headers[idx];
  }
  return result;
}

// ---------- value parsing ----------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse many common date formats into YYYY-MM-DD (US-style M/D/Y for slashed dates). */
export function parseDate(raw: string, fallbackYear?: number): string | null {
  const s = raw.trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // ISO
  if (m) return fmt(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/); // M/D/Y
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return fmt(y, +m[1], +m[2]);
  }

  m = s.match(/^(\d{1,2})[/-](\d{1,2})$/); // M/D — common in PDF statements
  if (m && fallbackYear) return fmt(fallbackYear, +m[1], +m[2]);

  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})?$/); // "Jan 5, 2026"
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    const y = m[3] ? +m[3] : fallbackYear;
    if (mo && y) return fmt(y, mo, +m[2]);
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return null;

  function fmt(y: number, mo: number, day: number): string | null {
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
}

/** Parse "$1,234.56", "(45.00)", "-45.00", "45.00 CR" etc. */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return isNaN(raw) ? null : raw;
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/\bDR\b/i.test(s)) negative = true;
  const isCredit = /\bCR\b/i.test(s);
  s = s.replace(/[^0-9.\-]/g, "");
  if (!s || s === "-" || s === ".") return null;
  let n = parseFloat(s);
  if (isNaN(n)) return null;
  if (negative && n > 0) n = -n;
  if (isCredit && n < 0) n = -n;
  return n;
}

// ---------- CSV rows -> RawRow ----------

export function rowFromCsv(
  record: Record<string, any>,
  cols: Record<string, string | null>,
): RawRow {
  const problems: string[] = [];
  const date = cols.date ? parseDate(String(record[cols.date] ?? "")) : null;
  if (!date) problems.push("Could not parse date");

  const description = cols.description
    ? String(record[cols.description] ?? "").trim()
    : "";
  if (!description) problems.push("Missing description");

  let amount: number | null = null;
  if (cols.amount) {
    amount = parseAmount(record[cols.amount]);
    // If a type column says debit but amount is positive, flip sign.
    if (amount != null && cols.type) {
      const t = String(record[cols.type] ?? "").toLowerCase();
      if (/(debit|withdrawal|dr)\b/.test(t) && amount > 0) amount = -amount;
      if (/(credit|deposit|cr)\b/.test(t) && amount < 0) amount = -amount;
    }
  } else if (cols.debit || cols.credit) {
    const debit = cols.debit ? parseAmount(record[cols.debit]) : null;
    const credit = cols.credit ? parseAmount(record[cols.credit]) : null;
    if (debit != null && debit !== 0) amount = -Math.abs(debit);
    else if (credit != null && credit !== 0) amount = Math.abs(credit);
  }
  if (amount == null) problems.push("Could not parse amount");

  const balance = cols.balance ? parseAmount(record[cols.balance]) : null;
  const refNumber = cols.refNumber ? String(record[cols.refNumber] ?? "").trim() || null : null;

  return {
    date: date ?? "",
    description,
    amount: amount ?? 0,
    balance,
    type: (amount ?? 0) >= 0 ? "credit" : "debit",
    refNumber,
    problems,
  };
}

// ---------- PDF text -> RawRow[] ----------

/**
 * Generic PDF statement line parser. Looks for lines shaped like:
 *   <date> <description...> <amount> [<balance>]
 * Handles M/D, M/D/Y and "Jan 5" date styles. Statement year is inferred
 * from the document text when dates omit it.
 */
export function parsePdfText(text: string): RawRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Infer statement year from any 4-digit year in the document
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const fallbackYear = yearMatch ? +yearMatch[1] : new Date().getFullYear();

  const money = /-?\(?\$?\d{1,3}(?:,\d{3})*\.\d{2}\)?/g;
  const dateHead = /^((?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)|(?:[A-Za-z]{3}\.?\s+\d{1,2}))\s+(.*)$/;

  const rows: RawRow[] = [];
  for (const line of lines) {
    const dm = line.match(dateHead);
    if (!dm) continue;
    const date = parseDate(dm[1], fallbackYear);
    if (!date) continue;

    const rest = dm[2];
    const amounts = rest.match(money);
    if (!amounts || amounts.length === 0) continue;

    // Last money token is balance when there are 2+; the one before it is amount.
    const amountStr = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
    const balanceStr = amounts.length >= 2 ? amounts[amounts.length - 1] : null;
    const amount = parseAmount(amountStr);
    if (amount == null) continue;

    const description = rest
      .slice(0, rest.lastIndexOf(amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0]))
      .trim()
      .replace(/\s{2,}/g, " ");
    if (!description) continue;

    rows.push({
      date,
      description,
      amount,
      balance: balanceStr ? parseAmount(balanceStr) : null,
      type: amount >= 0 ? "credit" : "debit",
      refNumber: null,
      problems: [],
    });
  }
  return rows;
}
