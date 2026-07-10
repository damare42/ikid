import { describe, expect, it } from "vitest";
import { detectColumns, parseAmount, parseDate, parsePdfText, rowFromCsv } from "../services/parsers.js";

describe("detectColumns", () => {
  it("maps common bank headers", () => {
    const cols = detectColumns(["Posted Date", "Description", "Amount", "Running Balance"]);
    expect(cols.date).toBe("Posted Date");
    expect(cols.description).toBe("Description");
    expect(cols.amount).toBe("Amount");
    expect(cols.balance).toBe("Running Balance");
  });

  it("handles separate debit/credit columns", () => {
    const cols = detectColumns(["Date", "Details", "Withdrawal", "Deposit"]);
    expect(cols.debit).toBe("Withdrawal");
    expect(cols.credit).toBe("Deposit");
    expect(cols.amount).toBeNull();
  });
});

describe("parseDate", () => {
  it("parses common formats", () => {
    expect(parseDate("2026-01-05")).toBe("2026-01-05");
    expect(parseDate("1/5/2026")).toBe("2026-01-05");
    expect(parseDate("01/05/26")).toBe("2026-01-05");
    expect(parseDate("Jan 5, 2026")).toBe("2026-01-05");
    expect(parseDate("6/12", 2026)).toBe("2026-06-12");
  });
  it("rejects garbage", () => {
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("13/45/2026")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("parses currency strings", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("-45.00")).toBe(-45);
    expect(parseAmount("(45.00)")).toBe(-45);
    expect(parseAmount("45.00 CR")).toBe(45);
    expect(parseAmount("")).toBeNull();
  });
});

describe("rowFromCsv", () => {
  it("builds a signed amount from debit/credit columns", () => {
    const cols = detectColumns(["Date", "Description", "Debit", "Credit"]);
    const debitRow = rowFromCsv({ Date: "1/5/2026", Description: "KROGER", Debit: "52.10", Credit: "" }, cols);
    expect(debitRow.amount).toBe(-52.1);
    const creditRow = rowFromCsv({ Date: "1/6/2026", Description: "PAYROLL", Debit: "", Credit: "3400.00" }, cols);
    expect(creditRow.amount).toBe(3400);
  });

  it("flags unparseable rows instead of throwing", () => {
    const cols = detectColumns(["Date", "Description", "Amount"]);
    const bad = rowFromCsv({ Date: "??", Description: "X", Amount: "??" }, cols);
    expect(bad.problems.length).toBeGreaterThan(0);
  });
});

describe("parsePdfText", () => {
  it("extracts date/description/amount/balance lines", () => {
    const text = [
      "Statement Period: 06/01/2026 - 06/30/2026",
      "06/03 KROGER #688 ATLANTA GA -52.10 1,447.90",
      "06/05 ACME CORP PAYROLL 3,400.00 4,847.90",
      "random footer line",
    ].join("\n");
    const rows = parsePdfText(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2026-06-03", amount: -52.1, balance: 1447.9 });
    expect(rows[1].description).toContain("ACME CORP PAYROLL");
  });
});
