import { describe, expect, it } from "vitest";
import {
  buildAccountStatus, type AccountInfo, type ImportInfo, type TxnAgg,
} from "../services/accountStatusService.js";

const accounts: AccountInfo[] = [
  { id: 1, name: "Amex Gold", type: "credit", currency: "USD" },
  { id: 2, name: "Chase Checking", type: "checking", currency: "USD" },
  { id: 3, name: "New Card", type: "credit", currency: "USD" },
];

describe("buildAccountStatus", () => {
  it("reports latest/earliest date, count and balance per account", () => {
    const aggs: TxnAgg[] = [
      { accountId: 1, count: 40, sum: -1234.5, minDate: new Date("2026-01-03"), maxDate: new Date("2026-07-12") },
      { accountId: 2, count: 120, sum: 5820.25, minDate: new Date("2025-11-01"), maxDate: new Date("2026-07-28") },
    ];
    const imports: ImportInfo[] = [
      { accountId: 1, importedAt: new Date("2026-07-13T10:00:00Z"), filename: "amex-july.csv" },
      { accountId: 1, importedAt: new Date("2026-06-14T10:00:00Z"), filename: "amex-june.csv" },
      { accountId: 2, importedAt: new Date("2026-07-29T09:00:00Z"), filename: "chase-july.pdf" },
    ];
    const rows = buildAccountStatus(accounts, aggs, imports);
    const amex = rows.find((r) => r.id === 1)!;
    expect(amex.latestTxnDate).toBe("2026-07-12");
    expect(amex.earliestTxnDate).toBe("2026-01-03");
    expect(amex.txnCount).toBe(40);
    expect(amex.balance).toBe(-1234.5);
    // most-recent import wins
    expect(amex.lastImportFile).toBe("amex-july.csv");
  });

  it("puts never-imported accounts first (they need attention)", () => {
    const aggs: TxnAgg[] = [
      { accountId: 1, count: 40, sum: -100, minDate: new Date("2026-01-01"), maxDate: new Date("2026-07-12") },
      { accountId: 2, count: 10, sum: 50, minDate: new Date("2026-05-01"), maxDate: new Date("2026-05-20") },
    ];
    const rows = buildAccountStatus(accounts, aggs, []);
    // account 3 has no transactions → latestTxnDate null → sorts first
    expect(rows[0].id).toBe(3);
    expect(rows[0].latestTxnDate).toBeNull();
    // then oldest latest-date (account 2 @ May) before account 1 @ July
    expect(rows[1].id).toBe(2);
    expect(rows[2].id).toBe(1);
  });

  it("adds an Unassigned bucket only when such transactions exist, always last", () => {
    const aggs: TxnAgg[] = [
      { accountId: 1, count: 5, sum: -10, minDate: new Date("2026-02-01"), maxDate: new Date("2026-02-10") },
      { accountId: null, count: 7, sum: -70, minDate: new Date("2026-03-01"), maxDate: new Date("2026-03-15") },
    ];
    const rows = buildAccountStatus(accounts, aggs, []);
    const last = rows.at(-1)!;
    expect(last.id).toBeNull();
    expect(last.name).toBe("Unassigned");
    expect(last.txnCount).toBe(7);
  });

  it("omits the Unassigned bucket when there are no unassigned transactions", () => {
    const aggs: TxnAgg[] = [
      { accountId: 1, count: 5, sum: -10, minDate: new Date("2026-02-01"), maxDate: new Date("2026-02-10") },
    ];
    const rows = buildAccountStatus(accounts, aggs, []);
    expect(rows.some((r) => r.id === null)).toBe(false);
    expect(rows).toHaveLength(3); // the three real accounts only
  });
});
