/**
 * Shared DTO types used by both the Express server and the React client.
 * Keep this file dependency-free.
 */

export type CategoryType = "expense" | "income" | "transfer";

export interface CategoryDTO {
  id: number;
  name: string;
  type: CategoryType;
  color: string;
}

export interface MerchantDTO {
  id: number;
  name: string;
}

export interface AccountDTO {
  id: number;
  name: string;
  type: "checking" | "savings" | "credit" | "loan";
  currency: string;
  balance?: number;
}

export interface TagDTO {
  id: number;
  name: string;
}

export interface TransactionDTO {
  id: number;
  date: string; // ISO
  description: string;
  amount: number; // signed: negative = money out
  balance: number | null;
  type: "debit" | "credit";
  refNumber: string | null;
  notes: string | null;
  isTransfer: boolean;
  category: CategoryDTO | null;
  merchant: MerchantDTO | null;
  account: AccountDTO | null;
  tags: TagDTO[];
}

export interface TransactionQuery {
  search?: string;
  categoryId?: number;
  merchantId?: number;
  accountId?: number;
  /** Filter to transactions with no account assigned. */
  unassigned?: boolean;
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
  sortBy?: "date" | "amount" | "description";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RuleDTO {
  id: number;
  keyword: string;
  priority: number;
  source: "default" | "user" | "learned";
  categoryId: number;
  categoryName?: string;
}

export interface BudgetStatusDTO {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryColor: string;
  monthlyLimit: number;
  spent: number;
  remaining: number;
  pctUsed: number;
  overBudget: boolean;
  forecast: number; // projected end-of-month spend
}

export interface GoalDTO {
  id: number;
  name: string;
  icon: string;
  targetAmount: number;
  currentSaved: number;
  monthlyContribution: number;
  deadline: string | null;
  // computed
  progressPct: number;
  monthsRemaining: number | null;
  estimatedCompletion: string | null;
  requiredMonthly: number | null; // to hit the deadline
  projection: { month: string; balance: number }[];
}

export interface ImportDTO {
  id: number;
  filename: string;
  fileType: string;
  status: string;
  transactionCount: number;
  duplicateCount: number;
  importedAt: string;
  accountId: number | null;
}

/** A parsed-but-not-yet-saved row shown in the import review screen. */
export interface ParsedRow {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  balance: number | null;
  type: "debit" | "credit";
  refNumber: string | null;
  merchant: string;
  suggestedCategoryId: number | null;
  suggestedCategoryName: string | null;
  duplicate: boolean;
  valid: boolean;
  problems: string[];
}

export interface ImportPreview {
  fileType: "csv" | "pdf";
  filename: string;
  detectedColumns: Record<string, string | null>;
  rows: ParsedRow[];
  totalRows: number;
  duplicates: number;
}

export interface DashboardSummary {
  month: string; // YYYY-MM
  income: number;
  spending: number;
  netSavings: number;
  savingsRate: number; // 0..1
  cashFlow: { date: string; net: number; cumulative: number }[];
  largestCategories: { id: number | null; name: string; color: string; total: number }[];
  /** Date range of this summary (used for click-through filtering). */
  from: string;
  to: string;
  recentTransactions: TransactionDTO[];
  budgets: BudgetStatusDTO[];
  healthScore: number; // 0..100
  healthNotes: string[];
}

export interface MonthlyPoint {
  month: string;
  income: number;
  expenses: number;
  savings: number;
  /** Investment purchases within the period (also included in expenses). */
  investments?: number;
}

export interface InsightDTO {
  id: string;
  kind: "increase" | "decrease" | "info" | "warning" | "opportunity";
  title: string;
  detail: string;
  amount?: number;
}

export type AssetKind =
  | "cash" | "investment" | "property" | "vehicle" | "other"
  | "mortgage" | "loan" | "credit";

export interface AssetPayoff {
  months: number;
  payoffDate: string;
  totalInterest: number;
}

export interface AssetDTO {
  id: number;
  name: string;
  kind: AssetKind;
  isLiability: boolean;
  icon: string;
  units: number | null;
  unitPrice: number | null;
  ratePct: number | null;
  monthlyPayment: number | null;
  notes: string | null;
  value: number; // latest snapshot (always positive)
  updatedAt: string; // date of latest snapshot
  previousValue: number | null;
  payoff: AssetPayoff | null; // liabilities with rate+payment only
}

export interface NetWorthSummary {
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  assets: AssetDTO[];
  byKind: { kind: string; total: number; isLiability: boolean }[];
}

export interface NetWorthPoint {
  month: string;
  assets: number;
  liabilities: number;
  netWorth: number;
}

export type CalcKind = "amortization" | "compound" | "fire" | "coast" | "retirement";

export interface SavedCalcDTO {
  id: number;
  kind: CalcKind;
  name: string;
  inputs: Record<string, number>;
  createdAt: string;
}

export interface SettingsDTO {
  currency: string;
  dateFormat: string;
  theme: "light" | "dark" | "system";
}

/** Per-account import status — where to resume the next statement upload. */
export interface AccountStatusDTO {
  id: number | null; // null = "Unassigned" bucket
  name: string;
  type: string;
  currency: string;
  txnCount: number;
  balance: number;
  latestTxnDate: string | null; // YYYY-MM-DD, the resume point
  earliestTxnDate: string | null;
  lastImportAt: string | null; // ISO of most recent import
  lastImportFile: string | null;
}

// ---------- admin / accounts ----------

export type Role = "admin" | "user";

export interface AdminUserDTO {
  name: string;
  id: string;
  role: Role;
  disabled: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastLogin: string | null;
  eventCount: number;
  lastActive: string | null;
  isSelf: boolean;
}

export interface AdminOverviewDTO {
  totalUsers: number;
  admins: number;
  disabled: number;
  newUsers7d: number;
  activeUsers7d: number;
  activeUsers30d: number;
  totalEvents: number;
  events7d: number;
  byFeature: { feature: string; count: number }[];
  byDay: { day: string; events: number; users: number }[];
  topUsers: { user: string; events: number; lastActive: string | null }[];
  config: { allowSignups: boolean };
}
