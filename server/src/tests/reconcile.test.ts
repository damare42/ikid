/**
 * Reconciliation engine tests.
 *
 * Every case here asserts exact values, because the whole point of the feature
 * is that the user can trust the number. The decomposition is an identity, so
 * it can be checked two independent ways — via the buckets, and via
 * statementBalance − clearedBalance — and both are pinned below.
 */
import { describe, expect, it } from "vitest";
import {
  bucketOf, buildReconciliation, endOfDayUtc, suggestOpeningBalance, toYmd,
  type ReconcileTxn,
} from "../services/reconcileService.js";

let nextId = 1;
function txn(
  date: string,
  amount: number,
  opts: Partial<Omit<ReconcileTxn, "date" | "amount">> = {},
): ReconcileTxn {
  return {
    id: opts.id ?? nextId++,
    date,
    amount,
    description: opts.description ?? "row",
    cleared: opts.cleared ?? true,
    isTransfer: opts.isTransfer ?? false,
    balance: opts.balance ?? null,
    merchant: opts.merchant ?? null,
  };
}

const STATEMENT_DATE = "2026-07-31";

/**
 * A month of a checking account. Everything is cleared, and the closing
 * balance is exactly the sum: 3000 − 1500 − 120.55 − 450.25 = 929.20.
 * The card payment is a transfer — see the "transfers" block.
 */
function julyRows(): ReconcileTxn[] {
  nextId = 1;
  return [
    txn("2026-07-05", 3000, { description: "SALARY" }),
    txn("2026-07-10", -1500, { description: "RENT" }),
    txn("2026-07-18", -120.55, { description: "GROCERIES" }),
    txn("2026-07-25", -450.25, { description: "AMEX PAYMENT", isTransfer: true }),
  ];
}

const base = {
  accountId: 1,
  accountName: "Chase Checking",
  statementDate: STATEMENT_DATE,
  openingBalance: 0,
};

describe("toYmd / bucketOf — the statement date is a DAY, not an instant", () => {
  it("collapses a timestamp to its calendar day", () => {
    expect(toYmd(new Date("2026-07-31T00:00:00.000Z"))).toBe("2026-07-31");
    expect(toYmd(new Date("2026-07-31T14:32:07.500Z"))).toBe("2026-07-31");
    expect(toYmd(new Date("2026-07-31T23:59:59.999Z"))).toBe("2026-07-31");
    expect(toYmd(new Date("2026-08-01T00:00:00.000Z"))).toBe("2026-08-01");
    expect(toYmd("2026-07-31")).toBe("2026-07-31");
  });

  it("counts a mid-day transaction on the statement date as in-period", () => {
    const lateInTheDay = txn(toYmd(new Date("2026-07-31T22:14:00.000Z")), -60, { cleared: false });
    expect(bucketOf(lateInTheDay, STATEMENT_DATE)).toBe("uncleared");

    const justAfterMidnight = txn(toYmd(new Date("2026-08-01T00:05:00.000Z")), -60);
    expect(bucketOf(justAfterMidnight, STATEMENT_DATE)).toBe("after");
  });

  it("bulk-mark's cut-off instant agrees with the day comparison", () => {
    // If these two disagreed, "mark everything up to 31 July" would clear a row
    // the report never listed as in-period (or miss one it did).
    expect(endOfDayUtc("2026-07-31").toISOString()).toBe("2026-07-31T23:59:59.999Z");
    expect(toYmd(endOfDayUtc("2026-07-31"))).toBe("2026-07-31");
  });

  it("a transaction dated after the statement is 'after' even if marked cleared", () => {
    // The bank closed the statement before it happened, so it cannot be in the
    // closing balance regardless of what we have ticked.
    expect(bucketOf(txn("2026-08-02", -10, { cleared: true }), STATEMENT_DATE)).toBe("after");
  });
});

describe("a perfect reconciliation", () => {
  const report = buildReconciliation(julyRows(), { ...base, statementBalance: 929.2 });

  it("reports zero difference and zero residual", () => {
    expect(report.bookBalance).toBe(929.2);
    expect(report.clearedBalance).toBe(929.2);
    expect(report.difference).toBe(0);
    expect(report.residual).toBe(0);
    expect(report.balanced).toBe(true);
  });

  it("puts every row in the cleared bucket", () => {
    expect(report.clearedInPeriod.count).toBe(4);
    expect(report.clearedInPeriod.total).toBe(929.2);
    expect(report.uncleared).toEqual({
      key: "uncleared",
      label: "Not yet cleared, on or before the statement date",
      count: 0,
      total: 0,
    });
    expect(report.afterStatement.count).toBe(0);
    expect(report.afterStatement.total).toBe(0);
  });

  it("says so in plain language", () => {
    expect(report.explanation.at(-1)).toBe(
      "Nothing is left unexplained — this account is reconciled to 2026-07-31.",
    );
  });
});

