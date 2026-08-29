/**
 * Demo mode: a generated, obviously-fake financial history so a stranger can
 * see every screen working before importing a single real statement.
 *
 * ── Two layers, on purpose ────────────────────────────────────────────────
 *   1. `generateDemoData()` is a PURE function: (seed, anchor date) -> plain
 *      objects. No database, no clock, no I/O. That is where all the
 *      interesting logic lives, and it is fully unit-testable.
 *   2. `loadDemoInto()` is a thin writer that takes an injected database
 *      handle. It is small enough to review by eye, and its safety guard is
 *      a pure function (`demoLoadDecision`) tested on its own.
 *
 * ── Determinism (PRINCIPLES rule 2) ───────────────────────────────────────
 * Same seed + same anchor date => byte-identical dataset. The PRNG is a
 * 12-line mulberry32 written here rather than pulled from npm, because
 * "dependencies are a liability" and this is genuinely a dozen lines.
 *
 * The anchor date is an explicit argument rather than `new Date()` inside the
 * generator. The demo has to look *current* (a dashboard whose "this month" is
 * empty is a bad first impression), but a function that reads the clock is not
 * deterministic. Making the clock an argument gives us both: the writer passes
 * today, the tests pass a fixed date.
 *
 * ── Where the demo lives ──────────────────────────────────────────────────
 * In its own profile (its own SQLite file), not as a flag on an existing one.
 * Trade-off considered:
 *   - Flag on the current profile: one click, no profile switching, works in
 *     hosted multi-user mode. But demo rows would sit in the same tables as
 *     real money, and every query in the app would have to filter them out
 *     forever. One missed filter and a real net-worth number is wrong.
 *   - Separate profile (chosen): the demo cannot physically touch real data,
 *     because it is a different file. Reset is a table wipe scoped to that
 *     file. The cost is that the user has to switch profiles to get back,
 *     which the avatar menu already does.
 * `target: "current"` still exists for hosted mode, where profile switching is
 * refused — but it is guarded by the emptiness check below.
 *
 * ── Invented world ────────────────────────────────────────────────────────
 * Every merchant, bank and employer below is made up. No real company names.
 */
import {
  DEMO_GENERATED_AT_KEY,
  DEMO_MARKER_KEY,
  DEMO_SEED,
  DEMO_SEED_KEY,
} from "../../../shared/demo.js";
import type { DemoCounts } from "../../../shared/demo.js";
import { transactionHash } from "./dedupe.js";
import { addMoney, round2, sumBy } from "./money.js";

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

/**
 * mulberry32 — a 32-bit seeded generator. Small, fast, and good enough for
 * "make this look like a plausible bank statement". Not cryptographic; it is
 * never used for anything security-related.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Thin ergonomic wrapper so the generator below reads like prose. */
