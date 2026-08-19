/**
 * Lossless JSON export — the "no lock-in" guarantee.
 *
 * The important test here is round-trip fidelity: export → parse → and every
 * field is still there, referenced by name rather than by a database ID that
 * would be meaningless in another profile. Plus: an import must treat the file
 * as untrusted input and refuse junk with a readable message.
 */
import { describe, expect, it } from "vitest";
import {
  EXPORT_FORMAT, EXPORT_VERSION, importKey, ImportFormatError, parseExportDocument,
  referencedNames, toExportDocument, type RawSnapshot,
} from "../services/exportService.js";

const d = (s: string) => new Date(`${s}T12:00:00Z`);

/** A snapshot exercising every entity and every nullable field. */
function fixture(): RawSnapshot {
  return {
    accounts: [{ name: "Chase", type: "credit", currency: "USD" }],
    categories: [{ name: "Groceries", type: "expense", color: "#5b7d3f" }],
    merchants: [{ name: "Kroger" }],
    tags: [{ name: "reimbursable" }],
    imports: [{
      filename: "chase-june.csv", fileType: "csv", status: "completed",
      transactionCount: 1, duplicateCount: 0, importedAt: d("2026-07-01"),
      account: { name: "Chase" },
    }],
    transactions: [
      {
        date: d("2026-06-03"), description: "KROGER #688", amount: -52.1, balance: 1234.5,
        type: "debit", refNumber: "REF-1", notes: "split with Sam", hash: "hash-1",
        isTransfer: false,
        category: { name: "Groceries" }, merchant: { name: "Kroger" },
        account: { name: "Chase" }, tags: [{ name: "reimbursable" }],
        import: { filename: "chase-june.csv", importedAt: d("2026-07-01") },
      },
      {
        // Everything optional left null — must survive the round trip as null.
        date: d("2026-06-04"), description: "CASH", amount: 20, balance: null,
        type: "credit", refNumber: null, notes: null, hash: "hash-2", isTransfer: true,
        category: null, merchant: null, account: null, tags: [], import: null,
      },
    ],
    rules: [{ keyword: "KROGER", priority: 5, source: "learned", category: { name: "Groceries" } }],
    budgets: [{ monthlyLimit: 600, category: { name: "Groceries" } }],
    goals: [{
      name: "House", icon: "🏠", targetAmount: 60000, currentSaved: 12000,
      monthlyContribution: 900, deadline: d("2029-01-01"),
    }],
    assets: [{
      name: "Brokerage", kind: "investment", isLiability: false, icon: "📈",
      units: 13.7, unitPrice: 145.23, ratePct: null, monthlyPayment: null, notes: "taxable",
      snapshots: [{ date: d("2026-01-31"), value: 1900 }, { date: d("2026-06-30"), value: 1989.65 }],
    }],
    settings: [{ key: "currency", value: "USD" }, { key: "theme", value: "dark" }],
    savedCalculations: [{ kind: "fire", name: "FIRE at 4%", inputs: '{"currentAge":35,"ratePct":5}' }],
    conversations: [{ title: "Buying a house", messages: '[{"role":"user","content":"hi"}]' }],
  };
}

describe("toExportDocument", () => {
  const doc = toExportDocument(fixture(), { profile: "eked1", appVersion: "0.6.0", now: d("2026-08-01") });

  it("stamps a recognisable, versioned envelope", () => {
    expect(doc.format).toBe(EXPORT_FORMAT);
    expect(doc.version).toBe(EXPORT_VERSION);
    expect(doc.profile).toBe("eked1");
    expect(doc.appVersion).toBe("0.6.0");
    expect(doc.exportedAt).toMatch(/^2026-08-01T/);
  });

  it("counts what it contains, so a user can sanity-check the file", () => {
    expect(doc.counts).toMatchObject({ transactions: 2, accounts: 1, assets: 1, goals: 1 });
  });

  it("references relations by NAME, never by database id", () => {
    const t = doc.data.transactions[0];
    expect(t.category).toBe("Groceries");
    expect(t.merchant).toBe("Kroger");
    expect(t.account).toBe("Chase");
    expect(t.tags).toEqual(["reimbursable"]);
    // An id would make the file useless in another profile.
    expect(JSON.stringify(doc.data)).not.toMatch(/"categoryId"|"merchantId"|"accountId"/);
  });

  it("preserves every transaction field, including nulls and the dedupe hash", () => {
    const [a, b] = doc.data.transactions;
    expect(a).toMatchObject({
      date: "2026-06-03", description: "KROGER #688", amount: -52.1, balance: 1234.5,
      type: "debit", refNumber: "REF-1", notes: "split with Sam", hash: "hash-1", isTransfer: false,
    });
    expect(b).toMatchObject({
      balance: null, refNumber: null, notes: null, isTransfer: true,
      category: null, merchant: null, account: null, tags: [], import: null,
    });
  });

  it("carries import history, so 'Undo import' still works after a restore", () => {
    expect(doc.data.imports).toEqual([{
      filename: "chase-june.csv", importedAt: "2026-07-01T12:00:00.000Z", fileType: "csv",
      status: "completed", transactionCount: 1, duplicateCount: 0, account: "Chase",
    }]);
    // The link back from the transaction uses the same natural key, not an id.
    expect(doc.data.transactions[0].import).toEqual({
      filename: "chase-june.csv", importedAt: "2026-07-01T12:00:00.000Z",
    });
    expect(importKey(doc.data.imports[0])).toBe(importKey(doc.data.transactions[0].import!));
  });

  it("keeps asset value history in order", () => {
    expect(doc.data.assets[0].snapshots).toEqual([
      { date: "2026-01-31", value: 1900 },
      { date: "2026-06-30", value: 1989.65 },
    ]);
    expect(doc.data.assets[0].units).toBe(13.7);
  });

  it("turns settings into a plain readable object", () => {
    expect(doc.data.settings).toEqual({ currency: "USD", theme: "dark" });
  });

  it("parses saved-calculation inputs back into real numbers", () => {
    expect(doc.data.savedCalculations[0].inputs).toEqual({ currentAge: 35, ratePct: 5 });
  });

  it("survives a corrupt saved-calculation row instead of failing the export", () => {
    const raw = fixture();
    raw.savedCalculations = [{ kind: "fire", name: "broken", inputs: "not json{" }];
    expect(() => toExportDocument(raw)).not.toThrow();
    expect(toExportDocument(raw).data.savedCalculations[0].inputs).toEqual({});
  });

  it("is plain JSON — serialises and comes back identical", () => {
    const round = JSON.parse(JSON.stringify(doc));
    expect(round).toEqual(doc);
  });
});

