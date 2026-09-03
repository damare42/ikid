/**
 * Getting at retirement money before 59½ — the routes, and what each costs.
 *
 * The app knew two of these. The bridge planner told people, flatly, that
 * "Traditional 401k/IRA dollars don't help the bridge at all", and offered the
 * Roth conversion ladder as the only way out. That is too strong, and the
 * omission matters most for exactly the people the page is aimed at: someone
 * retiring at 56 with everything in a 401k is told to build a five-year ladder
 * when the Rule of 55 would let them draw from it immediately.
 *
 * The five routes, in the order they are usually reached for:
 *
 *   1. Taxable brokerage       any age, no rules, just capital gains tax
 *   2. Roth contributions      your own basis, any age, tax and penalty free
 *   3. Rule of 55              leave the job at 55+, draw from THAT 401k
 *   4. Roth conversion ladder  convert, wait five years, withdraw the rung
 *   5. 72(t) / SEPP            any age, but a binding multi-year commitment
 *
 * This module covers 3 and 5, which were missing. The others are modelled in
 * retirement.ts already.
 *
 * Sources: IRS "Retirement topics — Exceptions to tax on early distributions",
 * IRC §72(t)(2)(A)(v) for the age-55 separation exception, §72(t)(2)(A)(iv)
 * and Notice 2022-6 for SEPP.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Rule of 55
// ---------------------------------------------------------------------------

export interface RuleOf55Input {
  /** Age in the calendar year you separate from the employer. */
  separationAge: number;
  /** Qualified public safety employees get the same exception at 50. */
  publicSafety?: boolean;
  /** Has the balance been rolled into an IRA? This is the trap. */
  rolledToIra?: boolean;
}

export interface RuleOf55Result {
  eligible: boolean;
  /** The age at which separating would qualify. */
  qualifyingAge: number;
  reasons: string[];
  warnings: string[];
}

/**
 * Separate from service during or after the calendar year you turn 55 and
 * distributions from **that employer's** plan escape the 10% penalty.
 *
 * Three things about it are routinely got wrong, so each is stated:
 *
 *   - It is the *calendar year* you turn 55, not your birthday. Leaving in
 *     January at 54, turning 55 in December, still qualifies.
 *   - It applies to the plan at the employer you left. Not your IRA, and not a
 *     previous employer's 401k.
 *   - Rolling the 401k into an IRA destroys it permanently. This is the most
 *     expensive default action in the whole area, because rolling to an IRA on
 *     leaving a job is what almost everyone is advised to do, and it is usually
 *     right — just not if you are 55+ and plan to spend the money soon.
 */
export function ruleOf55(input: RuleOf55Input): RuleOf55Result {
  const qualifyingAge = input.publicSafety ? 50 : 55;
  const oldEnough = input.separationAge >= qualifyingAge;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (oldEnough) {
    reasons.push(
      `Separating at ${input.separationAge} is in or after the year you turn ${qualifyingAge}, ` +
      "so distributions from that employer's 401k or 403b avoid the 10% early-withdrawal penalty.",
    );
    reasons.push("Income tax still applies — this waives the penalty, not the tax.");
  } else {
    reasons.push(
      `Not eligible: you would need to leave the employer in or after the calendar year you turn ` +
      `${qualifyingAge}, and this plan has you leaving at ${input.separationAge}.`,
    );
  }

  if (input.rolledToIra) {
    warnings.push(
      "Rolling that 401k into an IRA ends this permanently — the exception belongs to the " +
      "employer plan, not to you. Leave the money where it is until you no longer need it.",
    );
  } else if (oldEnough) {
    warnings.push(
      "Do not roll this 401k into an IRA. Rolling over on leaving a job is the standard advice " +
      "and it is usually right, but it would forfeit this exception.",
    );
  }

  warnings.push(
    "It covers only the plan at the employer you left. Older 401ks from previous jobs, and any " +
    "IRA, are still locked until 59½.",
  );

  return { eligible: oldEnough && !input.rolledToIra, qualifyingAge, reasons, warnings };
}

