import { describe, expect, it } from "vitest";
import { canonicalMerchantName, computeMerchantGroups } from "../services/merchantService.js";

describe("canonicalMerchantName", () => {
  it("maps known brand variants", () => {
    expect(canonicalMerchantName("WM Supercenter")).toBe("Walmart");
    expect(canonicalMerchantName("Wal-Mart")).toBe("Walmart");
    expect(canonicalMerchantName("Samsclub")).toBe("Sam's Club");
    expect(canonicalMerchantName("Sams Club")).toBe("Sam's Club");
    expect(canonicalMerchantName("Zara Usa")).toBe("Zara");
    expect(canonicalMerchantName("Ipic Theaters")).toBe("IPIC");
    expect(canonicalMerchantName("Publix Decatur")).toBe("Publix");
  });

  it("leaves unknown merchants alone", () => {
    expect(canonicalMerchantName("Maleda Market")).toBe("Maleda Market");
    expect(canonicalMerchantName("Blue Donkey Coffee")).toBe("Blue Donkey Coffee");
  });
});

describe("computeMerchantGroups", () => {
  it("groups brand variants and word-prefix variants", () => {
    const merchants = [
      { id: 1, name: "Ipic" },
      { id: 2, name: "Ipic Atlanta" },
      { id: 3, name: "Ipic Atlanta Boca Raton" },
      { id: 4, name: "Zara" },
      { id: 5, name: "Zara Usa" },
      { id: 6, name: "WM Supercenter" },
      { id: 7, name: "Walmart" },
      { id: 8, name: "Maleda Market" },
    ];
    const groups = computeMerchantGroups(merchants);
    expect(groups.get("IPIC")?.sort()).toEqual([1, 2, 3]);
    expect(groups.get("Zara")?.sort()).toEqual([4, 5]);
    expect(groups.get("Walmart")?.sort()).toEqual([6, 7]);
    expect(groups.has("Maleda Market")).toBe(false); // unchanged, not returned
  });

  it("merges location suffixes into an existing shorter merchant", () => {
    const merchants = [
      { id: 1, name: "Publix" },
      { id: 2, name: "Publix Decatur" },
      { id: 3, name: "Home Depot" },
      { id: 4, name: "Home Chef" }, // must NOT merge into Home Depot
    ];
    const groups = computeMerchantGroups(merchants);
    expect(groups.get("Publix")?.sort()).toEqual([1, 2]);
    expect([...groups.keys()]).not.toContain("Home Chef");
  });

  it("does not merge on short prefixes", () => {
    const merchants = [
      { id: 1, name: "Ga" },
      { id: 2, name: "Ga Natgas" },
    ];
    const groups = computeMerchantGroups(merchants);
    expect(groups.size).toBe(0); // "Ga" is under 4 chars — too risky
  });
});
