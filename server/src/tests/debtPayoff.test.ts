import { describe, expect, it } from "vitest";
import {
  comparePayoff, prioritise, simulatePayoff, type Debt,
} from "../services/debtPayoff.js";

/** Three debts chosen so snowball and avalanche disagree about the order. */
const DEBTS: Debt[] = [
  { name: "Card A", balance: 5000, ratePct: 22.9, minPayment: 100 }, // highest rate
  { name: "Card B", balance: 800, ratePct: 12.0, minPayment: 25 },   // smallest balance
  { name: "Car loan", balance: 9000, ratePct: 6.5, minPayment: 220 },
];

describe("prioritise", () => {
  it("avalanche targets the highest rate, snowball the smallest balance", () => {
    expect(prioritise(DEBTS, "avalanche").map((d) => d.name)).toEqual(["Card A", "Card B", "Car loan"]);
    expect(prioritise(DEBTS, "snowball").map((d) => d.name)).toEqual(["Card B", "Card A", "Car loan"]);
  });

  it("breaks ties by name so the plan never depends on input order", () => {
    const tied: Debt[] = [
      { name: "Zeta", balance: 1000, ratePct: 10, minPayment: 20 },
      { name: "Alpha", balance: 1000, ratePct: 10, minPayment: 20 },
    ];
    expect(prioritise(tied, "snowball").map((d) => d.name)).toEqual(["Alpha", "Zeta"]);
    expect(prioritise([...tied].reverse(), "snowball").map((d) => d.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("simulatePayoff", () => {
  it("clears every debt and reports an order", () => {
    const plan = simulatePayoff(DEBTS, 300, "avalanche");
    expect(plan.feasible).toBe(true);
    expect(plan.debts).toHaveLength(3);
    expect(plan.debts.map((d) => d.order)).toEqual([1, 2, 3]);
    expect(plan.schedule.at(-1)!.remaining).toBe(0);
    expect(plan.months).toBe(plan.schedule.length);
  });

  it("focuses spare money in the strategy's order", () => {
    expect(simulatePayoff(DEBTS, 300, "avalanche").focusOrder[0]).toBe("Card A");
    expect(simulatePayoff(DEBTS, 300, "snowball").focusOrder[0]).toBe("Card B");
  });

  it("distinguishes focus order from the order debts actually clear", () => {
    // A small debt can finish on its own minimum while a bigger one is targeted.
    // Conflating the two would tell the user to attack the wrong debt.
    const debts: Debt[] = [
      { name: "Big high-rate", balance: 6000, ratePct: 27, minPayment: 150 },
      { name: "Tiny", balance: 120, ratePct: 5, minPayment: 40 },
    ];
    const plan = simulatePayoff(debts, 200, "avalanche");
    expect(plan.focusOrder[0]).toBe("Big high-rate"); // where the money goes
    expect(plan.debts[0].name).toBe("Tiny");          // what clears first
  });

  it("avalanche never costs more interest than snowball (it's the optimum)", () => {
    const a = simulatePayoff(DEBTS, 300, "avalanche");
    const s = simulatePayoff(DEBTS, 300, "snowball");
    expect(a.totalInterest).toBeLessThanOrEqual(s.totalInterest);
  });

  it("total paid equals principal plus interest", () => {
    const plan = simulatePayoff(DEBTS, 300, "avalanche");
    const principal = DEBTS.reduce((s, d) => s + d.balance, 0);
    expect(plan.totalPaid).toBeCloseTo(principal + plan.totalInterest, 1);
  });

  it("more extra money means fewer months and less interest", () => {
    const lean = simulatePayoff(DEBTS, 0, "avalanche");
    const rich = simulatePayoff(DEBTS, 500, "avalanche");
    expect(rich.months).toBeLessThan(lean.months);
    expect(rich.totalInterest).toBeLessThan(lean.totalInterest);
  });

  it("rolls freed-up minimums onward, so the balance falls faster over time", () => {
    // The monthly outlay is constant, so the snowball effect doesn't show up as
    // "more principal" — it shows up as shrinking interest and an accelerating
    // balance decline, because every freed minimum keeps attacking principal.
    const plan = simulatePayoff(DEBTS, 300, "snowball");
    const s = plan.schedule;

    // Interest shrinks month over month as balances fall.
    expect(s.at(-2)!.interest).toBeLessThan(s[0].interest);

    // ...so the balance drops faster near the end than at the start.
    const earlyDrop = s[0].remaining - s[1].remaining;
    const lateDrop = s.at(-3)!.remaining - s.at(-2)!.remaining;
    expect(lateDrop).toBeGreaterThan(earlyDrop);
  });

  it("spends the whole monthly outlay while debt remains", () => {
    const plan = simulatePayoff(DEBTS, 300, "avalanche");
    // Every month except the last pays exactly minimums + extra.
    for (const m of plan.schedule.slice(0, -1)) {
      expect(m.principal).toBeCloseTo(plan.monthlyOutlay, 2);
    }
  });

  it("handles a 0% debt without dividing by zero or stalling", () => {
    const plan = simulatePayoff(
      [{ name: "Family loan", balance: 1200, ratePct: 0, minPayment: 100 }], 0, "avalanche",
    );
    expect(plan.feasible).toBe(true);
    expect(plan.months).toBe(12);
    expect(plan.totalInterest).toBe(0);
  });

  it("reports infeasible when payments can't cover the interest", () => {
    const plan = simulatePayoff(
      [{ name: "Maxed card", balance: 20000, ratePct: 29.9, minPayment: 100 }], 0, "avalanche",
    );
    expect(plan.feasible).toBe(false);
    expect(plan.problem).toMatch(/don't cover|grow forever/i);
    expect(plan.problem).toMatch(/Increase the monthly amount/);
  });

  it("returns an empty plan for no debts", () => {
    const plan = simulatePayoff([], 100, "avalanche");
    expect(plan.months).toBe(0);
    expect(plan.debts).toHaveLength(0);
    expect(plan.totalInterest).toBe(0);
  });

  it("ignores already-cleared debts", () => {
    const plan = simulatePayoff(
      [...DEBTS, { name: "Paid off", balance: 0, ratePct: 20, minPayment: 50 }], 300, "avalanche",
    );
    expect(plan.debts.map((d) => d.name)).not.toContain("Paid off");
  });
});

describe("comparePayoff", () => {
  it("picks the cheaper strategy and quantifies the difference", () => {
    const c = comparePayoff(DEBTS, 300);
    expect(c.cheaper).toBe("avalanche");
    expect(c.interestSaved).toBeGreaterThan(0);
    expect(c.advice.join(" ")).toMatch(/Avalanche/);
    // Names the motivational trade-off rather than just declaring a winner.
    expect(c.advice.join(" ")).toMatch(/motivational|stick to|actually finish/i);
  });

  it("says so plainly when the strategies tie", () => {
    const single: Debt[] = [{ name: "Only card", balance: 3000, ratePct: 18, minPayment: 100 }];
    const c = comparePayoff(single, 200);
    expect(c.interestSaved).toBe(0);
    expect(c.monthsSaved).toBe(0);
    expect(c.advice.join(" ")).toMatch(/same|doesn't matter/i);
  });

  it("nudges toward adding extra when only minimums are paid", () => {
    expect(comparePayoff(DEBTS, 0).advice.join(" ")).toMatch(/minimum payments only/i);
  });

  it("tells you to attack the FOCUS debt, not whichever clears first", () => {
    // Regression: the advice once named the first debt to clear, which sent
    // people at the wrong debt whenever a small one finished on its minimum.
    const debts: Debt[] = [
      { name: "Big high-rate", balance: 6000, ratePct: 27, minPayment: 150 },
      { name: "Tiny", balance: 120, ratePct: 5, minPayment: 40 },
    ];
    const c = comparePayoff(debts, 200);
    expect(c.cheaper).toBe("avalanche");
    expect(c.avalanche.focusOrder[0]).toBe("Big high-rate");
    expect(c.avalanche.debts[0].name).toBe("Tiny"); // clears first, but isn't the target

    const text = c.advice.join(" ");
    expect(text).toMatch(/spare dollar on "Big high-rate"/);
    expect(text).not.toMatch(/spare dollar on "Tiny"/);
  });

  it("surfaces the infeasible reason instead of a bogus plan", () => {
    const c = comparePayoff([{ name: "Maxed", balance: 20000, ratePct: 29.9, minPayment: 50 }], 0);
    expect(c.avalanche.feasible).toBe(false);
    expect(c.advice[0]).toMatch(/don't cover/i);
  });
});

describe("a realistic four-card household", () => {
  // Shaped like the real profile this was built against: several cards, one
  // large, mixed rates, a few hundred spare a month.
  const cards: Debt[] = [
    { name: "Capital One", balance: 3468.45, ratePct: 26.99, minPayment: 105 },
    { name: "Tjx", balance: 2674.57, ratePct: 29.99, minPayment: 80 },
    { name: "Chase", balance: 484.58, ratePct: 21.49, minPayment: 40 },
    { name: "Citi", balance: 199.9, ratePct: 24.99, minPayment: 35 },
  ];

  it("produces a sane, fully-paid plan", () => {
    const c = comparePayoff(cards, 400);
    expect(c.avalanche.feasible).toBe(true);
    expect(c.avalanche.debts).toHaveLength(4);
    expect(c.avalanche.schedule.at(-1)!.remaining).toBe(0);
    // The strategies really do disagree about where the money should go.
    expect(c.avalanche.focusOrder[0]).toBe("Tjx");   // 29.99% — highest rate
    expect(c.snowball.focusOrder[0]).toBe("Citi");   // $199.90 — smallest
    // And it finishes in a believable timeframe.
    expect(c.avalanche.months).toBeGreaterThan(6);
    expect(c.avalanche.months).toBeLessThan(60);
  });

  it("is honest that the difference here is small", () => {
    // Real balances, mixed rates: avalanche wins, but by tens of dollars — so
    // the advice must not oversell it over the strategy you'll actually finish.
    const c = comparePayoff(cards, 400);
    expect(c.cheaper).toBe("avalanche");
    expect(c.interestSaved).toBeLessThan(100);
    expect(c.advice.join(" ")).toMatch(/stick to|actually finish/i);
  });
});