// ---------------------------------------------------------------------------
// 72(t) — substantially equal periodic payments
// ---------------------------------------------------------------------------

/**
 * Single Life Table factors, post-2021 (IRS Pub 590-B), at five-year steps for
 * the ages an early retiree plausibly starts a SEPP. Interpolated linearly in
 * between, which is close enough to size a plan and not close enough to file.
 *
 * The exact factor for your age comes from the published table, and a real SEPP
 * should be set up with someone who will sign their name to it — the penalty
 * for getting it wrong is retroactive.
 */
const LIFE_EXPECTANCY: Record<number, number> = {
  35: 50.5, 40: 45.7, 45: 41.0, 50: 36.2, 55: 31.6, 60: 27.1, 65: 22.9,
};

export function lifeExpectancy(age: number): number {
  const ages = Object.keys(LIFE_EXPECTANCY).map(Number).sort((a, b) => a - b);
  const lo = Math.max(...ages.filter((a) => a <= age).concat(ages[0]));
  const hi = Math.min(...ages.filter((a) => a >= age).concat(ages[ages.length - 1]));
  if (lo === hi) return LIFE_EXPECTANCY[lo];
  const t = (age - lo) / (hi - lo);
  return r2(LIFE_EXPECTANCY[lo] + t * (LIFE_EXPECTANCY[hi] - LIFE_EXPECTANCY[lo]));
}

export type SeppMethod = "amortization" | "rmd";

export interface SeppInput {
  /** The balance dedicated to the SEPP. See the note on splitting, below. */
  balance: number;
  age: number;
  /**
   * Interest rate for the amortization method. Notice 2022-6 caps it at the
   * greater of 5% or 120% of the federal mid-term rate.
   */
  ratePct?: number;
  method?: SeppMethod;
}

export interface SeppResult {
  annualPayment: number;
  monthlyPayment: number;
  method: SeppMethod;
  lifeExpectancy: number;
  /** How long the series must run before it can be stopped. */
  commitmentYears: number;
  endsAtAge: number;
  warnings: string[];
}

/**
 * What a 72(t) series would pay, and what it commits you to.
 *
 * The payment is the easy part. The part worth leading with is that this is a
 * contract with the IRS: once started, the series must continue unchanged for
 * the **longer of five years or until 59½**, you may not add to or take
 * anything else from the account, and modifying it triggers a recapture tax —
 * the 10% penalty applied retroactively to every payment already taken, plus
 * interest.
 *
 * Which makes it the opposite of flexible, and the reason planners reach for it
 * last. It is a good answer for someone with a large pre-tax balance, no other
 * bridge assets, and a stable spending need. It is a bad answer for anyone
 * whose plans might change, which is most people at 45.
 */
