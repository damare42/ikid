/**
 * The accounting conventions, and nothing else.
 *
 * These four predicates decide what the whole app calls income and spending.
 * They live in their own dependency-free file because more than one runtime
 * needs them: the server computes analytics from SQLite, and the hosted demo
 * computes the same analytics in a browser with no database at all. If each
 * had its own copy of "what counts as spending", the demo would eventually
 * disagree with the product about the only thing it exists to demonstrate.
 *
 * Kept import-free on purpose — anything imported here gets pulled into the
 * browser bundle too.
 */

export interface SlimTxn {
  date: Date;
  amount: number;
  isTransfer: boolean;
  categoryId: number | null;
  categoryName: string;
  categoryColor: string;
  categoryType: string;
  merchantName: string;
}

/**
 * A transaction is a transfer when flagged OR categorized as a transfer-type
 * category (Transfers, Savings). Either way it is never income or spending —
 * paying a credit-card bill must not double-count.
 */
export const isTransferTxn = (t: SlimTxn): boolean => t.isTransfer || t.categoryType === "transfer";

/** Investment purchases are contributions, not consumption. */
export const isInvestment = (t: SlimTxn): boolean =>
  t.amount < 0 && !isTransferTxn(t) && t.categoryName === "Investment";

export const isExpense = (t: SlimTxn): boolean =>
  t.amount < 0 && !isTransferTxn(t) && !isInvestment(t);

export const isIncome = (t: SlimTxn): boolean => t.amount > 0 && !isTransferTxn(t);

export const monthKeyOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const round2 = (n: number): number => Math.round(n * 100) / 100;
