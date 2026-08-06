import { createHash } from "node:crypto";

/**
 * Deterministic duplicate-detection hash (format v2).
 *
 * Two transactions are duplicates only when ALL of these match exactly:
 *   date · amount · normalized description · normalized merchant · account.
 *
 * Reference numbers are deliberately NOT part of the key — banks fill them
 * inconsistently (running IDs, balances, blanks), which caused both missed and
 * false duplicates. Description and merchant together define what the charge
 * is; date + amount + account define when and where. That's the identity.
 */
export const HASH_VERSION = "2";

function norm(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

export function transactionHash(input: {
  date: string; // YYYY-MM-DD
  amount: number;
  description: string;
  merchant?: string | null;
  accountId?: number | null;
}): string {
  const parts = [
    input.date,
    input.amount.toFixed(2),
    norm(input.description),
    norm(input.merchant),
    input.accountId != null ? String(input.accountId) : "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
