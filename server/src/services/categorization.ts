/**
 * Pure categorization engine: keyword rules matched against description/merchant.
 * Longest keyword wins (more specific beats more generic), then higher priority,
 * then learned > user > default.
 */

export interface MatchRule {
  id?: number;
  keyword: string;
  categoryId: number;
  priority: number;
  source: string;
}

const SOURCE_WEIGHT: Record<string, number> = { learned: 3, user: 2, default: 1 };

export function categorize(text: string, rules: MatchRule[]): MatchRule | null {
  const haystack = text.toUpperCase();
  let best: MatchRule | null = null;
  for (const rule of rules) {
    const kw = rule.keyword.toUpperCase().trim();
    if (!kw || !haystack.includes(kw)) continue;
    if (
      !best ||
      rule.priority > best.priority ||
      (rule.priority === best.priority && kw.length > best.keyword.trim().length) ||
      (rule.priority === best.priority &&
        kw.length === best.keyword.trim().length &&
        (SOURCE_WEIGHT[rule.source] ?? 0) > (SOURCE_WEIGHT[best.source] ?? 0))
    ) {
      best = rule;
    }
  }
  return best;
}

/**
 * Extract a clean merchant name from a raw bank description.
 * Strips processor prefixes (SQ *, TST*, PY *), card/store numbers,
 * trailing city/state, dates and reference noise.
 */
export function extractMerchant(description: string): string {
  let s = description.toUpperCase();

  // processor prefixes
  s = s.replace(/^(SQ|TST|PY|PP|SP|DD|CKE|IN|USA)\s*\*\s*/i, "");
  s = s.replace(/^(POS|DEBIT|CREDIT|PURCHASE|CHECKCARD|VISA|ACH)\s+(PURCHASE\s+)?/i, "");
  // card suffix, dates, long digit runs
  s = s.replace(/\bX{2,}\d+\b/g, " ");
  s = s.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ");
  s = s.replace(/#\s*\d+/g, " ");
  s = s.replace(/\b\d{4,}\b/g, " ");
  // trailing state code + preceding city token, e.g. "KROGER ATLANTA GA"
  s = s.replace(
    /\s+[A-Z .]+\s+(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s*$/,
    "",
  );
  s = s.replace(/[^A-Z0-9&.'\- ]/g, " ").replace(/\s{2,}/g, " ").trim();

  if (!s) s = description.trim().toUpperCase() || "UNKNOWN";
  // Title Case
  return s
    .split(" ")
    .slice(0, 4)
    .map((w) => (w.length <= 2 ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(" ");
}

export function isTransferDescription(description: string, transferKeywords: string[]): boolean {
  const d = description.toUpperCase();
  return transferKeywords.some((k) => d.includes(k.toUpperCase()));
}