export function sepp(input: SeppInput): SeppResult {
  const method = input.method ?? "amortization";
  const le = lifeExpectancy(input.age);
  const rate = (input.ratePct ?? 5) / 100;

  // RMD method: balance ÷ life expectancy, recalculated annually — the payment
  // moves with the balance, so it is the smallest and the only one that varies.
  // Amortization: fixed payment amortising the balance over life expectancy.
  const annual =
    method === "rmd"
      ? input.balance / le
      : rate === 0
        ? input.balance / le
        : (input.balance * rate) / (1 - Math.pow(1 + rate, -le));

  const untilFiftyNineHalf = Math.max(0, 59.5 - input.age);
  const commitmentYears = Math.max(5, untilFiftyNineHalf);

  return {
    annualPayment: r2(annual),
    monthlyPayment: r2(annual / 12),
    method,
    lifeExpectancy: le,
    commitmentYears: r2(commitmentYears),
    endsAtAge: r2(input.age + commitmentYears),
    warnings: [
      `Locked in until age ${r2(input.age + commitmentYears)} — the longer of five years or 59½. ` +
      "That is the commitment, not a guideline.",
      "Changing the payments, adding to the account, or taking anything extra out triggers the " +
      "recapture tax: the 10% penalty applied retroactively to every payment you have already " +
      "taken, plus interest.",
      "You can limit the damage by splitting the IRA first and running the SEPP on only part of " +
      "it, leaving the rest untouched and flexible.",
      "Income tax still applies to every payment. This waives the penalty, not the tax.",
      "Set this up with a professional. The arithmetic here sizes the decision; it does not " +
      "produce a filing.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Which routes are actually open
// ---------------------------------------------------------------------------

export interface EarlyAccessInput {
  currentAge: number;
  retireAge: number;
  taxableBalance: number;
  rothBasis: number;
  tradBalance: number;
  /** True if the pre-tax money is in the plan of the employer being left. */
  tradInCurrentEmployerPlan?: boolean;
  publicSafety?: boolean;
}

export interface AccessRoute {
  key: "taxable" | "roth-basis" | "rule-of-55" | "conversion-ladder" | "sepp";
  name: string;
  available: boolean;
  /** Roughly what it unlocks, where that can be said. */
  amount: number | null;
  summary: string;
  /** Lower is better: how much it constrains you afterwards. */
  flexibility: "free" | "some-planning" | "binding";
}

/**
 * The routes open to this person, ordered by how little they cost you in
 * flexibility. Nobody should reach for a SEPP while they still have a taxable
 * account, and the ordering is the advice.
 */
export function earlyAccessRoutes(input: EarlyAccessInput): AccessRoute[] {
  const bridgeYears = Math.max(0, 59.5 - input.retireAge);
  const r55 = ruleOf55({
    separationAge: input.retireAge,
    publicSafety: input.publicSafety,
    rolledToIra: input.tradInCurrentEmployerPlan === false,
  });

  return [
    {
      key: "taxable",
      name: "Taxable brokerage",
      available: input.taxableBalance > 0,
      amount: input.taxableBalance,
      summary: "No age rules at all. You owe capital gains tax on the growth, and at early-retirement income levels the long-term rate is often 0%.",
      flexibility: "free",
    },
    {
      key: "roth-basis",
      name: "Roth contributions",
      available: input.rothBasis > 0,
      amount: input.rothBasis,
      summary: "Your own contributions come out any time, tax and penalty free. The earnings do not — those wait for 59½.",
      flexibility: "free",
    },
    {
      key: "rule-of-55",
      name: "Rule of 55",
      available: r55.eligible && input.tradBalance > 0,
      // Deliberately no dollar figure. The plan tracks one pre-tax pot —
      // 401k and Traditional IRA together — and this exception reaches only
      // the plan at the employer you left. Printing the pot next to the rule
      // would quietly promise that IRA money is available too, and the app has
      // no way to tell how much of the balance is which. A number it cannot
      // stand behind is worse here than no number.
      amount: null,
      summary: r55.eligible
        ? `Leaving at ${input.retireAge} means the 401k at that employer is available without the 10% penalty — no ladder, no waiting. Only that plan, though: any Traditional IRA is still locked until 59½, and rolling the 401k into an IRA would forfeit this.`
        : `Needs you to leave the employer in or after the calendar year you turn ${r55.qualifyingAge}; this plan has you leaving at ${input.retireAge}.`,
      flexibility: "some-planning",
    },
    {
      key: "conversion-ladder",
      name: "Roth conversion ladder",
      available: input.tradBalance > 0 && bridgeYears > 5,
      amount: null,
      summary: "Convert a slice each year, pay tax on it now while your income is low, and withdraw that slice five years later penalty-free. Needs five years of other money to cover the seasoning window.",
      flexibility: "some-planning",
    },
    {
      key: "sepp",
      name: "72(t) / SEPP",
      available: input.tradBalance > 0,
      amount: input.tradBalance > 0 ? r2(sepp({ balance: input.tradBalance, age: input.retireAge }).annualPayment) : null,
      summary: "Fixed annual payments at any age — but locked in for the longer of five years or until 59½, with a retroactive penalty for changing your mind. The last resort, not the first.",
      flexibility: "binding",
    },
  ];
}
