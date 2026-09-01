/**
 * Early-retirement drawdown simulator — pure, deterministic, unit-tested.
 *
 * Models the account types that matter for retiring before 59½:
 *   - Traditional 401k/IRA (pre-tax; ordinary income on withdrawal; 10%
 *     penalty before 59½; RMDs from `rmdAge`)
 *   - Roth (contribution basis withdrawable any time tax/penalty-free;
 *     earnings after 59½; ladder conversions join basis after 5 years)
 *   - Brokerage (long-term capital gains on the growth portion; basis pool
 *     tracked so the taxable share of each sale is exact)
 *   - HSA (tax-free against qualified medical expenses; treated trad-like
 *     after 65)
 *
 * Strategy engine: taxable-first withdrawal waterfall + a Roth conversion
 * ladder sized each year to fill the standard deduction and low brackets.
 * Everything runs in REAL (after-inflation) dollars at a real return rate,
 * so all outputs are in today's dollars against the 2026 tax tables.
 *
 * Simplifications (shown in the UI): federal tax only, standard deduction
 * only, no dividends/interest drag on brokerage, age-59½ modeled as the
 * year you turn 60 (conservative), annual granularity.
 */
import {
  conversionHeadroom, federalTax, rmdAmount, IRMAA_TIER1, type FilingStatus,
} from "./tax.js";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface RetirementParams {
  currentAge: number;
  retireAge: number;
  endAge: number; // plan horizon (e.g. 90)
  filingStatus: FilingStatus;
  annualSpending: number; // after-tax need, today's dollars
  ratePct: number; // real (after-inflation) return
  accounts: {
    trad: { balance: number; contribution: number }; // 401k + trad IRA
    roth: { balance: number; basis: number; contribution: number };
    brokerage: { balance: number; basisPct: number; contribution: number };
    hsa: { balance: number; contribution: number; annualMedical: number };
  };
  ladder: boolean;
  fillBracket: number; // 0 (deduction only), 10, 12, or 22
  rmdAge: number; // 73 or 75 depending on birth year
}

export interface RetirementYear {
  age: number;
  phase: "accumulate" | "retired";
  trad: number;
  roth: number;
  rothBasisAvailable: number;
  brokerage: number;
  hsa: number;
  total: number;
  spendFromHsa: number;
  spendFromBrokerage: number;
  spendFromRothBasis: number;
  spendFromTrad: number;
  spendFromRothEarnings: number;
  conversion: number;
  rmd: number;
  ordinaryIncome: number;
  capitalGains: number;
  tax: number;
  penalty: number;
  shortfall: number;
}

/**
 * The "ideal" penalty-free plan: how much must sit in penalty-free accounts at
 * retirement so you never touch Traditional early, and what it takes to get
 * there (extra monthly investing, or a lump sum today, at the real return).
 */
export interface BridgePlan {
  needed: boolean; // false when retiring at/after 59½
  bridgeYears: number; // years from retirement to penalty-free Traditional access
  yearsToFund: number; // years you must self-fund from penalty-free money
  ladder: boolean;
  targetPot: number; // penalty-free $ needed AT retirement (spending + conversion tax)
  haveAtRetirement: number; // projected penalty-free bridge assets at retirement
  gap: number; // shortfall to close (0 = funded)
  monthsToRetire: number;
  monthlyToClose: number | null; // extra $/mo to invest until retirement
  lumpTodayToClose: number | null; // or invest this once, today
  /**
   * Where that money has to go, and where it must not.
   *
   * This travels with the number because without it the number is wrong. The
   * bridge exists precisely because Traditional 401k/IRA money costs a 10%
   * penalty plus income tax before 59½ — so "invest $279/mo more" carried out
   * inside a Traditional 401k does not shrink the gap at all. It grows the pot
   * you already cannot reach, and leaves the shortfall exactly where it was
   * while looking like progress.
   *
   * Any consumer showing `monthlyToClose` must show this beside it.
   */
  fundIn: string[];
  notIn: string[];
}

