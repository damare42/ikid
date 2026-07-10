import { createHash } from "node:crypto";

/**
 * Deterministic duplicate-detection hash.
 * Two transactions are duplicates when date + amount + normalized description
 * (+ reference number and account, when present) all match.
 */
export function transactionHash(input: {
  date: string; // YYYY-MM-DD
  amount: number;
  description: string;
  refNumber?: string | null;
  accountId?: number | null;
}): string {
  const desc = input.description.toUpperCase().replace(/\s+/g, " ").trim();
  const parts = [
    input.date,
    input.amount.toFixed(2),
    desc,
    input.refNumber ?? "",
    input.accountId != null ? String(input.accountId) : "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