describe("round trip: export → validate → same data", () => {
  it("loses nothing", () => {
    const doc = toExportDocument(fixture(), { profile: "p", now: d("2026-08-01") });
    // Serialise exactly as it would be written to disk, then re-read it.
    const reparsed = parseExportDocument(JSON.parse(JSON.stringify(doc)));
    expect(reparsed.data).toEqual(doc.data);
    expect(reparsed.counts).toEqual(doc.counts);
  });
});

describe("parseExportDocument (untrusted input)", () => {
  const good = toExportDocument(fixture());

  it("accepts a valid document", () => {
    expect(() => parseExportDocument(JSON.parse(JSON.stringify(good)))).not.toThrow();
  });

  it("rejects a file that isn't an ikid export", () => {
    expect(() => parseExportDocument({ hello: "world" })).toThrow(ImportFormatError);
    expect(() => parseExportDocument({ hello: "world" })).toThrow(/doesn't look like an ikid export/);
  });

  it("rejects a newer format version with an actionable message", () => {
    const future = { ...JSON.parse(JSON.stringify(good)), version: EXPORT_VERSION + 5 };
    expect(() => parseExportDocument(future)).toThrow(/newer version of ikid/);
    expect(() => parseExportDocument(future)).toThrow(/Update ikid/);
  });

  it("rejects a document whose transactions are malformed", () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.data.transactions[0].amount = "a lot"; // not a number
    expect(() => parseExportDocument(bad)).toThrow(ImportFormatError);
  });

  it("tolerates missing optional collections (older or hand-trimmed files)", () => {
    const minimal = {
      format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(),
      data: { transactions: [] },
    };
    const parsed = parseExportDocument(minimal);
    expect(parsed.data.accounts).toEqual([]);
    expect(parsed.data.settings).toEqual({});
  });
});

describe("referencedNames", () => {
  it("finds entities referenced only by a transaction, not listed on their own", () => {
    // A hand-edited file might reference a category it never declares — the
    // import must still create it rather than silently dropping the link.
    const doc = parseExportDocument({
      format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(),
      data: {
        transactions: [{
          date: "2026-01-01", description: "x", amount: -5, hash: "h",
          category: "Ghost category", merchant: "Ghost merchant",
          account: "Ghost account", tags: ["ghost tag"],
        }],
      },
    });
    const refs = referencedNames(doc.data);
    expect([...refs.categories]).toContain("Ghost category");
    expect([...refs.merchants]).toContain("Ghost merchant");
    expect([...refs.accounts]).toContain("Ghost account");
    expect([...refs.tags]).toContain("ghost tag");
  });

  it("unions declared and referenced names without duplicates", () => {
    const doc = toExportDocument(fixture());
    const refs = referencedNames(doc.data);
    expect([...refs.categories]).toEqual(["Groceries"]);
    expect([...refs.accounts]).toEqual(["Chase"]);
  });

  it("picks up an account named only by an import record", () => {
    const doc = parseExportDocument({
      format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(),
      data: {
        imports: [{ filename: "amex.csv", importedAt: "2026-05-01T00:00:00.000Z", account: "Amex" }],
      },
    });
    expect([...referencedNames(doc.data).accounts]).toContain("Amex");
  });
});

describe("importKey", () => {
  it("separates two imports of the same filename at different times", () => {
    const a = { filename: "chase.csv", importedAt: "2026-01-01T00:00:00.000Z" };
    const b = { filename: "chase.csv", importedAt: "2026-02-01T00:00:00.000Z" };
    expect(importKey(a)).not.toBe(importKey(b));
    expect(importKey(a)).toBe(importKey({ ...a }));
  });
});