export interface RetirementResult {
  success: boolean;
  depletionAge: number | null;
  endingBalance: number;
  totalTax: number;
  totalPenalties: number;
  totalConversions: number;
  bridgeYears: number; // retirement years before trad access
  bridgeNeeded: number; // spending those years must come from bridge assets
  bridgeAvailableAtRetirement: number; // accessible without penalty at retireAge
  bridgePlan: BridgePlan;
  warnings: string[];
  guidance: string[];
  years: RetirementYear[];
}

const ACCESS_AGE = 60; // first full year after turning 59½ (conservative)
const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function simulateRetirement(p: RetirementParams): RetirementResult {
  const r = p.ratePct / 100;

  // --- mutable account state ---
  let trad = p.accounts.trad.balance;
  let roth = p.accounts.roth.balance;
  let rothBasis = Math.min(p.accounts.roth.basis, roth);
  let brok = p.accounts.brokerage.balance;
  let brokBasis = brok * Math.min(100, Math.max(0, p.accounts.brokerage.basisPct)) / 100;
  let hsa = p.accounts.hsa.balance;
  // Ladder conversions season for 5 years: [ageAvailable, amount]
  const seasoning: { availableAt: number; amount: number }[] = [];

  const years: RetirementYear[] = [];
  const warnings: string[] = [];
  let totalTax = 0;
  let totalPenalties = 0;
  let totalConversions = 0;
  let depletionAge: number | null = null;
  let bridgeAvailableAtRetirement = 0;

  for (let age = p.currentAge; age <= p.endAge; age++) {
    const retired = age >= p.retireAge;
    const canTouchTrad = age >= ACCESS_AGE;

    // Mature any ladder conversions that have finished seasoning.
    for (const s of seasoning) {
      if (s.availableAt === age) rothBasis += s.amount;
    }

    let spendHsa = 0, spendBrok = 0, spendBasis = 0, spendTrad = 0, spendEarn = 0;
    let conversion = 0, rmd = 0, ordinaryIncome = 0, capitalGains = 0;
    let tax = 0, penalty = 0, shortfall = 0;

    if (!retired) {
      // -------- accumulation year --------
      trad += p.accounts.trad.contribution;
      roth += p.accounts.roth.contribution;
      rothBasis += p.accounts.roth.contribution;
      brok += p.accounts.brokerage.contribution;
      brokBasis += p.accounts.brokerage.contribution;
      hsa += p.accounts.hsa.contribution;
    } else {
      // -------- retirement year --------
      if (age === p.retireAge) {
        bridgeAvailableAtRetirement = r2(brok + rothBasis + Math.min(hsa, p.accounts.hsa.annualMedical * Math.max(1, ACCESS_AGE - p.retireAge)));
      }

      // RMDs are forced first (ordinary income whether spent or not).
      if (age >= p.rmdAge && trad > 0) {
        rmd = Math.min(trad, rmdAmount(trad, age));
        trad -= rmd;
        ordinaryIncome += rmd;
      }

      // Roth conversion ladder: fill low brackets while trad remains.
      // Stop converting once RMDs start (forced income fills brackets).
      if (p.ladder && trad > 0 && age < p.rmdAge) {
        conversion = Math.min(trad, conversionHeadroom(ordinaryIncome, p.filingStatus, p.fillBracket));
        if (conversion > 0) {
          trad -= conversion;
          roth += conversion;
          ordinaryIncome += conversion;
          totalConversions += conversion;
          if (age + 5 < ACCESS_AGE) {
            seasoning.push({ availableAt: age + 5, amount: conversion });
          } else {
            // matures after 59½ anyway — treat as available at access age
            seasoning.push({ availableAt: ACCESS_AGE, amount: conversion });
          }
        }
      }

      // Withdrawal waterfall. Taxes depend on withdrawals and vice versa —
      // fixed-point iteration converges in a couple of passes.
      const baseOrdinary = ordinaryIncome; // rmd + conversion (stable per pass)
      let need = p.annualSpending;
      for (let pass = 0; pass < 6; pass++) {
        // reset this pass
        let n = need;
        spendHsa = spendBrok = spendBasis = spendTrad = spendEarn = 0;
        penalty = 0;
        let gains = 0;
        let ordinary = baseOrdinary;

        // RMD cash (already taxed as income) covers spending first.
        n = Math.max(0, n - rmd);

        // 1) HSA against qualified medical expenses (tax-free)
        spendHsa = Math.min(hsa, p.accounts.hsa.annualMedical, n);
        n -= spendHsa;

        // 2) Brokerage (gains taxed at LTCG rates)
        if (n > 0 && brok > 0) {
          spendBrok = Math.min(brok, n);
          const gainFrac = brok > 0 ? Math.max(0, 1 - brokBasis / brok) : 0;
          gains = spendBrok * gainFrac;
          n -= spendBrok;
        }

        // 3) Roth contribution basis (tax/penalty-free at any age)
        if (n > 0 && rothBasis > 0) {
          spendBasis = Math.min(rothBasis, roth, n);
          n -= spendBasis;
        }

        // 4) Traditional (post-59½: plain ordinary income)
        if (n > 0 && canTouchTrad && trad > 0) {
          spendTrad = Math.min(trad, n);
          ordinary += spendTrad;
          n -= spendTrad;
        }

        // 5) Roth earnings (post-59½, tax-free)
        if (n > 0 && canTouchTrad && roth - spendBasis > 0) {
          spendEarn = Math.min(roth - spendBasis, n);
          n -= spendEarn;
        }

        // 6) Last resort before 59½: early trad withdrawal (10% penalty)
        if (n > 0 && !canTouchTrad && trad > 0) {
          const early = Math.min(trad, n);
          spendTrad = early;
          ordinary += early;
          penalty = early * 0.10;
          n -= early;
        }

        shortfall = r2(Math.max(0, n));
        tax = federalTax(ordinary, gains, p.filingStatus).tax;
        capitalGains = gains;
        ordinaryIncome = ordinary;

        const newNeed = p.annualSpending + tax + penalty;
        if (Math.abs(newNeed - need) < 1) break;
        need = newNeed;
      }

      // Apply withdrawals to balances.
      hsa -= spendHsa;
      if (spendBrok > 0) {
        const basisUsed = brok > 0 ? brokBasis * (spendBrok / brok) : 0;
        brokBasis = Math.max(0, brokBasis - basisUsed);
        brok -= spendBrok;
      }
      rothBasis -= spendBasis;
      roth -= spendBasis + spendEarn;
      trad -= spendTrad; // early or normal (rmd already deducted)

      totalTax += tax;
      totalPenalties += penalty;

      if (penalty > 0) {
        warnings.push(
          `Age ${age}: had to raid the Traditional account early — ${fmt(penalty)} penalty on ${fmt(spendTrad)}.`,
        );
      }
      if (shortfall > 0 && depletionAge === null) depletionAge = age;

      // Excess RMD beyond spending is reinvested in brokerage (adds basis).
      const rmdExcess = Math.max(0, rmd - p.annualSpending);
      if (rmdExcess > 0) {
        brok += rmdExcess;
        brokBasis += rmdExcess;
      }
    }

    // Growth at end of year.
    trad *= 1 + r;
    roth *= 1 + r;
    brok = brok * (1 + r);
    hsa *= 1 + r;
    // (Roth basis and brokerage basis don't grow — that's the point.)

    years.push({
      age,
      phase: retired ? "retired" : "accumulate",
      trad: r2(trad),
      roth: r2(roth),
      rothBasisAvailable: r2(Math.min(rothBasis, roth)),
      brokerage: r2(brok),
      hsa: r2(hsa),
      total: r2(trad + roth + brok + hsa),
      spendFromHsa: r2(spendHsa),
      spendFromBrokerage: r2(spendBrok),
      spendFromRothBasis: r2(spendBasis),
      spendFromTrad: r2(spendTrad + rmd),
      spendFromRothEarnings: r2(spendEarn),
      conversion: r2(conversion),
      rmd: r2(rmd),
      ordinaryIncome: r2(ordinaryIncome),
      capitalGains: r2(capitalGains),
      tax: r2(tax),
      penalty: r2(penalty),
      shortfall,
    });
  }

  const last = years[years.length - 1];
  const bridgeYears = Math.max(0, ACCESS_AGE - p.retireAge);
  const bridgeNeeded = r2(bridgeYears * p.annualSpending);

  // Ideal penalty-free plan. With a ladder you only self-fund the 5-year
  // seasoning window (plus the conversion taxes during it); without one you
  // self-fund every bridge year. Taxes come from the actual simulated years.
  const yearsToFund = p.ladder ? Math.min(5, bridgeYears) : bridgeYears;
  const retiredYears = years.filter((y) => y.phase === "retired");
  const bridgeTaxes = retiredYears.slice(0, yearsToFund).reduce((s, y) => s + y.tax, 0);
  const bridgePlan = computeBridgePlan({
    currentAge: p.currentAge,
    retireAge: p.retireAge,
    annualSpending: p.annualSpending,
    ladder: p.ladder,
    realRatePct: p.ratePct,
    haveAtRetirement: r2(bridgeAvailableAtRetirement),
    bridgeTaxes: r2(bridgeTaxes),
  });

  // Medicare IRMAA: from age 63 (two-year lookback to 65), a year whose MAGI
  // (ordinary income + gains) tops the first surcharge tier raises Part B/D
  // premiums two years later. Large conversions are the usual trigger.
  const irmaaThreshold = IRMAA_TIER1[p.filingStatus];
  const irmaaHits = years.filter(
    (y) => y.age >= 63 && y.ordinaryIncome + y.capitalGains > irmaaThreshold,
  );
  const irmaa = irmaaHits.length > 0
    ? { years: irmaaHits.length, threshold: irmaaThreshold, firstAge: irmaaHits[0].age }
    : null;

  const guidance = buildGuidance(p, {
    bridgeYears, bridgeNeeded, bridgeAvailableAtRetirement,
    depletionAge, totalPenalties, totalConversions, irmaa,
  });

  return {
    success: depletionAge === null && totalPenalties === 0,
    depletionAge,
    endingBalance: last.total,
    totalTax: r2(totalTax),
    totalPenalties: r2(totalPenalties),
    totalConversions: r2(totalConversions),
    bridgeYears,
    bridgeNeeded,
    bridgeAvailableAtRetirement: r2(bridgeAvailableAtRetirement),
    bridgePlan,
    warnings: warnings.slice(0, 8),
    guidance,
    years,
  };
}