class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  /** Uniform in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }
  /** Uniform money value in [min, max], rounded to cents. */
  money(min: number, max: number): number {
    return round2(this.float(min, max));
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// ---------------------------------------------------------------------------
// The fake world
// ---------------------------------------------------------------------------

export type DemoAccountKey = "checking" | "savings" | "credit";

export interface DemoAccount {
  key: DemoAccountKey;
  name: string;
  type: "checking" | "savings" | "credit";
  /** Balance before the first generated transaction. */
  openingBalance: number;
}

/**
 * Account names carry "(demo)" so the fakeness survives a screenshot: account
 * names appear in the header of nearly every table and chart in the app.
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { key: "checking", name: "Thistlewood Everyday Checking (demo)", type: "checking", openingBalance: 4820.55 },
  { key: "savings", name: "Thistlewood Rainy Day Savings (demo)", type: "savings", openingBalance: 9250 },
  { key: "credit", name: "Meridian Ember Credit Card (demo)", type: "credit", openingBalance: -640.18 },
];

const EMPLOYER = "Halberd & Vine Consulting";
const BANK = "Thistlewood Bank";

const GROCERS = ["Northbrook Grocers", "Fenwick Market", "The Turnip Truck"] as const;
const COFFEE = ["Tessellate Coffee", "Owl & Kettle"] as const;
const DINING = [
  "Pilcrow Pizza",
  "Saffron & Sparrow",
  "The Greedy Fig",
  "Noodle Parliament",
  "Brine & Bramble",
] as const;
const FUEL = ["Halcyon Fuel", "Cinder Lane Filling Station"] as const;
const SHOPS = ["Ravello Home", "Pinecrest Outfitters", "Widget & Whistle", "Marrow & Mint Pharmacy"] as const;
const FUN = ["The Empyrean Cinema", "Bramblewood Books", "Quarrel & Dice"] as const;

/**
 * Fixed monthly bills. `since`/`until` are month indexes into the generated
 * window, which is how the "one subscription changes price, one stops"
 * requirement is expressed as data rather than as special-case code.
 */
interface RecurringBill {
  merchant: string;
  label: string;
  category: string;
  account: DemoAccountKey;
  day: number;
  amount: number;
  /** First month index this bill appears in (inclusive). Default 0. */
  since?: number;
  /** Last month index this bill appears in (inclusive). Default: forever. */
  until?: number;
  /** Random +/- fraction applied to the amount (0 = exactly fixed). */
  jitter?: number;
}

const RECURRING: readonly RecurringBill[] = [
  // Housing / debt — the two big fixed outflows, both on the checking account.
  { merchant: "Wrenfield Mortgage", label: "MORTGAGE PAYMENT", category: "Housing", account: "checking", day: 1, amount: -1940 },
  { merchant: "Alderpath Auto Finance", label: "AUTO LOAN PAYMENT", category: "Transportation", account: "checking", day: 3, amount: -385 },
  // Utilities. Power is seasonal (handled separately); water drifts a little.
  { merchant: "Brightwater Utilities", label: "WATER & SEWER", category: "Utilities", account: "checking", day: 12, amount: -46.4, jitter: 0.12 },
  { merchant: "Larkspur Fibre", label: "BROADBAND AUTOPAY", category: "Internet", account: "checking", day: 6, amount: -64.99 },
  { merchant: "Pocketwren Mobile", label: "MOBILE PLAN", category: "Phone", account: "checking", day: 9, amount: -38 },
  { merchant: "Cormorant Mutual", label: "HOME & AUTO POLICY", category: "Insurance", account: "checking", day: 11, amount: -142.5 },
  { merchant: "Two Rivers Food Bank", label: "MONTHLY GIVING", category: "Gifts & Charity", account: "checking", day: 22, amount: -50 },
  // Subscriptions live on the credit card, like most people's do.
  // Lumenflix is THE price change: 15.99 for 14 months, then 18.99.
  { merchant: "Lumenflix", label: "LUMENFLIX STANDARD", category: "Subscriptions", account: "credit", day: 4, amount: -15.99, until: 13 },
  { merchant: "Lumenflix", label: "LUMENFLIX STANDARD", category: "Subscriptions", account: "credit", day: 4, amount: -18.99, since: 14 },
  // Quillbox is THE cancellation: it simply stops after month 16.
  { merchant: "Quillbox Storage", label: "QUILLBOX 200GB", category: "Subscriptions", account: "credit", day: 18, amount: -2.99, until: 16 },
  { merchant: "Chordwell Music", label: "CHORDWELL FAMILY", category: "Subscriptions", account: "credit", day: 7, amount: -10.99 },
  { merchant: "Pixelforge Games", label: "PIXELFORGE PASS", category: "Subscriptions", account: "credit", day: 21, amount: -8.99 },
  { merchant: "Bellwether Fitness", label: "GYM MEMBERSHIP", category: "Subscriptions", account: "credit", day: 2, amount: -39 },
];

/** Power bill multiplier by calendar month (Jan..Dec): cold winters, hot Julys. */
const POWER_SEASON = [1.46, 1.38, 1.1, 0.92, 0.9, 1.14, 1.36, 1.4, 1.18, 0.94, 1.0, 1.3];
/** Discretionary spending multiplier by calendar month. December is December. */
const SPEND_SEASON = [0.92, 0.9, 1.0, 1.02, 1.06, 1.12, 1.16, 1.1, 1.0, 1.04, 1.1, 1.34];

/**
 * The memorable one-offs, declared rather than randomised so they land in a
 * known month and a reader can audit exactly where a spike came from.
 * Keyed by month index into the 24-month window.
 */
interface OneOff {
  monthIndex: number;
  day: number;
  merchant: string;
  label: string;
  category: string;
  account: DemoAccountKey;
  amount: number;
  notes: string;
}

const ONE_OFFS: readonly OneOff[] = [
  { monthIndex: 5, day: 17, merchant: "Halcyon Auto Works", label: "HALCYON AUTO WORKS", category: "Transportation", account: "checking", amount: -1340.75, notes: "Alternator and belt, plus labour." },
  { monthIndex: 7, day: 9, merchant: "Cloudberry Airways", label: "CLOUDBERRY AIRWAYS", category: "Travel", account: "credit", amount: -821.4, notes: "Two return fares, booked early." },
  { monthIndex: 7, day: 26, merchant: "Hotel Vermillion", label: "HOTEL VERMILLION", category: "Travel", account: "credit", amount: -1183.2, notes: "Six nights." },
  { monthIndex: 11, day: 14, merchant: "Alderpath Dental Studio", label: "ALDERPATH DENTAL", category: "Health", account: "checking", amount: -684, notes: "Crown, after insurance." },
  { monthIndex: 16, day: 3, merchant: "Ravello Home", label: "RAVELLO HOME", category: "Shopping", account: "credit", amount: -1462.35, notes: "Replacement sofa." },
  { monthIndex: 19, day: 11, merchant: "Widget & Whistle", label: "WIDGET & WHISTLE", category: "Shopping", account: "credit", amount: -1499, notes: "New laptop — the old one gave up." },
  { monthIndex: 21, day: 6, merchant: "Cloudberry Airways", label: "CLOUDBERRY AIRWAYS", category: "Travel", account: "credit", amount: -943.6, notes: "Second trip; fares were up." },
];

// Income shape.
const SALARY_BASE = 3250; // paid twice a month
const SALARY_RAISE_MONTH = 12; // index at which the annual raise lands
const SALARY_RAISE = 1.042;
const BONUS_MONTH = 1; // calendar February
const BONUS_AMOUNT = 4800;

// Recurring saving / investing, both from checking.
const MONTHLY_SAVINGS_TRANSFER = 800;
const MONTHLY_INVESTMENT = 650;

// ---------------------------------------------------------------------------
// Dataset shape
// ---------------------------------------------------------------------------

export interface DemoTransaction {
  /** YYYY-MM-DD (UTC). */
  date: string;
  description: string;
  /** Signed: negative = money out, positive = money in. */
  amount: number;
  /** Running balance of `accountKey` after this transaction. */
  balance: number;
  type: "debit" | "credit";
  refNumber: string;
  merchant: string;
  /** Must be one of DEFAULT_CATEGORIES (see services/defaults.ts). */
  category: string;
  accountKey: DemoAccountKey;
  /** True excludes this row from income and spending totals. */
  isTransfer: boolean;
  notes: string | null;
}

export interface DemoBudget {
  category: string;
  monthlyLimit: number;
}

export interface DemoGoal {
  name: string;
  icon: string;
  targetAmount: number;
  currentSaved: number;
  monthlyContribution: number;
  /** YYYY-MM-DD or null. */
  deadline: string | null;
}

export interface DemoAssetSnapshot {
  /** YYYY-MM-DD. */
  date: string;
  /** Always positive; the liability sign comes from `isLiability`. */
  value: number;
}

export interface DemoAsset {
  name: string;
  kind: "cash" | "investment" | "property" | "vehicle" | "other" | "mortgage" | "loan" | "credit";
  isLiability: boolean;
  icon: string;
  units: number | null;
  unitPrice: number | null;
  ratePct: number | null;
  monthlyPayment: number | null;
  notes: string | null;
  snapshots: DemoAssetSnapshot[];
}

export interface DemoDataset {
  seed: number;
  /** The anchor date the dataset was generated against (YYYY-MM-DD). */
  anchor: string;
  range: { from: string; to: string };
  accounts: readonly DemoAccount[];
  merchants: string[];
  transactions: DemoTransaction[];
  budgets: DemoBudget[];
  goals: DemoGoal[];
  assets: DemoAsset[];
}

// ---------------------------------------------------------------------------
// Date helpers (UTC throughout, so the dataset never shifts with the timezone)
// ---------------------------------------------------------------------------

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Build a YYYY-MM-DD string, clamping the day into the month. */
function ymd(year: number, month: number, day: number): string {
  const d = Math.min(Math.max(1, day), daysInMonth(year, month));
  return new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10);
}

