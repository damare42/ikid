import { describe, expect, it } from "vitest";
import { categorize, extractMerchant, isTransferDescription, type MatchRule } from "../services/categorization.js";

const rules: MatchRule[] = [
  { keyword: "STARBUCKS", categoryId: 1, priority: 0, source: "default" },
  { keyword: "COSTCO", categoryId: 2, priority: 0, source: "default" },
  { keyword: "COSTCO GAS", categoryId: 3, priority: 0, source: "default" },
  { keyword: "AMAZON", categoryId: 4, priority: 0, source: "default" },
  { keyword: "AMAZON", categoryId: 5, priority: 5, source: "learned" },
];

describe("categorize", () => {
  it("matches case-insensitively as substring", () => {
    expect(categorize("purchase starbucks store 123", rules)?.categoryId).toBe(1);
  });

  it("prefers longer (more specific) keywords", () => {
    expect(categorize("COSTCO GAS #522", rules)?.categoryId).toBe(3);
    expect(categorize("COSTCO WHSE #522", rules)?.categoryId).toBe(2);
  });

  it("prefers higher-priority (learned) rules over defaults", () => {
    expect(categorize("AMAZON.COM*ORDER", rules)?.categoryId).toBe(5);
  });

  it("returns null when nothing matches", () => {
    expect(categorize("MYSTERY MERCHANT", rules)).toBeNull();
  });
});

describe("extractMerchant", () => {
  it("strips processor prefixes and numbers", () => {
    expect(extractMerchant("SQ *BLUE DONKEY COFFEE")).toContain("Blue Donkey");
    expect(extractMerchant("STARBUCKS STORE 08736")).toBe("Starbucks Store");
  });

  it("strips dates and card masks", () => {
    const m = extractMerchant("POS PURCHASE 06/12 KROGER #688 XXXX1234");
    expect(m).toContain("Kroger");
    expect(m).not.toMatch(/\d{4}/);
  });
});

describe("isTransferDescription", () => {
  const kw = ["TRANSFER", "AUTOPAY", "PAYMENT THANK YOU"];
  it("detects transfers", () => {
    expect(isTransferDescription("ONLINE TRANSFER TO SAVINGS", kw)).toBe(true);
    expect(isTransferDescription("CHASE CARD AUTOPAY", kw)).toBe(true);
    expect(isTransferDescription("KROGER #688", kw)).toBe(false);
  });
});