/**
 * Back-solve the penalty-free bridge: the target pot at retirement, the gap
 * versus what you're on track to have, and the extra monthly investing (or a
 * lump sum today) needed to close it — using the same compound-growth math as
 * the Calculators, at the plan's real return.
 */
export function computeBridgePlan(opts: {
  currentAge: number;
  retireAge: number;
  annualSpending: number;
  ladder: boolean;
  realRatePct: number;
  haveAtRetirement: number;
  bridgeTaxes: number;
}): BridgePlan {
  const bridgeYears = Math.max(0, ACCESS_AGE - opts.retireAge);
  const yearsToFund = opts.ladder ? Math.min(5, bridgeYears) : bridgeYears;
  const targetPot = r2(opts.annualSpending * yearsToFund + opts.bridgeTaxes);
  const gap = r2(Math.max(0, targetPot - opts.haveAtRetirement));
  const monthsToRetire = Math.max(0, Math.round((opts.retireAge - opts.currentAge) * 12));
  const rM = opts.realRatePct / 100 / 12;

  let monthlyToClose: number | null = null;
  let lumpTodayToClose: number | null = null;
  if (gap > 0 && monthsToRetire > 0) {
    // Future value of an ordinary annuity: FV = PMT × ((1+r)^n − 1) / r
    monthlyToClose = r2(rM === 0 ? gap / monthsToRetire : (gap * rM) / (Math.pow(1 + rM, monthsToRetire) - 1));
    lumpTodayToClose = r2(gap / Math.pow(1 + rM, monthsToRetire));
  } else if (gap > 0) {
    // Already at/after retirement — no time to invest; it's a lump today.
    lumpTodayToClose = gap;
  }

  return {
    needed: bridgeYears > 0,
    bridgeYears,
    yearsToFund,
    ladder: opts.ladder,
    targetPot,
    haveAtRetirement: r2(opts.haveAtRetirement),
    gap,
    monthsToRetire,
    // Ordered by how freely the money comes out before 59½. Taxable first
    // because it has no age rule at all and long-term gains are often taxed at
    // 0% at early-retirement income levels; Roth *contributions* next because
    // your own basis is always withdrawable penalty-free (earnings are not);
    // HSA last because it is penalty-free only against qualified medical costs.
    fundIn: [
      "a taxable brokerage account",
      "Roth IRA contributions (your basis, not the earnings)",
      "an HSA, for medical costs",
    ],
    notIn: [
      "a Traditional 401k or IRA — locked until 59½, and adding to it grows the pot you can't reach",
    ],
    monthlyToClose,
    lumpTodayToClose,
  };
}