interface MonthRef {
  index: number;
  year: number;
  month: number;
}

/** The `count` months ending with (and including) the anchor's month. */
function monthWindow(anchorYear: number, anchorMonth: number, count: number): MonthRef[] {
  const months: MonthRef[] = [];
  for (let i = 0; i < count; i++) {
    const offset = anchorMonth - (count - 1 - i);
    const year = anchorYear + Math.floor(offset / 12);
    const month = ((offset % 12) + 12) % 12;
    months.push({ index: i, year, month });
  }
  return months;
}

/** 24 months gives year-over-year comparisons something to compare against. */
export const DEMO_MONTHS = 24;

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

interface DraftTxn {
  date: string;
  label: string;
  amount: number;
  merchant: string;
  category: string;
  accountKey: DemoAccountKey;
  isTransfer: boolean;
  notes: string | null;
  /** Optional store number appended to the description, e.g. "#214". */
  store: number | null;
}

/**
 * Every transaction needs a unique dedupe hash, and the hash is computed from
 * date · amount · description · merchant · account. Two coffees at the same
 * shop, same price, same day would therefore collide — which is realistic, but
 * would make the demo import-collide with itself. So descriptions carry a
 * store/terminal number (banks do this too) and we bump it deterministically
 * until the identity tuple is unique.
 */
function describe(d: DraftTxn): string {
  return d.store == null ? d.label : `${d.label} #${d.store}`;
}

function identity(d: DraftTxn, description: string): string {
  return [d.date, d.amount.toFixed(2), description.toUpperCase(), d.merchant.toUpperCase(), d.accountKey].join("|");
}

export interface GenerateOptions {
  seed?: number;
  /** The "today" the dataset is built around. Defaults to the real clock. */
  anchor?: Date;
}

/**
 * Generate the whole demo dataset. Pure: no clock, no database, no I/O.
 * `(seed, anchor)` in, plain objects out.
 */
