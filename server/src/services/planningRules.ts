/**
 * The standard rules of thumb, implemented properly and stated with their
 * limits.
 *
 * Each of these is guidance the app was either missing or approximating badly.
 * They are heuristics, not theorems, and the point of putting them here is that
 * a heuristic with its provenance and its failure mode written down is worth
 * far more than the same number asserted.
 */
import { loanPayment } from "./finmath.js";

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ---------------------------------------------------------------------------
// Emergency fund
// ---------------------------------------------------------------------------

/**
 * How stable the income is. This is the input that actually moves the answer,
 * and the one a flat "six months" ignores.
 */
export type IncomeStability =
  /** Two earners, salaried, different employers or sectors. */
  | "dual-stable"
  /** One earner, salaried, or two in the same firm — one event ends both. */
  | "single-stable"
  /** Commission, freelance, contract, seasonal, or a single client. */
  | "variable"
  /** Business owner, or income that can go to zero and stay there. */
  | "self-employed";

export interface EmergencyFundInput {
  /** Monthly cost of the things that don't stop: housing, utilities, food,
   *  insurance, minimum debt payments, childcare. NOT total spending. */
  essentialMonthlyExpenses: number;
  /** What's actually liquid — cash and instant-access savings. Not a 401k. */
  liquidSavings: number;
  stability: IncomeStability;
  /** Monthly surplus available to build the fund. */
  monthlySavingsCapacity?: number;
}

export interface EmergencyFundResult {
  targetMonths: number;
  targetAmount: number;
  monthsCovered: number;
  shortfall: number;
  /** 0–1, capped at 1. */
  progress: number;
  monthsToTarget: number | null;
  status: "none" | "building" | "adequate" | "beyond";
  notes: string[];
}

/**
 * Months of essential expenses, by how likely the income is to stop and how
 * long it takes to replace.
 *
 * The familiar "three to six months" is a compression of that reasoning, and
 * the compression is where it goes wrong in both directions. A dual-income
 * household in stable employment is over-saving at six months — money sitting
 * in cash losing to inflation. A single-income freelancer is under-saved at
 * six, because that is roughly the *median* time to replace a professional
 * role, meaning half of people take longer.
 */
const TARGET_MONTHS: Record<IncomeStability, number> = {
  "dual-stable": 3,
  "single-stable": 6,
  variable: 9,
  "self-employed": 12,
};

/**
 * Essential expenses, not total. This is the correction that matters most.
 *
 * An emergency fund exists to cover the months when income stops, and in those
 * months you do not spend what you spend now — restaurants, holidays and new
 * clothes are the first things to go. Sizing the fund on *total* spending
 * inflates the target by whatever your discretionary share is, which for a
 * typical household is 20–35% of outgoings. The app was doing exactly that:
 * `avgMonthlyExpenses * 6`.
 *
 * The Conscious Spending Plan already classifies categories as fixed, so the
 * caller can pass the number the app already knows.
 */
