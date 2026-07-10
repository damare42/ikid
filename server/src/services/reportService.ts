import { transactionRepo } from "../repositories/index.js";
import type { TransactionQuery } from "../../../shared/types.js";

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export filtered transactions as CSV text. */
export async function transactionsCsv(q: TransactionQuery): Promise<string> {
  const all = await transactionRepo.list({ ...q, page: 1, pageSize: 100000 });
  const header = ["Date", "Description", "Merchant", "Category", "Account", "Amount", "Type", "Transfer", "Notes", "Tags"];
  const lines = [header.join(",")];
  for (const t of all.items) {
    lines.push(
      [
        t.date.toISOString().slice(0, 10),
        csvEscape(t.description),
        csvEscape(t.merchant?.name ?? ""),
        csvEscape(t.category?.name ?? ""),
        csvEscape(t.account?.name ?? ""),
        t.amount.toFixed(2),
        t.type,
        t.isTransfer ? "yes" : "no",
        csvEscape(t.notes ?? ""),
        csvEscape(t.tags.map((x: any) => x.name).join("; ")),
      ].join(","),
    );
  }
  return lines.join("\n");
}
