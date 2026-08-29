/**
 * Demo mode.
 *
 * Two things are being defended here, in order of importance:
 *
 *  1. THE GUARD. Loading demo data over somebody's real transactions would be
 *     unrecoverable — there is no undo, and a personal finance app that eats
 *     your history once never gets trusted again. The guard is a pure function
 *     of row counts, and the writer consults it immediately before its first
 *     write, so it is provable without a database. Both halves are tested:
 *     the decision itself, and the writer refusing to touch a fake database
 *     that already holds something.
 *
 *  2. THE DATA. The generated dataset has to satisfy the same accounting
 *     invariants the app's own maths assumes (signed amounts, transfers
 *     excluded from totals, unique dedupe hashes). If it doesn't, every screen
 *     in the demo lies subtly, which is worse than no demo at all.
 *
 * Everything runs against pure functions and an in-memory fake, so this file
 * needs no database and no Prisma engine.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../services/defaults.js";
import { transactionHash } from "../services/dedupe.js";
import { addMoney, round2, sumBy } from "../services/money.js";
import {
  DEMO_ACCOUNTS,
  DEMO_MONTHS,
  DemoRefusedError,
  demoLoadDecision,
  generateDemoData,
  loadDemoInto,
  mulberry32,
  readDemoState,
  resetDemoIn,
  summarise,
  withHashes,
  type DemoAccountKey,
  type ProfileOccupancy,
} from "../services/demoData.js";
import { DEMO_MARKER_KEY, DEMO_SEED } from "../../../shared/demo.js";

/** A fixed "today" so every assertion below is reproducible. */
const ANCHOR = new Date(Date.UTC(2026, 5, 18)); // 18 June 2026
const data = generateDemoData({ seed: DEMO_SEED, anchor: ANCHOR });
const txns = data.transactions;

const ACCOUNT_IDS: Record<DemoAccountKey, number> = { checking: 1, savings: 2, credit: 3 };

const EMPTY: ProfileOccupancy = {
  transactions: 0,
  accounts: 0,
  assets: 0,
  goals: 0,
  budgets: 0,
  imports: 0,
  isDemoProfile: false,
};

// ---------------------------------------------------------------------------
// 1. The safety guard
// ---------------------------------------------------------------------------

describe("demoLoadDecision — the guard against overwriting real data", () => {
  it("allows a completely empty profile", () => {
    expect(demoLoadDecision(EMPTY)).toEqual({ allowed: true, reason: "empty" });
  });

  it("refuses a profile holding transactions", () => {
    const d = demoLoadDecision({ ...EMPTY, transactions: 1204, accounts: 3 });
    expect(d.allowed).toBe(false);
  });

  it("the refusal says what the user should do instead", () => {
    const d = demoLoadDecision({ ...EMPTY, transactions: 1204 });
    if (d.allowed) throw new Error("expected a refusal");
    // A dead end is a bug: the message has to name the way forward.
    expect(d.message).toContain("1,204 transactions");
    expect(d.message).toMatch(/never written over real data/i);
    expect(d.message).toMatch(/"demo" profile/);
    expect(d.message).toMatch(/new empty profile/i);
  });

  it("refuses on anything else a user may have entered by hand", () => {
    // A profile with no imported transactions can still hold real work:
    // hand-entered net-worth assets, goals, budgets, or an empty account.
    for (const field of ["accounts", "assets", "goals", "budgets", "imports"] as const) {
      const d = demoLoadDecision({ ...EMPTY, [field]: 2 });
      expect(d.allowed, `expected ${field}=2 to be refused`).toBe(false);
    }
  });

  it("fails closed — only an all-zero profile is treated as empty", () => {
    const d = demoLoadDecision({ ...EMPTY, transactions: 0, accounts: 0, assets: 1 });
    expect(d.allowed).toBe(false);
  });

  it("allows a profile demo mode created, so reload and reset can work", () => {
    const busyDemo = { ...EMPTY, transactions: 1400, accounts: 3, isDemoProfile: true };
    expect(demoLoadDecision(busyDemo)).toEqual({ allowed: true, reason: "already-demo" });
  });
});