export function generateDemoData(options: GenerateOptions = {}): DemoDataset {
  const seed = options.seed ?? DEMO_SEED;
  const anchorDate = options.anchor ?? new Date();
  const anchorYear = anchorDate.getUTCFullYear();
  const anchorMonth = anchorDate.getUTCMonth();
  const anchorDay = anchorDate.getUTCDate();
  const anchor = ymd(anchorYear, anchorMonth, anchorDay);

  const rng = new Rng(seed);
  const months = monthWindow(anchorYear, anchorMonth, DEMO_MONTHS);

  const drafts: DraftTxn[] = [];
  const add = (d: Omit<DraftTxn, "store" | "notes"> & { store?: number; notes?: string }) => {
    // The window ends at the anchor date — the demo never invents the future.
    if (d.date > anchor) return;
    drafts.push({ ...d, store: d.store ?? null, notes: d.notes ?? null });
  };

  /** Credit-card spending per month index, so next month's payment matches. */
  const cardSpend = new Array<number>(DEMO_MONTHS).fill(0);
  const cardCharge = (
    monthIndex: number,
    d: Omit<DraftTxn, "store" | "notes"> & { store?: number; notes?: string },
  ) => {
    if (d.date > anchor) return;
    cardSpend[monthIndex] = round2(cardSpend[monthIndex] - d.amount); // amount is negative
    add(d);
  };

  for (const { index: i, year: y, month: m } of months) {
    const season = SPEND_SEASON[m];
    const salary = round2(SALARY_BASE * (i >= SALARY_RAISE_MONTH ? SALARY_RAISE : 1));

    // ---- Income ---------------------------------------------------------
    for (const day of [15, daysInMonth(y, m)]) {
      add({
        date: ymd(y, m, day),
        label: "HALBERD & VINE PAYROLL",
        amount: salary,
        merchant: EMPLOYER,
        category: "Salary",
        accountKey: "checking",
        isTransfer: false,
      });
    }
    if (m === BONUS_MONTH) {
      add({
        date: ymd(y, m, 20),
        label: "HALBERD & VINE ANNUAL BONUS",
        amount: BONUS_AMOUNT,
        merchant: EMPLOYER,
        category: "Salary",
        accountKey: "checking",
        isTransfer: false,
        notes: "Paid every February.",
      });
    }
    if (i % 6 === 3) {
      add({
        date: ymd(y, m, 24),
        label: "KESTREL FREELANCE INVOICE",
        amount: rng.money(420, 910),
        merchant: "Kestrel Freelance",
        category: "Other Income",
        accountKey: "checking",
        isTransfer: false,
      });
    }
    if (m % 3 === 2) {
      add({
        date: ymd(y, m, 28),
        label: "SAVINGS INTEREST PAID",
        amount: round2(9 + i * 0.62),
        merchant: BANK,
        category: "Other Income",
        accountKey: "savings",
        isTransfer: false,
      });
    }

    // ---- Fixed bills ----------------------------------------------------
    for (const bill of RECURRING) {
      if (i < (bill.since ?? 0) || i > (bill.until ?? Number.MAX_SAFE_INTEGER)) continue;
      const amount = bill.jitter
        ? round2(bill.amount * rng.float(1 - bill.jitter, 1 + bill.jitter))
        : bill.amount;
      const draft = {
        date: ymd(y, m, bill.day),
        label: bill.label,
        amount,
        merchant: bill.merchant,
        category: bill.category,
        accountKey: bill.account,
        isTransfer: false,
      };
      if (bill.account === "credit") cardCharge(i, draft);
      else add(draft);
    }

    // Power is the seasonal one, so it gets its own line.
    add({
      date: ymd(y, m, 8),
      label: "CINDERMILL POWER",
      amount: round2(-82 * POWER_SEASON[m] * rng.float(0.94, 1.07)),
      merchant: "Cindermill Power",
      category: "Utilities",
      accountKey: "checking",
      isTransfer: false,
    });

    // Annual tax settling-up, every April.
    if (m === 3) {
      add({
        date: ymd(y, m, 15),
        label: "BOROUGH REVENUE OFFICE",
        amount: -1150,
        merchant: "Borough Revenue Office",
        category: "Taxes",
        accountKey: "checking",
        isTransfer: false,
        notes: "Balance owed after withholding.",
      });
    }

    // ---- Everyday spending ---------------------------------------------
    for (let n = 0; n < rng.int(4, 6); n++) {
      add({
        date: ymd(y, m, rng.int(1, 28)),
        label: rng.pick(GROCERS).toUpperCase(),
        amount: round2(-rng.float(46, 168) * (m === 11 ? 1.25 : 1)),
        merchant: rng.pick(GROCERS),
        category: "Groceries",
        accountKey: "checking",
        isTransfer: false,
        store: rng.int(101, 399),
      });
    }
    for (let n = 0; n < rng.int(2, 3); n++) {
      const brand = rng.pick(FUEL);
      add({
        date: ymd(y, m, rng.int(2, 27)),
        label: brand.toUpperCase(),
        amount: rng.money(-64, -36),
        merchant: brand,
        category: "Transportation",
        accountKey: "checking",
        isTransfer: false,
        store: rng.int(11, 88),
      });
    }
    for (let n = 0; n < rng.int(1, 3); n++) {
      add({
        date: ymd(y, m, rng.int(1, 28)),
        label: "MERIDIAN TRANSIT FARE",
        amount: rng.money(-11.5, -2.75),
        merchant: "Meridian Transit",
        category: "Transportation",
        accountKey: "checking",
        isTransfer: false,
      });
    }

    // Card-funded discretionary spending.
    for (let n = 0; n < rng.int(6, 12); n++) {
      const brand = rng.pick(COFFEE);
      cardCharge(i, {
        date: ymd(y, m, rng.int(1, 28)),
        label: brand.toUpperCase(),
        amount: rng.money(-7.9, -3.95),
        merchant: brand,
        category: "Coffee",
        accountKey: "credit",
        isTransfer: false,
        store: rng.int(201, 244),
      });
    }
    for (let n = 0; n < rng.int(5, 9); n++) {
      const brand = rng.pick(DINING);
      cardCharge(i, {
        date: ymd(y, m, rng.int(1, 28)),
        label: brand.toUpperCase(),
        amount: round2(-rng.float(17, 88) * season),
        merchant: brand,
        category: "Dining",
        accountKey: "credit",
        isTransfer: false,
        store: rng.int(300, 366),
      });
    }
    for (let n = 0; n < rng.int(2, 5); n++) {
      const brand = rng.pick(SHOPS);
      cardCharge(i, {
        date: ymd(y, m, rng.int(1, 28)),
        label: brand.toUpperCase(),
        amount: round2(-rng.float(18, 165) * season),
        merchant: brand,
        category: brand === "Marrow & Mint Pharmacy" ? "Health" : "Shopping",
        accountKey: "credit",
        isTransfer: false,
        store: rng.int(400, 470),
      });
    }
    for (let n = 0; n < rng.int(1, 3); n++) {
      const brand = rng.pick(FUN);
      cardCharge(i, {
        date: ymd(y, m, rng.int(1, 28)),
        label: brand.toUpperCase(),
        amount: rng.money(-62, -14),
        merchant: brand,
        category: "Entertainment",
        accountKey: "credit",
        isTransfer: false,
        store: rng.int(500, 540),
      });
    }

    // The occasional annoying bank fee.
    if (rng.chance(0.22)) {
      add({
        date: ymd(y, m, 27),
        label: "MONTHLY SERVICE FEE",
        amount: -3,
        merchant: BANK,
        category: "Fees & Charges",
        accountKey: "checking",
        isTransfer: false,
      });
    }

    // ---- One-offs -------------------------------------------------------
    for (const o of ONE_OFFS.filter((x) => x.monthIndex === i)) {
      const draft = {
        date: ymd(y, m, o.day),
        label: o.label,
        amount: o.amount,
        merchant: o.merchant,
        category: o.category,
        accountKey: o.account,
        isTransfer: false,
        notes: o.notes,
      };
      if (o.account === "credit") cardCharge(i, draft);
      else add(draft);
    }

    // ---- Transfers ------------------------------------------------------
    // Both legs are flagged isTransfer, so the pair contributes nothing to
    // income or spending. Same amount, opposite signs, same day: the whole
    // set of transfers must net to exactly zero, and a test asserts it.
    const transferDay = ymd(y, m, 16);
    add({
      date: transferDay,
      label: "TRANSFER TO RAINY DAY SAVINGS",
      amount: -MONTHLY_SAVINGS_TRANSFER,
      merchant: BANK,
      category: "Savings",
      accountKey: "checking",
      isTransfer: true,
    });
    add({
      date: transferDay,
      label: "TRANSFER FROM EVERYDAY CHECKING",
      amount: MONTHLY_SAVINGS_TRANSFER,
      merchant: BANK,
      category: "Savings",
      accountKey: "savings",
      isTransfer: true,
    });

    // Credit-card payment: pays LAST month's card spend in full, on the 5th.
    // Both legs flagged, otherwise the card payment would be counted as
    // spending on the checking side and as income on the card side.
    const owed = i === 0 ? Math.abs(DEMO_ACCOUNTS[2].openingBalance) : cardSpend[i - 1];
    if (owed > 0) {
      const payDay = ymd(y, m, 5);
      add({
        date: payDay,
        label: "MERIDIAN EMBER CARD PAYMENT",
        amount: -owed,
        merchant: "Meridian Ember Card Services",
        category: "Transfers",
        accountKey: "checking",
        isTransfer: true,
      });
      add({
        date: payDay,
        label: "PAYMENT RECEIVED - THANK YOU",
        amount: owed,
        merchant: "Meridian Ember Card Services",
        category: "Transfers",
        accountKey: "credit",
        isTransfer: true,
      });
    }

    // Investing is a contribution, not consumption: NOT a transfer (so it
    // shows up in the Investment category), and analytics separates it out.
    add({
      date: ymd(y, m, 17),
      label: "KESTREL BROKERAGE CONTRIBUTION",
      amount: -MONTHLY_INVESTMENT,
      merchant: "Kestrel Brokerage",
      category: "Investment",
      accountKey: "checking",
      isTransfer: false,
    });
  }

  // ---- Finalise: sort, de-collide, number, and run balances ------------
  drafts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const seen = new Set<string>();
  const balances = new Map<DemoAccountKey, number>(
    DEMO_ACCOUNTS.map((a) => [a.key, a.openingBalance] as const),
  );
  const merchants = new Set<string>();
  const transactions: DemoTransaction[] = [];

  drafts.forEach((d, i) => {
    let description = describe(d);
    // Deterministic collision break: bump the store number (or append one).
    let bump = d.store ?? 0;
    while (seen.has(identity(d, description))) {
      bump += 1;
      description = `${d.label} #${bump}`;
    }
    seen.add(identity(d, description));

    const balance = addMoney(balances.get(d.accountKey)!, d.amount);
    balances.set(d.accountKey, balance);
    merchants.add(d.merchant);

    transactions.push({
      date: d.date,
      description,
      amount: d.amount,
      balance,
      type: d.amount >= 0 ? "credit" : "debit",
      refNumber: `DEMO-${String(i + 1).padStart(6, "0")}`,
      merchant: d.merchant,
      category: d.category,
      accountKey: d.accountKey,
      isTransfer: d.isTransfer,
      notes: d.notes,
    });
  });

  const from = transactions[0]?.date ?? anchor;
  const to = transactions[transactions.length - 1]?.date ?? anchor;

  return {
    seed,
    anchor,
    range: { from, to },
    accounts: DEMO_ACCOUNTS,
    merchants: [...merchants].sort(),
    transactions,
    budgets: buildBudgets(),
    goals: buildGoals(anchorYear, anchorMonth),
    assets: buildAssets(months, transactions, rng),
  };
}

