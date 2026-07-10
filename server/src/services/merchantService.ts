/**
 * Merchant normalization: collapses variants of the same merchant
 * ("IPIC", "Ipic Atlanta", "Ipic Atlanta Boca Raton" → "IPIC";
 *  "WM Supercenter"/"Wal-Mart" → "Walmart"; "Zara Usa" → "Zara") using
 * a brand alias table plus a generic word-prefix rule.
 */
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const BRAND_ALIASES: [RegExp, string][] = [
  [/^(WM SUPERCENTER|WAL-?MART)/i, "Walmart"],
  [/^(SAMS? ?CLUB|SAM'S)/i, "Sam's Club"],
  [/^PUBLIX/i, "Publix"],
  [/^KROGER/i, "Kroger"],
  [/^ZARA/i, "Zara"],
  [/^IPIC/i, "IPIC"],
  [/^STARBUCKS/i, "Starbucks"],
  [/^DUNKIN/i, "Dunkin"],
  [/^CHEVRON/i, "Chevron"],
  [/^SHELL( OIL)?\b/i, "Shell"],
  [/^EXXON/i, "Exxon"],
  [/^TARGET/i, "Target"],
  [/^(AMAZON|AMZN)/i, "Amazon"],
  [/^COSTCO/i, "Costco"],
  [/^CVS/i, "CVS"],
  [/^WALGREENS/i, "Walgreens"],
  [/^T-?MOBILE/i, "T-Mobile"],
  [/^NETFLIX/i, "Netflix"],
  [/^SPOTIFY/i, "Spotify"],
  [/^APPLE\.?COM/i, "Apple"],
  [/^GEORGIA POWER/i, "Georgia Power"],
  [/^STATE FARM/i, "State Farm"],
  [/^MALEDA MARKET/i, "Maleda Market"],
  [/^ALDI/i, "Aldi"],
  [/^(DOORDASH|DD \*)/i, "DoorDash"],
  [/^UBER EATS/i, "Uber Eats"],
  [/^CHIPOTLE/i, "Chipotle"],
  [/^CHICK-?FIL-?A/i, "Chick-fil-A"],
  [/^HOME DEPOT/i, "Home Depot"],
  [/^(XFINITY|COMCAST)/i, "Xfinity"],
  [/^ROSS (STORES|DRESS)/i, "Ross"],
  [/^T\.?J\.? ?MAXX/i, "TJ Maxx"],
];

/** Map a merchant name to its canonical brand name (or itself). */
export function canonicalMerchantName(name: string): string {
  const trimmed = name.trim();
  for (const [re, canon] of BRAND_ALIASES) if (re.test(trimmed)) return canon;
  return trimmed;
}

export interface MerchantRow {
  id: number;
  name: string;
}

/**
 * Pure grouping: returns target-name -> merchant ids to merge into it.
 * Pass 1: brand aliases. Pass 2: word-prefix rule — "Publix Decatur" merges
 * into "Publix" when a merchant with that shorter name (≥4 chars) exists.
 * Only groups that actually change something are returned.
 */
export function computeMerchantGroups(merchants: MerchantRow[]): Map<string, number[]> {
  const canonical = new Map<number, string>();
  for (const m of merchants) canonical.set(m.id, canonicalMerchantName(m.name));

  // Word-prefix pass against the set of canonical names
  const names = [...new Set(canonical.values())].sort((a, b) => a.length - b.length);
  const finalName = new Map<number, string>();
  for (const m of merchants) {
    const cur = canonical.get(m.id)!;
    let target = cur;
    for (const candidate of names) {
      if (candidate.length >= 4 && candidate.length < target.length &&
          target.toUpperCase().startsWith(candidate.toUpperCase() + " ")) {
        target = candidate;
        break; // names sorted shortest-first, so first hit is the shortest
      }
    }
    finalName.set(m.id, target);
  }

  const groups = new Map<string, number[]>();
  for (const m of merchants) {
    const target = finalName.get(m.id)!;
    const list = groups.get(target) ?? [];
    list.push(m.id);
    groups.set(target, list);
  }
  // Keep only groups that change something (rename or 2+ members)
  for (const [target, ids] of groups) {
    const changes =
      ids.length > 1 || merchants.find((m) => m.id === ids[0])!.name !== target;
    if (!changes) groups.delete(target);
  }
  return groups;
}

/** Merge the given merchant ids into one merchant named `targetName`. */
export async function mergeMerchants(ids: number[], targetName: string): Promise<number> {
  const name = targetName.trim();
  const target = await prisma.merchant.upsert({ where: { name }, update: {}, create: { name } });
  const sourceIds = ids.filter((id) => id !== target.id);
  if (sourceIds.length > 0) {
    await prisma.transaction.updateMany({
      where: { merchantId: { in: sourceIds } },
      data: { merchantId: target.id },
    });
    await prisma.merchant.deleteMany({ where: { id: { in: sourceIds } } });
  }
  return target.id;
}

/** Run auto-normalization across all merchants. Returns a summary. */
export async function normalizeAllMerchants() {
  const merchants = await prisma.merchant.findMany({ select: { id: true, name: true } });
  const groups = computeMerchantGroups(merchants);
  let merged = 0;
  const applied: { target: string; from: string[] }[] = [];
  for (const [target, ids] of groups) {
    const fromNames = merchants.filter((m) => ids.includes(m.id)).map((m) => m.name);
    await mergeMerchants(ids, target);
    merged += ids.length;
    applied.push({ target, from: fromNames });
  }
  logger.info("Merchant normalization complete", { groups: applied.length, merchantsTouched: merged });
  return { groups: applied.length, merchantsTouched: merged, applied };
}