// A minimal in-memory stand-in for the slice of Prisma the writer uses.
// Small on purpose: the writer's whole database surface is visible right here.
function makeFakeDb(preload: Partial<Record<string, unknown[]>> = {}) {
  const store: Record<string, any[]> = {
    account: [],
    merchant: [],
    transaction: [],
    budget: [],
    goal: [],
    asset: [],
    assetSnapshot: [],
    import: [],
    setting: [],
    ...preload,
  };
  let nextId = 0;
  const model = (name: string) => ({
    count: async () => store[name].length,
    findMany: async () => store[name],
    create: async ({ data: row }: any) => {
      const created = { id: ++nextId, ...row };
      store[name].push(created);
      return created;
    },
    createMany: async ({ data: rows }: any) => {
      for (const row of rows) store[name].push({ id: ++nextId, ...row });
      return { count: rows.length };
    },
    deleteMany: async () => {
      const count = store[name].length;
      store[name] = [];
      return { count };
    },
    upsert: async ({ where, create, update }: any) => {
      const found = store[name].find((r) => r.key === where.key);
      if (found) return Object.assign(found, update);
      const created = { ...create };
      store[name].push(created);
      return created;
    },
  });
  const db = {
    account: model("account"),
    merchant: model("merchant"),
    transaction: model("transaction"),
    budget: model("budget"),
    goal: model("goal"),
    asset: model("asset"),
    assetSnapshot: model("assetSnapshot"),
    import: model("import"),
    setting: model("setting"),
    category: {
      findMany: async () => DEFAULT_CATEGORIES.map((c, i) => ({ id: i + 1, name: c.name })),
    },
  };
  return { db, store };
}

describe("loadDemoInto — the writer refuses before it writes", () => {
  it("writes nothing at all into a profile holding real transactions", async () => {
    const { db, store } = makeFakeDb({
      transaction: [{ id: 1, description: "PAYCHECK", amount: 2400 }],
      account: [{ id: 1, name: "My real checking" }],
    });

    await expect(loadDemoInto(db, { anchor: ANCHOR })).rejects.toBeInstanceOf(DemoRefusedError);

    // The important assertion: the refusal happened BEFORE any mutation.
    expect(store.transaction).toHaveLength(1);
    expect(store.transaction[0].description).toBe("PAYCHECK");
    expect(store.account).toHaveLength(1);
    expect(store.merchant).toHaveLength(0);
    expect(store.asset).toHaveLength(0);
    expect(store.setting).toHaveLength(0);
  });

  it("refuses a profile that only holds hand-entered net-worth assets", async () => {
    const { db, store } = makeFakeDb({ asset: [{ id: 1, name: "The house" }] });
    await expect(loadDemoInto(db, { anchor: ANCHOR })).rejects.toBeInstanceOf(DemoRefusedError);
    expect(store.asset).toHaveLength(1);
    expect(store.transaction).toHaveLength(0);
  });

  it("accepts an empty profile and writes the whole dataset", async () => {
    const { db, store } = makeFakeDb();
    const outcome = await loadDemoInto(db, { anchor: ANCHOR });

    expect(store.account).toHaveLength(DEMO_ACCOUNTS.length);
    expect(store.transaction).toHaveLength(txns.length);
    expect(store.budget.length).toBeGreaterThan(0);
    expect(store.goal.length).toBeGreaterThan(0);
    expect(store.asset.length).toBeGreaterThan(0);
    expect(store.assetSnapshot.length).toBeGreaterThan(0);
    expect(store.import).toHaveLength(1);
    expect(outcome.counts.transactions).toBe(txns.length);
    expect(outcome.seed).toBe(DEMO_SEED);
  });

  it("marks the profile so the banner and the reset guard can recognise it", async () => {
    const { db, store } = makeFakeDb();
    await loadDemoInto(db, { anchor: ANCHOR });
    expect(store.setting).toContainEqual({ key: DEMO_MARKER_KEY, value: "1" });
    // The marker is written last, so a crash mid-load cannot leave a profile
    // that a later reset would happily wipe.
    expect(store.setting[store.setting.length - 1].key).toBe(DEMO_MARKER_KEY);

    const state = await readDemoState(db);
    expect(state.isDemo).toBe(true);
    expect(state.seed).toBe(DEMO_SEED);
    expect(state.range).toEqual(data.range);
  });

  it("every written transaction points at a real account and category", async () => {
    const { db, store } = makeFakeDb();
    await loadDemoInto(db, { anchor: ANCHOR });
    const accountIds = new Set(store.account.map((a) => a.id));
    const categoryIds = new Set(DEFAULT_CATEGORIES.map((_, i) => i + 1));
    for (const t of store.transaction) {
      expect(accountIds.has(t.accountId)).toBe(true);
      expect(categoryIds.has(t.categoryId)).toBe(true);
      expect(t.merchantId).not.toBeNull();
      expect(t.importId).toBe(store.import[0].id);
    }
  });
});

