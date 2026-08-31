/**
 * The financial health score.
 *
 * These exist because the score shipped twice: the server computed one formula
 * and the hosted demo computed another, so the demo's dashboard rendered
 * **100/100 directly above "3 budgets over limit"**. A visitor's first read of
 * the app's judgement was a number arguing with the sentence under it.
 *
 * The interesting property isn't any single value — it's that the score can't
 * contradict its own notes. A perfect score has to mean every component was
 * perfect, and the tests below say so in a way a future weighting change can't
 * quietly break.
 */
import { describe, expect, it } from "vitest";
import { DISCRETIONARY, financialHealth, type HealthInputs } from "../services/healthCore.js";

const base: HealthInputs = {
  savingsRate: 0.2,
  spending: 1000,
  budgets: [{ overBudget: false }],
  categoryTotals: [{ name: "Groceries", total: 1000 }],
};

describe("financialHealth", () => {
  it("gives 100 only when all three components are perfect", () => {
    // 20% saved, every budget on track, nothing discretionary.
    expect(financialHealth(base).score).toBe(100);
  });

  it("cannot score 100 while a budget is over — the bug that prompted this", () => {
    // The demo's old formula was `savingsRate * 250 + (none over ? 25 : 0)`
    // clamped to 100, so a 66% savings rate alone reached 165 and the clamp
    // hid everything else. Saving hard is not a defence against overspending.
    const overspent = financialHealth({
      ...base,
      savingsRate: 0.66,
      budgets: [{ overBudget: true }, { overBudget: true }, { overBudget: true }, { overBudget: false }],
    });
    expect(overspent.score).toBeLessThan(100);
    // And the note has to name the shortfall, not just imply it.
    expect(overspent.notes.join(" ")).toMatch(/25% of budgets on track/);
  });

  it("caps the savings component so it can't paper over the rest", () => {
    const modest = financialHealth({ ...base, savingsRate: 0.2 });
    const extreme = financialHealth({ ...base, savingsRate: 0.9 });
    expect(extreme.score).toBe(modest.score);
  });

  it("never goes below zero or above 100", () => {
    const awful = financialHealth({
      savingsRate: -2,
      spending: 1000,
      budgets: [{ overBudget: true }],
      categoryTotals: [{ name: "Dining", total: 1000 }],
    });
    expect(awful.score).toBe(0);
    expect(financialHealth({ ...base, savingsRate: 5 }).score).toBeLessThanOrEqual(100);
  });

  it("treats having no budgets as nothing to fail, and says so", () => {
    const none = financialHealth({ ...base, budgets: [] });
    expect(none.score).toBe(100);
    expect(none.notes.join(" ")).toMatch(/No budgets set/);
  });

  it("charges for discretionary spending on a scale, not a cliff", () => {
    const scores = [0, 0.25, 0.5, 1].map((share) =>
      financialHealth({
        ...base,
        categoryTotals: [
          { name: "Dining", total: 1000 * share },
          { name: "Groceries", total: 1000 * (1 - share) },
        ],
      }).score,
    );
    // Monotonically worse, and half your spending on dining zeroes that
    // component rather than merely denting it.
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[1]).toBeGreaterThan(scores[2]);
    expect(scores[2]).toBe(scores[3]); // already floored at 50%
    expect(scores[0] - scores[2]).toBe(30);
  });

  it("explains every component it charged for", () => {
    // A score nobody can take apart invites trust it hasn't earned, so all
    // three lines are always present with their contribution shown.
    const notes = financialHealth(base).notes;
    expect(notes).toHaveLength(3);
    expect(notes.join("\n")).toMatch(/\/40/);
    expect(notes.join("\n")).toMatch(/\/30/);
    for (const n of notes) expect(n).toMatch(/\d/);
  });

  it("keeps the discretionary list somewhere both sides can read it", () => {
    // Exported rather than inlined: the demo used to decide for itself what
    // counted as discretionary, which is how the two formulas drifted.
    expect(DISCRETIONARY).toContain("Dining");
    expect(DISCRETIONARY).not.toContain("Groceries");
  });
});