/**
 * Limits are set slightly under the generated average for Dining and Shopping
 * so the Budgets screen shows real over-budget states rather than a wall of
 * green — an all-green demo teaches nothing.
 */
function buildBudgets(): DemoBudget[] {
  return [
    { category: "Groceries", monthlyLimit: 620 },
    { category: "Dining", monthlyLimit: 380 },
    { category: "Coffee", monthlyLimit: 70 },
    { category: "Shopping", monthlyLimit: 240 },
    { category: "Entertainment", monthlyLimit: 90 },
    { category: "Transportation", monthlyLimit: 300 },
    { category: "Subscriptions", monthlyLimit: 85 },
  ];
}

function buildGoals(anchorYear: number, anchorMonth: number): DemoGoal[] {
  return [
    { name: "Emergency fund", icon: "🛟", targetAmount: 18000, currentSaved: 11250, monthlyContribution: 800, deadline: null },
    {
      name: "Kyoto in spring",
      icon: "🌸",
      targetAmount: 6500,
      currentSaved: 2340,
      monthlyContribution: 275,
      deadline: ymd(anchorYear, anchorMonth + 14, 1),
    },
    { name: "Replace the roof", icon: "🏠", targetAmount: 14000, currentSaved: 3100, monthlyContribution: 250, deadline: null },
  ];
}

/**
 * Net-worth assets, with one snapshot per month so the history chart has a
 * curve rather than a dot.
 *
 * Two of them are derived from the transactions rather than invented, which is
 * what makes Net Worth agree with Transactions instead of quietly contradicting
 * it (PRINCIPLES rule 3 — every number auditable):
 *   - "Rainy Day Savings" tracks the savings account's month-end balance.
 *   - "Meridian Ember Credit Card" tracks the card's month-end balance.
 * The two loans are real amortisation schedules against the payments that
 * appear in the transaction list.
 */
