/**
 * The Conscious Spending Plan's definitions: which categories are fixed costs,
 * and what each bucket is aiming at.
 *
 * Ramit Sethi's template, as percentages of take-home income:
 *   Fixed Costs 50–60% · Investments 10% · Savings 5–10% · Guilt-Free 20–35%
 *
 * These are definitions, not arithmetic, which is exactly why they were the
 * kind of thing that got copied. The demo held its own copy of both the
 * category list and the targets; they happened to agree, but the health score
 * happened to agree once too, right up until it didn't and the demo started
 * telling visitors they scored 100/100 while three budgets were over.
 *
 * One copy, imported by both.
 */

/**
 * Categories that count as Fixed Costs. Matched case-insensitively so a
 * user's own "Rent" or "MORTGAGE" lands in the right bucket, and anything
 * unrecognised falls to Guilt-Free — the honest default, since an unknown
 * category is more likely to be discretionary than a hidden obligation.
 */
export const CSP_FIXED_CATEGORIES = [
  "Housing", "Rent", "Mortgage", "Utilities", "Electricity", "Water", "Gas",
  "Internet", "Phone", "Insurance", "Health", "Medical", "Pharmacy",
  "Transportation", "Car Payment", "Groceries", "Subscriptions",
  "Debt", "Loan", "Loans", "Student Loans", "Childcare", "Tuition",
  "Taxes", "Fees & Charges",
] as const;

const FIXED = new Set(CSP_FIXED_CATEGORIES.map((n) => n.toLowerCase()));

export const isFixedCost = (categoryName: string): boolean =>
  FIXED.has(categoryName.toLowerCase());

export interface CspBucketMeta {
  key: "fixed" | "investments" | "savings" | "guiltFree";
  label: string;
  /** Target band as a percentage of take-home income. */
  targetLow: number;
  targetHigh: number;
  color: string;
}

export const CSP_BUCKETS: readonly CspBucketMeta[] = [
  { key: "fixed", label: "Fixed Costs", targetLow: 50, targetHigh: 60, color: "#64748b" },
  { key: "investments", label: "Investments", targetLow: 10, targetHigh: 10, color: "#6366f1" },
  { key: "savings", label: "Savings", targetLow: 5, targetHigh: 10, color: "#0d9488" },
  { key: "guiltFree", label: "Guilt-Free Spending", targetLow: 20, targetHigh: 35, color: "#f59e0b" },
] as const;
