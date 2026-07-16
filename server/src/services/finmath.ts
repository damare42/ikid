/**
 * Financial math — pure, deterministic, unit-tested.
 * Amortization schedules, loan payoff projections, and compound growth.
 * (Per PRINCIPLES.md rule 2: every number here must be reproducible.)
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

function ymFrom(offsetMonths: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() + offsetMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Standard amortized monthly payment. */
export function loanPayment(principal: number, annualRatePct: number, years: number): number {
  if (principal <= 0 || years <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = Math.round(years * 12);
  if (r === 0) return r2(principal / n);
  return r2((principal * r) / (1 - Math.pow(1 + r, -n)));
}

export interface AmortYear {
  year: number; // 1-based
  principalPaid: number;
  interestPaid: number;
  balance: number; // at end of year
}

export interface AmortResult {
  monthlyPayment: number; // base payment (before extra)
  months: number; // actual months to payoff (with extra payments)
  payoffDate: string; // YYYY-MM
  totalInterest: number;
  totalPaid: number;
  interestSavedByExtra: number; // vs. no extra payments
  monthsSavedByExtra: number;
  yearly: AmortYear[];
}

/**
 * Full amortization with optional extra monthly principal payments.
 * Returns yearly aggregates (charts stay light even for 30-year loans).
 */
export function amortization(
  principal: number,
  annualRatePct: number,
  years: number,
  extraMonthly = 0,
): AmortResult {
  const payment = loanPayment(principal, annualRatePct, years);
  const base = simulate(principal, annualRatePct, payment, 0);
  const actual = extraMonthly > 0 ? simulate(principal, annualRatePct, payment, extraMonthly) : base;
  return {
    monthlyPayment: payment,
    months: actual.months,
    payoffDate: ymFrom(actual.months),
    totalInterest: actual.totalInterest,
    totalPaid: r2(principal + actual.totalInterest),
    interestSavedByExtra: r2(base.totalInterest - actual.totalInterest),
    monthsSavedByExtra: base.months - actual.months,
    yearly: actual.yearly,
  };
}

export interface PayoffResult {
  ok: true;
  months: number;
  payoffDate: string;
  totalInterest: number;
  totalPaid: number;
  yearly: AmortYear[];
}

export interface PayoffError {
  ok: false;
  error: string;
  minPayment: number; // smallest payment that makes progress
}

/**
 * "When is this loan gone?" — for an existing balance with a known payment.
 * Errors clearly when the payment doesn't even cover interest.
 */
export function loanPayoff(
  balance: number,
  annualRatePct: number,
  monthlyPayment: number,
  extraMonthly = 0,
): PayoffResult | PayoffError {
  const firstInterest = (balance * annualRatePct) / 100 / 12;
  const pay = monthlyPayment + extraMonthly;
  if (pay <= firstInterest) {
    return {
      ok: false,
      error: "Payment doesn't cover the interest — the balance would grow forever.",
      minPayment: r2(firstInterest + 1),
    };
  }
  const sim = simulate(balance, annualRatePct, monthlyPayment, extraMonthly);
  return {
    ok: true,
    months: sim.months,
    payoffDate: ymFrom(sim.months),
    totalInterest: sim.totalInterest,
    totalPaid: r2(balance + sim.totalInterest),
    yearly: sim.yearly,
  };
}

function simulate(principal: number, annualRatePct: number, payment: number, extra: number) {
  const r = annualRatePct / 100 / 12;
  let balance = principal;
  let totalInterest = 0;
  let months = 0;
  const yearly: AmortYear[] = [];
  let yPrincipal = 0;
  let yInterest = 0;
  const HARD_CAP = 100 * 12;

  while (balance > 0.005 && months < HARD_CAP) {
    months++;
    const interest = balance * r;
    let principalPart = payment + extra - interest;
    if (principalPart > balance) principalPart = balance; // final payment
    balance -= principalPart;
    totalInterest += interest;
    yPrincipal += principalPart;
    yInterest += interest;
    if (months % 12 === 0 || balance <= 0.005) {
      yearly.push({
        year: Math.ceil(months / 12),
        principalPaid: r2(yPrincipal),
        interestPaid: r2(yInterest),
        balance: r2(Math.max(0, balance)),
      });
      yPrincipal = 0;
      yInterest = 0;
    }
  }
  return { months, totalInterest: r2(totalInterest), yearly };
}

// ---------- FIRE (financial independence / retire early) ----------

export interface FireParams {
  currentAge: number;
  currentBalance: number; // invested assets today
  monthlyContribution: number;
  annualSpending: number; // desired spending in retirement (today's dollars)
  ratePct: number; // expected REAL (after-inflation) annual return
  swrPct?: number; // safe withdrawal rate, default 4
}

export interface FirePoint {
  age: number;
  balance: number;
  contributed: number;
}

export interface FireResult {
  fireNumber: number; // annualSpending / SWR
  swrPct: number;
  alreadyFire: boolean;
  achievable: boolean; // reached before age 100
  fireAge: number | null; // e.g. 47.3
  monthsToFire: number | null;
  fireDate: string | null; // YYYY-MM
  balanceAtFire: number | null;
  series: FirePoint[]; // yearly, ends at FIRE (or age 100)
}

/**
 * When does the portfolio cover `annualSpending` at the safe withdrawal rate?
 * Uses a real (after-inflation) return so the FIRE number stays in today's
 * dollars — no separate inflation input to get wrong.
 */
export function fireProjection(p: FireParams): FireResult {
  const swrPct = p.swrPct ?? 4;
  const fireNumber = r2(p.annualSpending / (swrPct / 100));
  const r = p.ratePct / 100 / 12;
  const capMonths = Math.max(0, Math.round((100 - p.currentAge) * 12));

  let balance = p.currentBalance;
  let contributed = p.currentBalance;
  const series: FirePoint[] = [
    { age: p.currentAge, balance: r2(balance), contributed: r2(contributed) },
  ];

  if (balance >= fireNumber) {
    return {
      fireNumber, swrPct, alreadyFire: true, achievable: true,
      fireAge: p.currentAge, monthsToFire: 0, fireDate: ymFrom(0),
      balanceAtFire: r2(balance), series,
    };
  }

  let months = 0;
  while (balance < fireNumber && months < capMonths) {
    months++;
    balance = balance * (1 + r) + p.monthlyContribution;
    contributed += p.monthlyContribution;
    if (months % 12 === 0 || balance >= fireNumber) {
      series.push({
        age: r2(p.currentAge + months / 12),
        balance: r2(balance),
        contributed: r2(contributed),
      });
    }
  }

  const reached = balance >= fireNumber;
  return {
    fireNumber,
    swrPct,
    alreadyFire: false,
    achievable: reached,
    fireAge: reached ? Math.round((p.currentAge + months / 12) * 10) / 10 : null,
    monthsToFire: reached ? months : null,
    fireDate: reached ? ymFrom(months) : null,
    balanceAtFire: reached ? r2(balance) : null,
    series,
  };
}

export interface CoastParams {
  currentAge: number;
  retireAge: number;
  currentBalance: number;
  monthlyContribution: number; // used to project when you reach coast
  annualSpending: number;
  ratePct: number; // real return
  swrPct?: number; // default 4
}

export interface CoastPoint {
  age: number;
  balance: number;
  coastNumber: number; // threshold at that age
}

export interface CoastResult {
  fireNumber: number;
  coastNumber: number; // needed TODAY to coast to retireAge
  swrPct: number;
  alreadyCoasting: boolean;
  surplus: number; // positive when coasting; negative = gap
  coastAge: number | null; // when contributions get you to coast
  coastDate: string | null;
  monthsToCoast: number | null;
  balanceAtRetirement: number; // coast plan: contribute until coast, then stop
  series: CoastPoint[]; // yearly to retireAge
}

/**
 * Coast FIRE: the amount that — with NO further contributions — compounds to
 * the FIRE number by retirement age. The threshold rises as time passes, so
 * the projection checks the moving target month by month.
 */
export function coastFire(p: CoastParams): CoastResult {
  const swrPct = p.swrPct ?? 4;
  const fireNumber = r2(p.annualSpending / (swrPct / 100));
  const r = p.ratePct / 100 / 12;
  const M = Math.max(0, Math.round((p.retireAge - p.currentAge) * 12));
  const threshold = (m: number) => fireNumber / Math.pow(1 + r, M - m);

  const coastNumber = r2(threshold(0));
  const alreadyCoasting = p.currentBalance >= coastNumber;

  let balance = p.currentBalance;
  let coastMonth: number | null = alreadyCoasting ? 0 : null;
  const series: CoastPoint[] = [
    { age: p.currentAge, balance: r2(balance), coastNumber },
  ];

  for (let m = 1; m <= M; m++) {
    // Coast strategy: contribute until the threshold is met, then stop.
    balance = balance * (1 + r) + (coastMonth === null ? p.monthlyContribution : 0);
    if (coastMonth === null && balance >= threshold(m)) coastMonth = m;
    if (m % 12 === 0 || m === M) {
      series.push({
        age: r2(p.currentAge + m / 12),
        balance: r2(balance),
        coastNumber: r2(threshold(m)),
      });
    }
  }

  return {
    fireNumber,
    coastNumber,
    swrPct,
    alreadyCoasting,
    surplus: r2(p.currentBalance - coastNumber),
    coastAge: coastMonth !== null ? Math.round((p.currentAge + coastMonth / 12) * 10) / 10 : null,
    coastDate: coastMonth !== null ? ymFrom(coastMonth) : null,
    monthsToCoast: coastMonth,
    balanceAtRetirement: r2(balance),
    series,
  };
}

export interface CompoundYear {
  year: number; // 0-based (0 = today)
  balance: number;
  contributed: number; // principal + contributions so far
  interest: number; // balance - contributed
}

export interface CompoundResult {
  finalBalance: number;
  totalContributed: number;
  totalInterest: number;
  series: CompoundYear[];
}

/**
 * Compound growth with monthly contributions (interest compounds monthly,
 * contributions added at the end of each month).
 */
export function compoundGrowth(
  principal: number,
  monthlyContribution: number,
  annualRatePct: number,
  years: number,
): CompoundResult {
  const r = annualRatePct / 100 / 12;
  const totalMonths = Math.round(years * 12);
  let balance = principal;
  let contributed = principal;
  const series: CompoundYear[] = [
    { year: 0, balance: r2(balance), contributed: r2(contributed), interest: 0 },
  ];
  for (let m = 1; m <= totalMonths; m++) {
    balance = balance * (1 + r) + monthlyContribution;
    contributed += monthlyContribution;
    if (m % 12 === 0) {
      series.push({
        year: m / 12,
        balance: r2(balance),
        contributed: r2(contributed),
        interest: r2(balance - contributed),
      });
    }
  }
  return {
    finalBalance: r2(balance),
    totalContributed: r2(contributed),
    totalInterest: r2(balance - contributed),
    series,
  };
}