describe("off by a single uncleared transaction", () => {
  const rows = [...julyRows(), txn("2026-07-28", -75.3, { cleared: false, description: "CHECK 1042" })];
  const report = buildReconciliation(rows, { ...base, statementBalance: 929.2 });

  it("the raw difference is exactly the uncleared amount", () => {
    expect(report.bookBalance).toBe(853.9); // 929.20 − 75.30
    expect(report.difference).toBe(75.3);
    expect(report.uncleared.count).toBe(1);
    expect(report.uncleared.total).toBe(-75.3);
  });

  it("uncleared explains all of it — nothing is left over", () => {
    expect(report.residual).toBe(0);
    expect(report.balanced).toBe(true);
    expect(report.clearedBalance).toBe(929.2);
  });

  it("names the count and value of the uncleared items", () => {
    expect(report.explanation[1]).toContain("1 transaction on or before 2026-07-31 is not marked cleared");
    expect(report.explanation[1]).toContain("−$75.30");
  });
});

describe("off by a transaction dated after the statement", () => {
  const rows = [...julyRows(), txn("2026-08-03", 200, { description: "AUGUST DEPOSIT" })];
  const report = buildReconciliation(rows, { ...base, statementBalance: 929.2 });

  it("the future-dated row explains the whole gap", () => {
    expect(report.bookBalance).toBe(1129.2);
    expect(report.difference).toBe(-200);
    expect(report.afterStatement.count).toBe(1);
    expect(report.afterStatement.total).toBe(200);
    expect(report.residual).toBe(0);
    expect(report.balanced).toBe(true);
  });

  it("does not count it as cleared-in-period even though it is cleared", () => {
    expect(report.clearedInPeriod.count).toBe(4);
    expect(report.clearedBalance).toBe(929.2);
  });
});

describe("an unexplained residual", () => {
  // The bank shows $42.17 less than we do, and nothing on file explains it:
  // a transaction is missing from ikid, or one of ours is a duplicate.
  const report = buildReconciliation(julyRows(), { ...base, statementBalance: 887.03 });

  it("surfaces the exact amount to hunt for", () => {
    expect(report.difference).toBe(-42.17);
    expect(report.uncleared.total).toBe(0);
    expect(report.afterStatement.total).toBe(0);
    expect(report.residual).toBe(-42.17);
    expect(report.balanced).toBe(false);
  });

  it("tells the user what a residual means and what to look for", () => {
    const last = report.explanation.at(-2) ?? "";
    expect(last).toContain("−$42.17 is left unexplained");
    expect(last).toContain("$42.17");
  });

  it("separates a residual from the parts that ARE explained", () => {
    // One uncleared item AND a genuine $42.17 hole at the same time: the
    // uncleared row must not absorb the residual, or the user would think the
    // books balance once the bank catches up.
    const rows = [...julyRows(), txn("2026-07-29", -60, { cleared: false })];
    const mixed = buildReconciliation(rows, { ...base, statementBalance: 887.03 });
    expect(mixed.bookBalance).toBe(869.2);
    expect(mixed.difference).toBe(17.83); // 887.03 − 869.20
    expect(mixed.uncleared.total).toBe(-60);
    expect(mixed.residual).toBe(-42.17);
    expect(mixed.balanced).toBe(false);
  });
});

describe("transfers", () => {
  /**
   * The decision this pins: transfers ARE part of reconciliation.
   *
   * `isTransfer` keeps a card payment out of income/spending so it isn't
   * counted as consumption on top of the purchases it settles. But the money
   * really did leave the checking account, and the bank statement really does
   * list it. Excluding transfers would put every reconciliation out by exactly
   * their sum — and it would look like a residual, i.e. like a missing
   * transaction, sending the user hunting for something that was never lost.
   */
  const rows = julyRows();
  const transferTotal = -450.25;

  it("includes transfers, so a statement containing them balances", () => {
    const report = buildReconciliation(rows, { ...base, statementBalance: 929.2 });
    expect(report.residual).toBe(0);
    expect(report.clearedInPeriod.count).toBe(4); // the transfer is counted
  });

  it("excluding them would be wrong by exactly the transfer total", () => {
    const withoutTransfers = rows.filter((t) => !t.isTransfer);
    const report = buildReconciliation(withoutTransfers, { ...base, statementBalance: 929.2 });
    expect(report.bookBalance).toBe(1379.45);
    expect(report.residual).toBe(transferTotal); // −450.25, a phantom "missing" item
  });

  it("both legs of an internal transfer reconcile against their own account", () => {
    // Reconciliation is per-account, so the -450.25 out of checking and the
    // +450.25 into the card are never netted against each other.
    const card = [txn("2026-07-25", 450.25, { isTransfer: true }), txn("2026-07-08", -200)];
    const report = buildReconciliation(card, {
      ...base, accountId: 2, accountName: "Amex Gold", statementBalance: 250.25,
    });
    expect(report.bookBalance).toBe(250.25);
    expect(report.residual).toBe(0);
  });
});