function buildAssets(months: MonthRef[], transactions: DemoTransaction[], rng: Rng): DemoAsset[] {
  const monthEnds = months.map((mo) => ymd(mo.year, mo.month, daysInMonth(mo.year, mo.month)));

  /** Last known balance of `account` on or before each month end. */
  const trail = (account: DemoAccountKey): number[] => {
    const rows = transactions.filter((t) => t.accountKey === account);
    const opening = DEMO_ACCOUNTS.find((a) => a.key === account)!.openingBalance;
    return monthEnds.map((end) => {
      const upTo = rows.filter((t) => t.date <= end);
      return upTo.length ? upTo[upTo.length - 1].balance : opening;
    });
  };

  const snap = (values: number[]): DemoAssetSnapshot[] =>
    monthEnds
      .map((date, i) => ({ date, value: round2(Math.abs(values[i])) }))
      // The window may end mid-month; drop snapshots dated past the last txn.
      .filter((s) => s.date <= (transactions[transactions.length - 1]?.date ?? s.date));

  /** Straight amortisation: balance -= (payment - interest) each month. */
  const amortise = (start: number, annualRatePct: number, payment: number): number[] => {
    const monthly = annualRatePct / 100 / 12;
    let balance = start;
    return monthEnds.map(() => {
      const interest = round2(balance * monthly);
      balance = Math.max(0, round2(balance + interest - payment));
      return balance;
    });
  };

  const grow = (start: number, ratePerMonth: number, wobble: number): number[] => {
    let v = start;
    return monthEnds.map(() => {
      v = round2(v * (1 + ratePerMonth) * rng.float(1 - wobble, 1 + wobble));
      return v;
    });
  };

  // The index fund: units bought monthly at a wandering unit price.
  const unitPrices = grow(184.2, 0.0062, 0.021);
  let units = 96.4;
  const fundValues = unitPrices.map((price) => {
    units = round2(units + MONTHLY_INVESTMENT / price);
    return round2(units * price);
  });

  const savings = trail("savings");
  const card = trail("credit");
  const mortgage = amortise(284600, 5.85, 1940);
  const autoLoan = amortise(15800, 6.4, 385);
  const property = grow(372000, 0.0026, 0.004);
  const vehicle = grow(21500, -0.0104, 0.003);
  const retirement = grow(84500, 0.0071, 0.019);

  return [
    { name: "Rainy Day Savings (demo)", kind: "cash", isLiability: false, icon: "💵", units: null, unitPrice: null, ratePct: null, monthlyPayment: null, notes: "Mirrors the savings account balance.", snapshots: snap(savings) },
    { name: "Kestrel Broad Index Fund (demo)", kind: "investment", isLiability: false, icon: "📈", units: round2(units), unitPrice: round2(unitPrices[unitPrices.length - 1]), ratePct: null, monthlyPayment: null, notes: "Monthly contribution of $650.", snapshots: snap(fundValues) },
    { name: "Halberd & Vine Retirement Plan (demo)", kind: "investment", isLiability: false, icon: "🏦", units: null, unitPrice: null, ratePct: null, monthlyPayment: null, notes: "Employer plan, matched to 4%.", snapshots: snap(retirement) },
    { name: "12 Marlowe Lane (demo)", kind: "property", isLiability: false, icon: "🏠", units: null, unitPrice: null, ratePct: null, monthlyPayment: null, notes: null, snapshots: snap(property) },
    { name: "Ferndale Estate Wagon (demo)", kind: "vehicle", isLiability: false, icon: "🚗", units: null, unitPrice: null, ratePct: null, monthlyPayment: null, notes: null, snapshots: snap(vehicle) },
    { name: "Wrenfield Mortgage (demo)", kind: "mortgage", isLiability: true, icon: "🏦", units: null, unitPrice: null, ratePct: 5.85, monthlyPayment: 1940, notes: "Amortised against the payments in Transactions.", snapshots: snap(mortgage) },
    { name: "Alderpath Auto Loan (demo)", kind: "loan", isLiability: true, icon: "📄", units: null, unitPrice: null, ratePct: 6.4, monthlyPayment: 385, notes: null, snapshots: snap(autoLoan) },
    { name: "Meridian Ember Card (demo)", kind: "credit", isLiability: true, icon: "💳", units: null, unitPrice: null, ratePct: 22.9, monthlyPayment: null, notes: "Mirrors the card account balance.", snapshots: snap(card) },
  ];
}

// ---------------------------------------------------------------------------
// Hashes
// ---------------------------------------------------------------------------

/**
 * Attach dedupe hashes using the REAL import-pipeline hash function, so demo
 * rows are indistinguishable from imported ones and collide with a genuine
 * re-import exactly when they should.
 *
 * Account IDs only exist once the rows are in a database, so they are supplied
 * here rather than baked into the pure dataset. The account-key -> id mapping
 * is injective, so uniqueness over keys and uniqueness over ids are the same
 * property — which is why the test can prove it with synthetic ids.
 */
export function withHashes(
  transactions: readonly DemoTransaction[],
  accountIds: Record<DemoAccountKey, number>,
): (DemoTransaction & { hash: string })[] {
  return transactions.map((t) => ({
    ...t,
    hash: transactionHash({
      date: t.date,
      amount: t.amount,
      description: t.description,
      merchant: t.merchant,
      accountId: accountIds[t.accountKey],
    }),
  }));
}

// ---------------------------------------------------------------------------
// Summary maths (used by tests, the API response, and anyone auditing)
// ---------------------------------------------------------------------------

export interface DemoTotals {
  income: number;
  /** Everything out that is neither a transfer nor an investment. */
  expenses: number;
  investments: number;
  /** Sum of every transfer leg. Must be exactly 0. */
  transferNet: number;
  savingsRate: number;
}

/**
 * Mirrors the classifications in services/analyticsService.ts:
 * transfers are neither income nor spending; investments are contributions.
 */
export function summarise(transactions: readonly DemoTransaction[]): DemoTotals {
  const real = transactions.filter((t) => !t.isTransfer);
  const income = sumBy(
    real.filter((t) => t.amount > 0),
    (t) => t.amount,
  );
  const investments = Math.abs(
    sumBy(
      real.filter((t) => t.amount < 0 && t.category === "Investment"),
      (t) => t.amount,
    ),
  );
  const expenses = Math.abs(
    sumBy(
      real.filter((t) => t.amount < 0 && t.category !== "Investment"),
      (t) => t.amount,
    ),
  );
  const transferNet = sumBy(
    transactions.filter((t) => t.isTransfer),
    (t) => t.amount,
  );
  return {
    income,
    expenses,
    investments,
    transferNet,
    savingsRate: income > 0 ? round2((income - expenses) / income) : 0,
  };
}

// ---------------------------------------------------------------------------
// THE SAFETY GUARD
// ---------------------------------------------------------------------------

/**
 * What a profile currently holds. Cheap counts, nothing else.
 * Deliberately broad: a profile with no transactions but hand-entered assets
 * and goals is still somebody's real work, and must not be overwritten.
 */
export interface ProfileOccupancy {
  transactions: number;
  accounts: number;
  assets: number;
  goals: number;
  budgets: number;
  imports: number;
  /** True when this profile was itself created by demo mode. */
  isDemoProfile: boolean;
}

export type DemoDecision =
  | { allowed: true; reason: "empty" | "already-demo" }
  | { allowed: false; reason: "occupied"; message: string };