describe("resetDemoIn — the stricter guard", () => {
  it("refuses a profile demo mode did not create, even an empty one", async () => {
    const { db, store } = makeFakeDb();
    await expect(resetDemoIn(db, { anchor: ANCHOR })).rejects.toBeInstanceOf(DemoRefusedError);
    expect(store.transaction).toHaveLength(0);
  });

  it("refuses a profile full of real data", async () => {
    const { db } = makeFakeDb({ transaction: [{ id: 1, amount: -20 }] });
    await expect(resetDemoIn(db, { anchor: ANCHOR })).rejects.toThrow(/not created by demo mode/i);
  });

  it("regenerates a demo profile to exactly the same rows", async () => {
    const { db, store } = makeFakeDb();
    await loadDemoInto(db, { anchor: ANCHOR });
    // Compare the business content, not the dedupe hash. The hash is derived
    // partly from accountId, which is an autoincrement surrogate key: wiping
    // and reinserting hands out fresh ids, so the hashes legitimately differ
    // even though every meaningful field is identical. Asserting on them would
    // be testing SQLite's counter, and would fail for a reason that tells you
    // nothing about whether the demo is reproducible.
    // Merchant and account ids are surrogate keys too, so resolve them back to
    // names before comparing — otherwise this just re-tests the id counter.
    const snapshot = () => {
      const merchantName = new Map(store.merchant.map((m) => [m.id, m.name]));
      const accountName = new Map(store.account.map((a) => [a.id, a.name]));
      return store.transaction.map((t) =>
        [
          t.date.toISOString(),
          t.amount,
          t.description,
          merchantName.get(t.merchantId ?? -1) ?? "—",
          accountName.get(t.accountId ?? -1) ?? "—",
          t.isTransfer,
        ].join("|"),
      );
    };
    const before = snapshot();

    await resetDemoIn(db, { anchor: ANCHOR });
    const after = snapshot();

    expect(after).toEqual(before); // same seed, same anchor, same data
    expect(store.transaction).toHaveLength(before.length); // wiped, not doubled
    expect(store.account).toHaveLength(DEMO_ACCOUNTS.length);
    // Hashes must still be internally unique, or duplicate detection would
    // silently swallow demo rows on a later import.
    const hashes = store.transaction.map((t) => t.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("generates byte-identical data for the same seed and anchor", () => {
    // The reproducibility claim itself, stated without any database in the way:
    // same inputs, same output, every field.
    const a = generateDemoData({ anchor: ANCHOR });
    const b = generateDemoData({ anchor: ANCHOR });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

// ---------------------------------------------------------------------------
// 2. Deterministic generation
// ---------------------------------------------------------------------------

describe("mulberry32", () => {
  it("is deterministic and stays inside [0, 1)", () => {
    const a = mulberry32(DEMO_SEED);
    const b = mulberry32(DEMO_SEED);
    for (let i = 0; i < 500; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds give different streams", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("generateDemoData is deterministic", () => {
  it("same seed + same anchor produces a byte-identical dataset", () => {
    const a = generateDemoData({ seed: DEMO_SEED, anchor: ANCHOR });
    const b = generateDemoData({ seed: DEMO_SEED, anchor: ANCHOR });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("a different seed produces different data", () => {
    const other = generateDemoData({ seed: DEMO_SEED + 1, anchor: ANCHOR });
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(data));
    expect(other.seed).toBe(DEMO_SEED + 1);
  });

  it("does not read the clock — the anchor is an argument", () => {
    const earlier = generateDemoData({ seed: DEMO_SEED, anchor: new Date(Date.UTC(2025, 0, 31)) });
    expect(earlier.range.to <= "2025-01-31").toBe(true);
    expect(earlier.anchor).toBe("2025-01-31");
  });
});

// ---------------------------------------------------------------------------
// 3. Accounting invariants — the ones the app's own maths depends on
// ---------------------------------------------------------------------------

describe("dataset invariants", () => {
  it("has a substantial history to plot", () => {
    expect(txns.length).toBeGreaterThan(700);
    const months = new Set(txns.map((t) => t.date.slice(0, 7)));
    expect(months.size).toBe(DEMO_MONTHS);
  });

  it("dates are ordered, inside the stated range, and never in the future", () => {
    for (let i = 1; i < txns.length; i++) {
      expect(txns[i - 1].date <= txns[i].date).toBe(true);
    }
    expect(txns[0].date).toBe(data.range.from);
    expect(txns[txns.length - 1].date).toBe(data.range.to);
    for (const t of txns) {
      expect(t.date >= data.range.from).toBe(true);
      expect(t.date <= data.anchor).toBe(true);
      expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("amounts are signed, non-zero, and the debit/credit type agrees", () => {
    for (const t of txns) {
      expect(t.amount).not.toBe(0);
      expect(round2(t.amount)).toBe(t.amount); // whole cents, no float dust
      expect(t.type).toBe(t.amount >= 0 ? "credit" : "debit");
    }
  });

  it("every dedupe hash is unique", () => {
    const hashed = withHashes(txns, ACCOUNT_IDS);
    const hashes = new Set(hashed.map((t) => t.hash));
    expect(hashes.size).toBe(txns.length);
  });

  it("hashes are the ones the real import pipeline would compute", () => {
    const [first] = withHashes(txns, ACCOUNT_IDS);
    expect(first.hash).toBe(
      transactionHash({
        date: first.date,
        amount: first.amount,
        description: first.description,
        merchant: first.merchant,
        accountId: ACCOUNT_IDS[first.accountKey],
      }),
    );
  });

  it("transfers net to exactly zero, and pair up on the same day", () => {
    const totals = summarise(txns);
    expect(totals.transferNet).toBe(0);

    const byDay = new Map<string, number>();
    for (const t of txns.filter((x) => x.isTransfer)) {
      byDay.set(t.date, addMoney(byDay.get(t.date) ?? 0, t.amount));
    }
    for (const [day, net] of byDay) {
      expect(net, `transfers on ${day} should net to zero`).toBe(0);
    }
    expect(byDay.size).toBeGreaterThan(20);
  });

  it("credit-card payments are flagged as transfers on both legs", () => {
    const payments = txns.filter((t) => /CARD PAYMENT|PAYMENT RECEIVED/.test(t.description));
    expect(payments.length).toBeGreaterThan(20);
    for (const p of payments) expect(p.isTransfer).toBe(true);
    // Money leaving checking must equal money landing on the card.
    const out = sumBy(payments.filter((p) => p.accountKey === "checking"), (p) => p.amount);
    const inn = sumBy(payments.filter((p) => p.accountKey === "credit"), (p) => p.amount);
    expect(addMoney(out, inn)).toBe(0);
  });

  it("income beats expenses by a believable margin", () => {
    const totals = summarise(txns);
    expect(totals.income).toBeGreaterThan(totals.expenses);
    // A demo with a 70% savings rate is as useless as one that is broke.
    expect(totals.savingsRate).toBeGreaterThan(0.1);
    expect(totals.savingsRate).toBeLessThan(0.45);
    expect(totals.investments).toBeGreaterThan(0);
  });

  it("running balances are consistent with the amounts", () => {
    // Auditability: a reader can add up the column and get the balance shown.
    for (const acct of DEMO_ACCOUNTS) {
      let running = acct.openingBalance;
      for (const t of txns.filter((x) => x.accountKey === acct.key)) {
        running = addMoney(running, t.amount);
        expect(t.balance).toBe(running);
      }
    }
  });

  it("the everyday account never goes overdrawn", () => {
    const checking = txns.filter((t) => t.accountKey === "checking");
    expect(Math.min(...checking.map((t) => t.balance))).toBeGreaterThan(0);
  });

  it("only uses categories that seedDefaults creates", () => {
    const known = new Set(DEFAULT_CATEGORIES.map((c) => c.name));
    for (const t of txns) expect(known.has(t.category), `unknown category ${t.category}`).toBe(true);
    for (const b of data.budgets) expect(known.has(b.category)).toBe(true);
  });
});

describe("the data is interesting enough to be worth looking at", () => {
  const spendIn = (category: string) =>
    Math.abs(sumBy(txns.filter((t) => t.category === category && !t.isTransfer), (t) => t.amount));

  it("covers the categories every screen needs", () => {
    for (const c of ["Salary", "Groceries", "Dining", "Coffee", "Housing", "Utilities", "Subscriptions", "Travel", "Investment"]) {
      expect(spendIn(c), `no activity in ${c}`).toBeGreaterThan(0);
    }
  });

  it("has one subscription that changes price and one that stops", () => {
    const lumen = txns.filter((t) => t.merchant === "Lumenflix");
    const prices = [...new Set(lumen.map((t) => t.amount))].sort((a, b) => a - b);
    expect(prices).toEqual([-18.99, -15.99]);
    // The rise happens once, and never reverts.
    const lastOld = lumen.filter((t) => t.amount === -15.99).at(-1)!.date;
    const firstNew = lumen.filter((t) => t.amount === -18.99)[0].date;
    expect(firstNew > lastOld).toBe(true);

    const quillbox = txns.filter((t) => t.merchant === "Quillbox Storage");
    expect(quillbox.length).toBeGreaterThan(10);
    // Cancelled: nothing in the final stretch of the window.
    expect(quillbox.at(-1)!.date < data.range.to.slice(0, 7) + "-01").toBe(true);
    const gapMonths = new Set(
      txns.filter((t) => t.date > quillbox.at(-1)!.date).map((t) => t.date.slice(0, 7)),
    );
    expect(gapMonths.size).toBeGreaterThanOrEqual(5);
  });

  it("has seasonal variation and memorable one-offs", () => {
    const power = txns.filter((t) => t.merchant === "Cindermill Power").map((t) => Math.abs(t.amount));
    expect(Math.max(...power) / Math.min(...power)).toBeGreaterThan(1.4);

    const big = txns.filter((t) => t.amount <= -800 && !t.isTransfer);
    expect(big.length).toBeGreaterThanOrEqual(5);
    expect(big.some((t) => t.notes != null)).toBe(true); // auditable: says why
  });

  it("has salary arriving twice a month, with a raise along the way", () => {
    const pay = txns.filter((t) => t.category === "Salary" && t.description.includes("PAYROLL"));
    expect(pay.length).toBeGreaterThanOrEqual(DEMO_MONTHS * 2 - 2);
    const amounts = [...new Set(pay.map((t) => t.amount))];
    expect(amounts.length).toBe(2); // before and after the raise
  });
});

describe("net worth, budgets and goals", () => {
  it("gives every asset a dated snapshot history in range", () => {
    expect(data.assets.length).toBeGreaterThanOrEqual(6);
    expect(data.assets.some((a) => a.isLiability)).toBe(true);
    expect(data.assets.some((a) => !a.isLiability)).toBe(true);
    for (const a of data.assets) {
      expect(a.snapshots.length).toBeGreaterThanOrEqual(18);
      for (let i = 1; i < a.snapshots.length; i++) {
        expect(a.snapshots[i - 1].date < a.snapshots[i].date).toBe(true);
      }
      for (const s of a.snapshots) {
        // Snapshot values are always positive; the sign comes from isLiability.
        expect(s.value).toBeGreaterThanOrEqual(0);
        expect(s.date <= data.anchor).toBe(true);
      }
    }
  });

  it("amortises the mortgage downwards rather than inventing numbers", () => {
    const m = data.assets.find((a) => a.kind === "mortgage")!;
    expect(m.ratePct).toBeGreaterThan(0);
    expect(m.monthlyPayment).toBeGreaterThan(0);
    for (let i = 1; i < m.snapshots.length; i++) {
      expect(m.snapshots[i].value).toBeLessThan(m.snapshots[i - 1].value);
    }
  });

  it("net worth is positive and growing", () => {
    const at = (i: number) =>
      sumBy(data.assets, (a) => {
        const s = a.snapshots[i] ?? a.snapshots.at(-1)!;
        return a.isLiability ? -s.value : s.value;
      });
    expect(at(0)).toBeGreaterThan(0);
    expect(at(data.assets[0].snapshots.length - 1)).toBeGreaterThan(at(0));
  });

  it("sets budgets that are sometimes exceeded, so the screen teaches something", () => {
    expect(data.budgets.length).toBeGreaterThanOrEqual(5);
    const monthsOver = new Set<string>();
    for (const b of data.budgets) {
      const byMonth = new Map<string, number>();
      for (const t of txns.filter((t) => t.category === b.category && t.amount < 0)) {
        const key = t.date.slice(0, 7);
        byMonth.set(key, addMoney(byMonth.get(key) ?? 0, -t.amount));
      }
      for (const [month, spent] of byMonth) {
        if (spent > b.monthlyLimit) monthsOver.add(`${b.category} ${month}`);
      }
    }
    expect(monthsOver.size).toBeGreaterThan(0);
  });

  it("has goals with sensible progress, one of them dated", () => {
    expect(data.goals.length).toBeGreaterThanOrEqual(2);
    for (const g of data.goals) {
      expect(g.currentSaved).toBeGreaterThan(0);
      expect(g.currentSaved).toBeLessThan(g.targetAmount);
      expect(g.monthlyContribution).toBeGreaterThan(0);
    }
    expect(data.goals.some((g) => g.deadline != null)).toBe(true);
  });
});

describe("the world is obviously invented", () => {
  it("uses no real company names", () => {
    // Not exhaustive — it is a tripwire for the most likely slip.
    const real = [
      "amazon", "netflix", "spotify", "uber", "lyft", "starbucks", "kroger", "costco",
      "walmart", "target", "apple", "google", "chase", "visa", "paypal", "venmo",
      "comcast", "xfinity", "verizon", "t-mobile", "at&t", "shell", "chevron", "exxon",
      "vanguard", "fidelity", "geico", "doordash", "instacart", "delta", "united",
    ];
    const haystack = [
      ...data.merchants,
      ...data.accounts.map((a) => a.name),
      ...data.assets.map((a) => a.name),
      ...txns.map((t) => t.description),
    ]
      .join(" | ")
      .toLowerCase();
    for (const brand of real) {
      expect(haystack.includes(brand), `found a real brand name: ${brand}`).toBe(false);
    }
  });

  it("labels the accounts as demo, since account names show up everywhere", () => {
    for (const a of data.accounts) expect(a.name).toContain("(demo)");
  });

  it("lists every merchant it actually used, exactly once", () => {
    expect(new Set(data.merchants).size).toBe(data.merchants.length);
    expect(new Set(txns.map((t) => t.merchant))).toEqual(new Set(data.merchants));
  });
});

// ---------------------------------------------------------------------------
// 4. The colours the demo banner introduces
// ---------------------------------------------------------------------------

/** WCAG relative luminance — same formula as tests/contrast.test.ts. */
function luminance(hex: string): number {
  const rgb = hex
    .replace("#", "")
    .match(/../g)!
    .map((h) => {
      const v = parseInt(h, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("DemoBanner colour pairs meet WCAG AA", () => {
  // Values copied from client/tailwind.config.js.
  const amber = { 50: "#fdf6e8", 300: "#e0ad55", 600: "#9a6a10", 800: "#6a480d" };
  const slate = { 300: "#d7d3d3", 700: "#565252", 900: "#201e1d", 950: "#161514" };
  const WHITE = "#ffffff";

  const text: [string, string, string][] = [
    ["heading, light", amber[800], amber[50]],
    ["body, light", slate[700], amber[50]],
    ["chip, light", WHITE, amber[800]],
    ["heading, dark", amber[300], slate[900]],
    ["body, dark", slate[300], slate[900]],
    ["chip, dark", slate[950], amber[300]],
  ];
  for (const [name, fg, bg] of text) {
    it(`${name} clears 4.5:1`, () => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("the 2px accent rule clears the 3:1 non-text floor", () => {
    expect(contrast(amber[600], amber[50])).toBeGreaterThanOrEqual(3);
    expect(contrast(amber[300], slate[900])).toBeGreaterThanOrEqual(3);
  });

  it("amber is not the brand accent, so demo never reads as a primary action", () => {
    expect(amber[800]).not.toBe("#c62f14");
  });
});