describe("an empty account", () => {
  it("reports the statement balance as entirely unexplained", () => {
    const report = buildReconciliation([], { ...base, statementBalance: 250 });
    expect(report.bookBalance).toBe(0);
    expect(report.clearedBalance).toBe(0);
    expect(report.difference).toBe(250);
    expect(report.residual).toBe(250);
    expect(report.balanced).toBe(false);
    expect(report.clearedInPeriod.count).toBe(0);
    expect(report.uncleared.count).toBe(0);
    expect(report.afterStatement.count).toBe(0);
    expect(report.suggestedOpeningBalance).toBeNull();
    expect(report.explanation[0]).toBe(
      "No transactions on file for Chase Checking. Import this account's statements, then reconcile.",
    );
  });

  it("a zero statement on an empty account balances", () => {
    const report = buildReconciliation([], { ...base, statementBalance: 0 });
    expect(report.residual).toBe(0);
    expect(report.balanced).toBe(true);
  });
});

describe("the decomposition is an identity", () => {
  const rows = [
    ...julyRows(),
    txn("2026-07-28", -75.3, { cleared: false }),
    txn("2026-08-03", 200),
    txn("2026-08-09", -33.33, { cleared: false }),
  ];

  for (const statementBalance of [929.2, 0, -1234.56, 887.03, 100000]) {
    it(`holds for a statement balance of ${statementBalance}`, () => {
      const r = buildReconciliation(rows, { ...base, statementBalance, openingBalance: 12.5 });
      // Route 1: difference plus the two explained parts.
      const viaBuckets =
        Math.round((r.difference + r.uncleared.total + r.afterStatement.total) * 100) / 100;
      // Route 2: the classic reconciliation difference.
      const viaCleared = Math.round((r.statementBalance - r.clearedBalance) * 100) / 100;
      expect(r.residual).toBe(viaBuckets);
      expect(r.residual).toBe(viaCleared);
      // And the buckets partition the rows.
      expect(r.clearedInPeriod.count + r.uncleared.count + r.afterStatement.count).toBe(rows.length);
    });
  }
});

describe("money arithmetic does not drift", () => {
  it("sums a thousand awkward amounts exactly", () => {
    // Summed as raw floats this is 99.9999999999986, so a naive implementation
    // reports a residual of a fraction of a cent on a perfectly good statement.
    const rows = Array.from({ length: 1000 }, (_, i) => txn("2026-07-15", 0.1, { id: i + 1 }));
    const report = buildReconciliation(rows, { ...base, statementBalance: 100 });
    expect(rows.reduce((s, t) => s + t.amount, 0)).not.toBe(100); // the trap
    expect(report.bookBalance).toBe(100);
    expect(report.residual).toBe(0);
    expect(report.balanced).toBe(true);
  });

  it("a real one-cent difference is still reported", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => txn("2026-07-15", 0.1, { id: i + 1 }));
    const report = buildReconciliation(rows, { ...base, statementBalance: 100.01 });
    expect(report.residual).toBe(0.01);
    expect(report.balanced).toBe(false);
  });
});

describe("opening balance", () => {
  it("a partial history shows up as a residual until the opening balance is set", () => {
    const rows = julyRows(); // sums to 929.20, but the account really began at 1500
    const cold = buildReconciliation(rows, { ...base, statementBalance: 2429.2 });
    expect(cold.residual).toBe(1500);
    expect(cold.explanation.at(-1)).toContain("set an opening balance");

    const warm = buildReconciliation(rows, { ...base, statementBalance: 2429.2, openingBalance: 1500 });
    expect(warm.bookBalance).toBe(2429.2);
    expect(warm.residual).toBe(0);
    expect(warm.balanced).toBe(true);
  });

  it("suggests one from the earliest imported running balance", () => {
    // Statement showed 3200 after the +3000 salary → the account held 200 before it.
    const rows = julyRows();
    rows[0].balance = 3200;
    expect(suggestOpeningBalance(rows)).toBe(200);
  });

  it("walks forward when only a later row carries a balance", () => {
    const rows = julyRows();
    rows[2].balance = 1579.45; // after 3000 − 1500 − 120.55, starting from 200
    expect(suggestOpeningBalance(rows)).toBe(200);
  });

  it("returns null when no row carries a running balance", () => {
    expect(suggestOpeningBalance(julyRows())).toBeNull();
  });

  it("orders by (date, id) so same-day rows are deterministic", () => {
    const rows = [
      txn("2026-07-05", -40, { id: 2, balance: 60 }),
      txn("2026-07-05", 100, { id: 1 }),
    ];
    // (date, id) order is [+100, −40]; the balance of 60 follows both → 0 before.
    expect(suggestOpeningBalance(rows)).toBe(0);
    expect(suggestOpeningBalance([...rows].reverse())).toBe(0);
  });
});