/**
 * The single decision that stands between a curious click and somebody's
 * irrecoverable financial history. Everything about it is deliberate:
 *
 *  - It is a PURE function of counts, so it can be tested exhaustively with no
 *    database, and there is no code path that writes without consulting it.
 *  - It fails CLOSED: any non-zero count that isn't explained by the demo
 *    marker is a refusal. There is no force flag, no `?confirm=1`, no
 *    "advanced" override. If someone truly wants the demo in a used profile,
 *    the answer is a new profile — which costs one click and destroys nothing.
 *  - The demo marker is what makes RELOAD and RESET possible: a profile that
 *    demo mode created is a profile demo mode is allowed to wipe. Nothing else
 *    is.
 *  - The refusal message says what to do instead, because a dead end is a bug.
 */
export function demoLoadDecision(o: ProfileOccupancy): DemoDecision {
  if (o.isDemoProfile) return { allowed: true, reason: "already-demo" };

  const holdings: string[] = [];
  if (o.transactions > 0) holdings.push(`${o.transactions.toLocaleString("en-US")} transactions`);
  if (o.accounts > 0) holdings.push(`${o.accounts} account${o.accounts === 1 ? "" : "s"}`);
  if (o.assets > 0) holdings.push(`${o.assets} net-worth entries`);
  if (o.goals > 0) holdings.push(`${o.goals} goal${o.goals === 1 ? "" : "s"}`);
  if (o.budgets > 0) holdings.push(`${o.budgets} budget${o.budgets === 1 ? "" : "s"}`);
  if (o.imports > 0) holdings.push(`${o.imports} import${o.imports === 1 ? "" : "s"}`);

  if (holdings.length === 0) return { allowed: true, reason: "empty" };

  return {
    allowed: false,
    reason: "occupied",
    message:
      `This profile already holds ${holdings.join(", ")}. Demo data is never written over real data. ` +
      `Load the demo into the separate "demo" profile instead (it lives in its own database file), ` +
      `or create a new empty profile from the account menu and load it there.`,
  };
}

/** Thrown when the guard refuses. The route turns this into a 409. */
export class DemoRefusedError extends Error {
  readonly code = "DEMO_TARGET_NOT_EMPTY";
  constructor(message: string) {
    super(message);
    this.name = "DemoRefusedError";
  }
}

// ---------------------------------------------------------------------------
// The write layer — deliberately thin
// ---------------------------------------------------------------------------

type DbFn = (...args: any[]) => Promise<any>;

/**
 * The slice of PrismaClient the writer touches, injected rather than imported
 * so (a) the caller decides which profile's database this is, and (b) tests can
 * pass a small in-memory fake and exercise the guard for real.
 *
 * The signatures are loose because Prisma's generated delegates are heavily
 * overloaded; a precise structural type would not accept the real client.
 */
export interface DemoDb {
  account: { count: DbFn; create: DbFn; deleteMany: DbFn };
  category: { findMany: DbFn };
  merchant: { create: DbFn; deleteMany: DbFn };
  transaction: { count: DbFn; createMany: DbFn; deleteMany: DbFn };
  budget: { count: DbFn; createMany: DbFn; deleteMany: DbFn };
  goal: { count: DbFn; createMany: DbFn; deleteMany: DbFn };
  asset: { count: DbFn; create: DbFn; deleteMany: DbFn };
  assetSnapshot: { createMany: DbFn; deleteMany: DbFn };
  import: { count: DbFn; create: DbFn; deleteMany: DbFn };
  setting: { findMany: DbFn; upsert: DbFn; deleteMany: DbFn };
}

// Setting keys are declared in shared/demo.ts so the client can refer to the
// same strings without a second source of truth.
const DEMO_MARKER = DEMO_MARKER_KEY;
const DEMO_SEED_SETTING = DEMO_SEED_KEY;
const DEMO_GENERATED_AT_SETTING = DEMO_GENERATED_AT_KEY;
const DEMO_RANGE_SETTING = "demoRange";

/** SQLite is happiest with modest batches; this keeps parameter counts sane. */
const BATCH = 100;

async function insertMany(model: { createMany: DbFn }, rows: unknown[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await model.createMany({ data: rows.slice(i, i + BATCH) });
  }
}

/** Read what this profile holds. One place, so the guard can't be bypassed. */
export async function readOccupancy(db: DemoDb): Promise<ProfileOccupancy> {
  const settings: { key: string; value: string }[] = await db.setting.findMany();
  return {
    transactions: await db.transaction.count(),
    accounts: await db.account.count(),
    assets: await db.asset.count(),
    goals: await db.goal.count(),
    budgets: await db.budget.count(),
    imports: await db.import.count(),
    isDemoProfile: settings.some((s) => s.key === DEMO_MARKER && s.value === "1"),
  };
}

/**
 * Delete the demo-owned rows. Only ever called after `demoLoadDecision`
 * allowed the write, i.e. the profile is empty or is itself a demo profile.
 * Categories, rules and preferences are left alone — those are seedDefaults'
 * territory and are identical in every profile.
 */
async function wipe(db: DemoDb): Promise<void> {
  // FK-safe order, mirroring createProfile() in lib/prisma.ts.
  await db.transaction.deleteMany();
  await db.import.deleteMany();
  await db.budget.deleteMany();
  await db.goal.deleteMany();
  await db.assetSnapshot.deleteMany();
  await db.asset.deleteMany();
  await db.merchant.deleteMany();
  await db.account.deleteMany();
}

export interface DemoLoadOutcome {
  seed: number;
  range: { from: string; to: string };
  generatedAt: string;
  counts: DemoCounts;
}

/**
 * Generate and write the demo dataset into `db`.
 *
 * Refuses (throws DemoRefusedError) unless `demoLoadDecision` allows it. The
 * check happens here, immediately before the first write, against counts read
 * from this exact database handle — not against something the caller passed
 * in, and not somewhere earlier in the request where the target could still
 * change.
 */