function buildGuidance(
  p: RetirementParams,
  s: {
    bridgeYears: number; bridgeNeeded: number; bridgeAvailableAtRetirement: number;
    depletionAge: number | null; totalPenalties: number; totalConversions: number;
    irmaa: { years: number; threshold: number; firstAge: number } | null;
  },
): string[] {
  const g: string[] = [];

  if (s.bridgeYears > 0) {
    g.push(
      `Retiring at ${p.retireAge} means ${s.bridgeYears} years before Traditional money unlocks (59½). ` +
      `Those years need ~${fmt(s.bridgeNeeded)} (plus conversion taxes) from bridge assets: brokerage, Roth contributions, and HSA.`,
    );
    const gap = s.bridgeNeeded - s.bridgeAvailableAtRetirement;
    if (gap > 0) {
      g.push(
        `At retirement you'd have ~${fmt(s.bridgeAvailableAtRetirement)} of bridge assets — ` +
        `${fmt(gap)} short${p.ladder ? " before the ladder helps in year 6" : ""}. ` +
        `Shift contributions toward brokerage and Roth (after any employer match) to close it.`,
      );
    } else {
      g.push(`Your bridge is funded: ~${fmt(s.bridgeAvailableAtRetirement)} accessible at ${p.retireAge} vs ~${fmt(s.bridgeNeeded)} needed.`);
    }
    if (p.ladder) {
      g.push(
        `The Roth ladder needs a 5-year runway: conversions made at ${p.retireAge} become spendable at ${p.retireAge + 5}. ` +
        `Years 1–5 must be covered entirely by bridge assets (~${fmt(5 * p.annualSpending)}).`,
      );
    }
  }

  if (p.ladder && s.totalConversions > 0) {
    g.push(
      `The ladder converts ~${fmt(s.totalConversions)} of Traditional money over the plan, taxed while you're in ` +
      `low brackets (filling ${p.fillBracket === 0 ? "just the standard deduction — tax-free" : `up to the ${p.fillBracket}% bracket`}) instead of at RMD time.`,
    );
  }

  g.push(
    "Ideal withdrawal order in retirement: spend taxable interest/dividends and RMDs (once forced) first, then " +
    "sell brokerage for low-rate long-term gains, then tap Roth — while converting Traditional → Roth each year up to your " +
    "target bracket. It keeps each year's taxable income low and smooth instead of spiking it later.",
  );

  g.push(
    "Classic funding order while working: 401k up to the employer match → HSA (triple tax advantage — keep medical receipts) → " +
    "Roth IRA → rest of 401k → brokerage for the bridge. Early retirees often flip the last two to fatten the bridge.",
  );

  if (s.irmaa) {
    g.push(
      `🏥 Medicare (IRMAA): ${s.irmaa.years} year${s.irmaa.years === 1 ? "" : "s"} from age ${s.irmaa.firstAge} push MAGI over ` +
      `~${fmt(s.irmaa.threshold)} (${p.filingStatus === "married" ? "joint" : "single"}), which raises your Part B & D premiums two years later. ` +
      "Front-load bigger Roth conversions before 63, then ease off — or accept the surcharge as the price of a smaller taxable RMD later.",
    );
  } else if (p.ladder && s.totalConversions > 0) {
    g.push(
      "🏥 Medicare (IRMAA): your conversions stay under the first Medicare surcharge threshold, so Part B/D premiums aren't affected — a nice side effect of filling only the lower brackets.",
    );
  }

  if (s.depletionAge != null) {
    g.push(`⚠️ Money runs out at age ${s.depletionAge}. Lower spending, retire later, or save more per year.`);
  }
  return g;
}
