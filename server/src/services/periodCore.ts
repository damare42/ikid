/**
 * Which month a screen should open on when nobody has picked one.
 *
 * The obvious answer — today's month — is wrong on the first day or two of
 * every month, and it is wrong in the most visible place: the dashboard is
 * the first screen anyone sees. On the 1st there is usually nothing in the
 * current month yet, so the app opened on a blank page with an empty chart and
 * $0 everywhere, having said nothing about why.
 *
 * CI caught this on the demo before a visitor did. The generated dataset is
 * anchored to the day it is built and never invents the future, so a build that
 * ran at 00:58 on the 1st produced a "current month" containing nothing, and the
 * dashboard's own invariant test — income must be greater than zero — failed.
 * The test was right. Every visitor on the 1st of a month would have seen the
 * same empty screen.
 *
 * The rule below keeps the useful default and drops the useless one: show this
 * month as soon as anything has happened in it, and until then show the last
 * month that did. On the 2nd with three transactions you get this month, which
 * is what you asked for; on the 1st with none you get a page with numbers on it
 * rather than an apology.
 *
 * A real user hits this too — anyone who imports statements monthly rather than
 * daily opens the app to an empty dashboard for the first week.
 */

/** A month key, `YYYY-MM`. */
export type MonthKey = string;

export const monthKeyOfDate = (d: Date): MonthKey =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** What a month contains, as far as choosing one to look at is concerned. */
export interface MonthActivity {
  key: MonthKey;
  hasIncome: boolean;
  hasSpending: boolean;
}

/**
 * "Any transaction" turned out to be too weak a test, and the first attempt at
 * this fix shipped with it. On the 1st of September the generated data held two
 * coffees and no salary — technically an active month, and the dashboard opened
 * on it showing $0 income, a 0% savings rate and every Conscious Spending Plan
 * bucket at 0%, because all of those are ratios of income. Two coffees is not a
 * month.
 *
 * A month is worth opening on when it has both sides of the ledger.
 */
const isSubstantial = (m: MonthActivity) => m.hasIncome && m.hasSpending;

/**
 * @param requested  an explicit `YYYY-MM` from the caller — always honoured,
 *                   including when it is empty. Choosing a month and being
 *                   silently moved to a different one would be worse than an
 *                   empty screen.
 * @param months     what each month with any activity actually contains.
 * @param today      injected so this is testable without mocking the clock.
 */
export function resolveMonth(
  requested: string | undefined,
  months: Iterable<MonthActivity>,
  today: Date = new Date(),
): MonthKey {
  if (requested && /^\d{4}-\d{2}$/.test(requested)) return requested;

  const current = monthKeyOfDate(today);
  const all = [...months].sort((a, b) => a.key.localeCompare(b.key));
  if (all.length === 0) return current;

  // Once this month has both income and spending in it, it is the month you
  // meant. Anything else would be second-guessing a question you didn't ask.
  const thisMonth = all.find((m) => m.key === current);
  if (thisMonth && isSubstantial(thisMonth)) return current;

  // Otherwise the most recent month that does — never a future one. A dataset
  // can legitimately hold future-dated rows (a scheduled transfer), and opening
  // on next month because one payment is pencilled in would be its own bug.
  const past = all.filter((m) => m.key <= current);
  const substantial = past.filter(isSubstantial);
  if (substantial.length > 0) return substantial[substantial.length - 1].key;

  // No month has both. Someone between jobs, or a half-finished first import:
  // show the most recent month that has anything at all rather than a blank.
  return past.length > 0 ? past[past.length - 1].key : current;
}