export async function loadDemoInto(
  db: DemoDb,
  options: GenerateOptions & { now?: Date } = {},
): Promise<DemoLoadOutcome> {
  const occupancy = await readOccupancy(db);
  const decision = demoLoadDecision(occupancy);
  if (!decision.allowed) throw new DemoRefusedError(decision.message);

  const anchor = options.anchor ?? options.now ?? new Date();
  const data = generateDemoData({ seed: options.seed, anchor });

  await wipe(db);

  // Accounts first — transactions need their ids, and so does the hash.
  const accountIds = {} as Record<DemoAccountKey, number>;
  for (const a of data.accounts) {
    const row = await db.account.create({ data: { name: a.name, type: a.type, currency: "USD" } });
    accountIds[a.key] = row.id;
  }

  const merchantIds = new Map<string, number>();
  for (const name of data.merchants) {
    const row = await db.merchant.create({ data: { name } });
    merchantIds.set(name, row.id);
  }

  const categories: { id: number; name: string }[] = await db.category.findMany();
  const categoryIds = new Map(categories.map((c) => [c.name, c.id]));

  // A single Import row, so the demo data is attributable in Settings ->
  // Imports and removable the same way any other import is.
  const imp = await db.import.create({
    data: {
      filename: `ikid-demo-dataset (seed ${data.seed})`,
      fileType: "demo",
      status: "completed",
      transactionCount: data.transactions.length,
      duplicateCount: 0,
      accountId: accountIds.checking,
    },
  });

  const hashed = withHashes(data.transactions, accountIds);
  await insertMany(
    db.transaction,
    hashed.map((t) => ({
      date: new Date(`${t.date}T00:00:00.000Z`),
      description: t.description,
      amount: t.amount,
      balance: t.balance,
      type: t.type,
      refNumber: t.refNumber,
      notes: t.notes,
      hash: t.hash,
      isTransfer: t.isTransfer,
      categoryId: categoryIds.get(t.category) ?? categoryIds.get("Unknown") ?? null,
      merchantId: merchantIds.get(t.merchant) ?? null,
      accountId: accountIds[t.accountKey],
      importId: imp.id,
    })),
  );

  await insertMany(
    db.budget,
    data.budgets
      .filter((b) => categoryIds.has(b.category))
      .map((b) => ({ categoryId: categoryIds.get(b.category)!, monthlyLimit: b.monthlyLimit })),
  );

  await insertMany(
    db.goal,
    data.goals.map((g) => ({
      name: g.name,
      icon: g.icon,
      targetAmount: g.targetAmount,
      currentSaved: g.currentSaved,
      monthlyContribution: g.monthlyContribution,
      deadline: g.deadline ? new Date(`${g.deadline}T00:00:00.000Z`) : null,
    })),
  );

  let snapshotCount = 0;
  for (const a of data.assets) {
    const row = await db.asset.create({
      data: {
        name: a.name,
        kind: a.kind,
        isLiability: a.isLiability,
        icon: a.icon,
        units: a.units,
        unitPrice: a.unitPrice,
        ratePct: a.ratePct,
        monthlyPayment: a.monthlyPayment,
        notes: a.notes,
      },
    });
    await insertMany(
      db.assetSnapshot,
      a.snapshots.map((s) => ({
        assetId: row.id,
        date: new Date(`${s.date}T00:00:00.000Z`),
        value: s.value,
      })),
    );
    snapshotCount += a.snapshots.length;
  }

  // The marker is written LAST, so a crash mid-load leaves a profile that the
  // guard treats as occupied-but-not-demo rather than one it will happily wipe.
  // (Reset from the UI is then refused with a clear message, which is the safe
  // failure: the user creates a fresh profile instead of us guessing.)
  const generatedAt = new Date().toISOString();
  const marks: [string, string][] = [
    [DEMO_SEED_SETTING, String(data.seed)],
    [DEMO_GENERATED_AT_SETTING, generatedAt],
    [DEMO_RANGE_SETTING, `${data.range.from}..${data.range.to}`],
    [DEMO_MARKER, "1"],
  ];
  for (const [key, value] of marks) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  return {
    seed: data.seed,
    range: data.range,
    generatedAt,
    counts: {
      accounts: data.accounts.length,
      transactions: data.transactions.length,
      merchants: data.merchants.length,
      budgets: data.budgets.length,
      goals: data.goals.length,
      assets: data.assets.length,
      assetSnapshots: snapshotCount,
    },
  };
}

export interface DemoProfileState {
  isDemo: boolean;
  seed: number | null;
  generatedAt: string | null;
  range: { from: string; to: string } | null;
  occupancy: ProfileOccupancy;
}

/** Everything the status endpoint and the UI banner need, in one round trip. */
export async function readDemoState(db: DemoDb): Promise<DemoProfileState> {
  const settings: { key: string; value: string }[] = await db.setting.findMany();
  const get = (k: string) => settings.find((s) => s.key === k)?.value ?? null;
  const isDemo = get(DEMO_MARKER) === "1";
  const rawRange = get(DEMO_RANGE_SETTING);
  const [from, to] = (rawRange ?? "").split("..");
  const seed = get(DEMO_SEED_SETTING);
  return {
    isDemo,
    seed: seed != null && seed !== "" ? Number(seed) : null,
    generatedAt: get(DEMO_GENERATED_AT_SETTING),
    range: isDemo && from && to ? { from, to } : null,
    occupancy: await readOccupancy(db),
  };
}

/**
 * Reset: wipe and regenerate. Refuses on anything that is not already a demo
 * profile — reset is the more dangerous of the two operations (it deletes
 * unconditionally where load only adds), so its guard is the stricter one.
 */
export async function resetDemoIn(
  db: DemoDb,
  options: GenerateOptions = {},
): Promise<DemoLoadOutcome> {
  const occupancy = await readOccupancy(db);
  if (!occupancy.isDemoProfile) {
    throw new DemoRefusedError(
      "This profile was not created by demo mode, so there is no demo data to reset. " +
        "Reset only ever touches a profile that demo mode generated.",
    );
  }
  return loadDemoInto(db, options);
}