export function emergencyFund(input: EmergencyFundInput): EmergencyFundResult {
  const essential = Math.max(0, input.essentialMonthlyExpenses);
  const targetMonths = TARGET_MONTHS[input.stability];
  const targetAmount = r2(essential * targetMonths);
  const liquid = Math.max(0, input.liquidSavings);
  const monthsCovered = essential > 0 ? r2(liquid / essential) : 0;
  const shortfall = r2(Math.max(0, targetAmount - liquid));

  const capacity = input.monthlySavingsCapacity ?? 0;
  const monthsToTarget = shortfall > 0 && capacity > 0 ? Math.ceil(shortfall / capacity) : null;

  const status: EmergencyFundResult["status"] =
    liquid <= 0 ? "none"
    : monthsCovered >= targetMonths * 1.5 ? "beyond"
    : monthsCovered >= targetMonths ? "adequate"
    : "building";

  const notes: string[] = [
    `${targetMonths} months of essential spending (${fmt(essential)}/mo) = ${fmt(targetAmount)}.`,
    `Essential, not total — in a month with no income you stop buying the optional things.`,
  ];

  if (status === "none") {
    notes.push(
      "With nothing liquid, any unplanned bill becomes debt. A first milestone of one month's " +
      "essentials does more for you than any investment decision you could make today.",
    );
  } else if (status === "building") {
    notes.push(`You have ${monthsCovered.toFixed(1)} months. ${fmt(shortfall)} to go.`);
    if (monthsToTarget) notes.push(`At your current pace that's about ${monthsToTarget} months.`);
  } else if (status === "adequate") {
    notes.push(`Covered — ${monthsCovered.toFixed(1)} months. Money beyond this is worth investing;
      cash loses to inflation every year it sits.`.replace(/\s+/g, " "));
  } else {
    notes.push(
      `${monthsCovered.toFixed(1)} months is well past the target. Holding ${fmt(liquid - targetAmount)} ` +
      "more than you need in cash costs you the difference between deposit rates and returns — " +
      "which is a real cost, even though it never appears as a loss.",
    );
  }

  return {
    targetMonths,
    targetAmount,
    monthsCovered,
    shortfall,
    progress: targetAmount > 0 ? Math.min(1, r2(liquid / targetAmount)) : 1,
    monthsToTarget,
    status,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Mortgage affordability
// ---------------------------------------------------------------------------

export interface AffordabilityInput {
  /** GROSS annual household income — the basis lenders use. */
  grossAnnualIncome: number;
  /** Monthly minimum payments on everything else: cards, car, student loans. */
  otherMonthlyDebt: number;
  downPayment: number;
  homePrice: number;
  annualRatePct: number;
  termYears?: number;
  /** Annual property tax as % of price. US median is near 1.1%; varies hugely. */
  propertyTaxPct?: number;
  /** Annual homeowner's insurance as % of price. */
  insurancePct?: number;
  /** Monthly HOA or condo fee. */
  monthlyHoa?: number;
}

export interface AffordabilityResult {
  monthlyPrincipalInterest: number;
  monthlyTax: number;
  monthlyInsurance: number;
  monthlyPmi: number;
  monthlyHoa: number;
  /** Everything the house costs each month. */
  totalPiti: number;
  downPaymentPct: number;
  /** Housing ÷ gross monthly income, %. The "front-end ratio". */
  frontEndPct: number;
  /** (Housing + other debt) ÷ gross monthly income, %. The "back-end ratio". */
  backEndPct: number;
  passesFrontEnd: boolean;
  passesBackEnd: boolean;
  /** The most expensive house that clears both rules, at this down payment. */
  maxAffordablePrice: number;
  notes: string[];
}

/** Housing costs ≤ 28% of gross; all debt ≤ 36%. */
export const FRONT_END_LIMIT = 28;
export const BACK_END_LIMIT = 36;

/**
 * Private mortgage insurance, charged below 20% down. Roughly 0.5–1.5% of the
 * loan per year depending on credit and down payment; 0.75% is a fair middle.
 * It falls away at 78–80% loan-to-value, so it is not permanent — but the app
 * showing a payment that omits it is showing a payment nobody will be offered.
 */
const PMI_ANNUAL_PCT = 0.75;

/**
 * The 28/36 rule, on the full cost of owning.
 *
 * The scenario engine previously asked only whether the mortgage payment was
 * below current monthly savings. That is not how anyone underwrites a loan, and
 * more importantly it flatters: it compares one component of the cost against a
 * surplus computed while renting, and it silently omits property tax,
 * insurance, PMI and HOA — which together commonly add 30–40% on top of
 * principal and interest.
 *
 * 28/36 comes from mortgage underwriting rather than from theory. Its virtue is
 * that it is the constraint that will actually be applied to you, and it has
 * held up as a rough guide to what is survivable. Its limits are real: it uses
 * gross income and so ignores your tax rate, it ignores your other goals
 * entirely, and a household with no other debt and a big deposit can carry more
 * than it allows.
 */
export function affordability(input: AffordabilityInput): AffordabilityResult {
  const term = input.termYears ?? 30;
  const taxPct = input.propertyTaxPct ?? 1.1;
  const insPct = input.insurancePct ?? 0.35;
  const hoa = input.monthlyHoa ?? 0;
  const grossMonthly = input.grossAnnualIncome / 12;

  const loan = Math.max(0, input.homePrice - input.downPayment);
  const downPct = input.homePrice > 0 ? (input.downPayment / input.homePrice) * 100 : 0;

  const pi = loanPayment(loan, input.annualRatePct, term);
  const tax = (input.homePrice * (taxPct / 100)) / 12;
  const ins = (input.homePrice * (insPct / 100)) / 12;
  const pmi = downPct < 20 ? (loan * (PMI_ANNUAL_PCT / 100)) / 12 : 0;
  const piti = pi + tax + ins + pmi + hoa;

  const frontEndPct = grossMonthly > 0 ? (piti / grossMonthly) * 100 : Infinity;
  const backEndPct = grossMonthly > 0 ? ((piti + input.otherMonthlyDebt) / grossMonthly) * 100 : Infinity;

  // The most expensive house clearing both tests. Bisection rather than algebra
  // because PMI switches on below 20% down, which makes the cost function
  // discontinuous in price.
  const budget = Math.min(
    grossMonthly * (FRONT_END_LIMIT / 100),
    grossMonthly * (BACK_END_LIMIT / 100) - input.otherMonthlyDebt,
  );
  let lo = 0;
  let hi = 10_000_000;
  if (budget <= 0) {
    hi = 0;
  } else {
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const l = Math.max(0, mid - input.downPayment);
      const dPct = mid > 0 ? (input.downPayment / mid) * 100 : 100;
      const cost =
        loanPayment(l, input.annualRatePct, term) +
        (mid * (taxPct / 100)) / 12 +
        (mid * (insPct / 100)) / 12 +
        (dPct < 20 ? (l * (PMI_ANNUAL_PCT / 100)) / 12 : 0) +
        hoa;
      if (cost <= budget) lo = mid; else hi = mid;
    }
  }

  const notes: string[] = [
    `Payment is ${fmt(piti)}/mo all-in: ${fmt(pi)} principal and interest, ${fmt(tax)} tax, ` +
    `${fmt(ins)} insurance${pmi > 0 ? `, ${fmt(pmi)} PMI` : ""}${hoa > 0 ? `, ${fmt(hoa)} HOA` : ""}.`,
    `Housing is ${frontEndPct.toFixed(1)}% of gross income (guideline: under ${FRONT_END_LIMIT}%). ` +
    `All debt is ${backEndPct.toFixed(1)}% (guideline: under ${BACK_END_LIMIT}%).`,
  ];
  if (pmi > 0) {
    notes.push(
      `Under 20% down, so PMI applies — about ${fmt(pmi * 12)}/year until you reach 20% equity. ` +
      "It is not permanent, and it is not nothing.",
    );
  }
  if (!(frontEndPct <= FRONT_END_LIMIT && backEndPct <= BACK_END_LIMIT)) {
    notes.push(
      `On these rules the ceiling at this deposit is about ${fmt(Math.floor(lo / 1000) * 1000)}.`,
    );
  }
  notes.push(
    "These are underwriting guidelines on gross income, so they say nothing about your tax rate, " +
    "your other goals, or what you would have to stop doing to make the payments.",
  );

  return {
    monthlyPrincipalInterest: r2(pi),
    monthlyTax: r2(tax),
    monthlyInsurance: r2(ins),
    monthlyPmi: r2(pmi),
    monthlyHoa: r2(hoa),
    totalPiti: r2(piti),
    downPaymentPct: r2(downPct),
    frontEndPct: r2(frontEndPct),
    backEndPct: r2(backEndPct),
    passesFrontEnd: frontEndPct <= FRONT_END_LIMIT,
    passesBackEnd: backEndPct <= BACK_END_LIMIT,
    maxAffordablePrice: Math.floor(lo / 1000) * 1000,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Invest, or pay the debt down
// ---------------------------------------------------------------------------

export interface InvestVsPrepayInput {
  debtBalance: number;
  debtRatePct: number;
  /** Extra money available each month, beyond the minimum payment. */
  monthlyAmount: number;
  /** Expected return on investing instead. NOMINAL — compared like for like. */
  expectedReturnPct: number;
  /** Marginal rate on investment gains, %. Zero inside a tax-sheltered account. */
  investmentTaxPct?: number;
  /** True if the debt interest is deductible (a mortgage, for some filers). */
  debtInterestDeductible?: boolean;
  marginalIncomeTaxPct?: number;
  /** Is there an employer match being left on the table? */
  employerMatchPct?: number;
}

export interface InvestVsPrepayResult {
  effectiveDebtRatePct: number;
  effectiveReturnPct: number;
  edgePct: number;
  recommendation: "pay-debt" | "invest" | "close-call";
  notes: string[];
}

/**
 * Compare a guaranteed return against an uncertain one, and say which is which.
 *
 * Paying down debt returns exactly the interest rate, guaranteed, tax-free, with
 * no sequence risk. Investing returns an expectation with a wide distribution
 * around it. The arithmetic comparison is easy; the part people get wrong is
 * treating those two numbers as the same kind of thing.
 *
 * So the rule this encodes: compare after-tax to after-tax, and require a real
 * margin before recommending the risky side. Inside the margin it says so
 * rather than pretending to know.
 */
export function investVsPrepay(input: InvestVsPrepayInput): InvestVsPrepayResult {
  const notes: string[] = [];

  // Deductible interest costs less than its headline rate.
  let effectiveDebtRatePct = input.debtRatePct;
  if (input.debtInterestDeductible && input.marginalIncomeTaxPct) {
    effectiveDebtRatePct = input.debtRatePct * (1 - input.marginalIncomeTaxPct / 100);
    notes.push(
      `Deductible interest, so the ${input.debtRatePct}% costs you ` +
      `${effectiveDebtRatePct.toFixed(2)}% after tax — only if you itemise, which most filers no ` +
      "longer do since the standard deduction rose.",
    );
  }

  const taxPct = input.investmentTaxPct ?? 0;
  const effectiveReturnPct = input.expectedReturnPct * (1 - taxPct / 100);
  if (taxPct > 0) {
    notes.push(
      `Investing in a taxable account, so ${input.expectedReturnPct}% becomes ` +
      `${effectiveReturnPct.toFixed(2)}% after ${taxPct}% tax on gains.`,
    );
  }

  // An employer match is not an investment return, it is a pay rise you are
  // declining. Nothing here competes with it.
  if (input.employerMatchPct && input.employerMatchPct > 0) {
    notes.push(
      `Before either: you have an unclaimed ${input.employerMatchPct}% employer match. That is an ` +
      "immediate, guaranteed return no debt rate beats. Take it first, then decide about the rest.",
    );
  }

  const edgePct = r2(effectiveReturnPct - effectiveDebtRatePct);

  // Two points is the margin. Below that the difference is inside the error
  // bars on "expected return" and the guaranteed side wins on certainty alone.
  const MARGIN = 2;
  let recommendation: InvestVsPrepayResult["recommendation"];
  if (edgePct > MARGIN) {
    recommendation = "invest";
    notes.push(
      `Investing is ahead by ${edgePct.toFixed(2)} points a year on expectation — but that is an ` +
      "average across decades, not a promise about the next five years. Paying the debt returns " +
      `${effectiveDebtRatePct.toFixed(2)}% with certainty.`,
    );
  } else if (edgePct < -MARGIN) {
    recommendation = "pay-debt";
    notes.push(
      `The debt costs ${(-edgePct).toFixed(2)} points a year more than investing is expected to ` +
      "return, and it costs it with certainty. Clear it.",
    );
  } else {
    recommendation = "close-call";
    notes.push(
      `Within ${MARGIN} points — too close to call on the arithmetic. The debt is the certain ` +
      "one, so it wins any tie: it pays a known rate, it cannot fall in value, and it shortens " +
      "the list of things that have to keep going right.",
    );
  }

  if (input.debtRatePct >= 10) {
    notes.push(
      "At double-digit interest this is not really a close question. No mainstream return " +
      "expectation is that high, and the debt's is guaranteed.",
    );
  }

  return { effectiveDebtRatePct: r2(effectiveDebtRatePct), effectiveReturnPct: r2(effectiveReturnPct), edgePct, recommendation, notes };
}

// ---------------------------------------------------------------------------
// Savings rate and time to independence
// ---------------------------------------------------------------------------

/**
 * Years to financial independence from savings rate alone.
 *
 * The result that surprises people: starting from zero, the time depends almost
 * entirely on the *share* of income saved, not the amount. Two people saving
 * 50% arrive at the same time whether they earn $60k or $600k, because the
 * income sets both how fast the pot grows and how big it needs to be.
 *
 * Popularised by Mr Money Mustache's "shockingly simple math", and it is the
 * single most useful thing to show someone deciding whether to chase a raise or
 * cut an expense — the expense cut counts twice.
 *
 * Assumes spending continues at today's level and the withdrawal rate holds.
 */
export function yearsToIndependence(
  savingsRatePct: number,
  realReturnPct: number,
  withdrawalRatePct = 4,
  currentPortfolioAsYearsOfSpending = 0,
): number | null {
  const s = savingsRatePct / 100;
  if (s <= 0) return null;   // saving nothing never gets there
  if (s >= 1) return 0;      // spending nothing is already there

  // Everything below is denominated in YEARS OF SPENDING, so the income
  // cancels out and only the ratio matters — which is the whole result.
  //
  //   spending          1
  //   income            1 / (1 − s)
  //   saved per year    s / (1 − s)      years of spending
  //   target            1 / withdrawal   years of spending  ← 25 at 4%
  //
  // The target does not depend on the savings rate. Getting that wrong (an
  // earlier draft had `(1 − s) / withdrawal`) mixes income-years with
  // spending-years and returns about 10 years for a 50% saver where the answer
  // is 17 — flattering by seven years, which is the kind of error that changes
  // what someone does.
  const target = 1 / (withdrawalRatePct / 100);
  const have = currentPortfolioAsYearsOfSpending;
  if (have >= target) return 0;

  const r = realReturnPct / 100;
  // No growth: linear. Saving s of income covers (1-s) of spending per year.
  if (r === 0) return r2((target - have) / (s / (1 - s)));

  // Future value of an annuity, solved for n:
  //   target = have·(1+r)^n + (s/(1-s))·((1+r)^n − 1)/r
  const annual = s / (1 - s); // years of spending saved per year
  const num = target * r + annual;
  const den = have * r + annual;
  if (den <= 0 || num / den <= 0) return null;
  return r2(Math.log(num / den) / Math.log(1 + r));
}
