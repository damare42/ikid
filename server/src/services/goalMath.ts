/** Pure goal-planning math (no DB, easily unit-tested). */

export interface GoalInput {
  targetAmount: number;
  currentSaved: number;
  monthlyContribution: number;
  deadline?: Date | null;
  now?: Date;
}

export interface GoalComputed {
  progressPct: number;
  monthsRemaining: number | null;
  estimatedCompletion: string | null; // YYYY-MM
  requiredMonthly: number | null;
  projection: { month: string; balance: number }[];
}

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function computeGoal(g: GoalInput): GoalComputed {
  const now = g.now ?? new Date();
  const remaining = Math.max(0, g.targetAmount - g.currentSaved);
  const progressPct =
    g.targetAmount > 0 ? Math.min(100, (g.currentSaved / g.targetAmount) * 100) : 100;

  let monthsRemaining: number | null = null;
  let estimatedCompletion: string | null = null;
  if (remaining === 0) {
    monthsRemaining = 0;
    estimatedCompletion = ym(now);
  } else if (g.monthlyContribution > 0) {
    monthsRemaining = Math.ceil(remaining / g.monthlyContribution);
    estimatedCompletion = ym(addMonths(now, monthsRemaining));
  }

  let requiredMonthly: number | null = null;
  if (g.deadline) {
    const monthsToDeadline = Math.max(
      1,
      (g.deadline.getFullYear() - now.getFullYear()) * 12 + (g.deadline.getMonth() - now.getMonth()),
    );
    requiredMonthly = Math.max(0, remaining / monthsToDeadline);
  }

  // 24-month projected balance curve (capped at target)
  const projection: { month: string; balance: number }[] = [];
  let bal = g.currentSaved;
  const horizon = monthsRemaining != null ? Math.min(monthsRemaining + 2, 36) : 24;
  for (let i = 0; i <= horizon; i++) {
    projection.push({ month: ym(addMonths(now, i)), balance: Math.round(Math.min(bal, g.targetAmount) * 100) / 100 });
    bal += g.monthlyContribution;
  }

  return {
    progressPct: Math.round(progressPct * 10) / 10,
    monthsRemaining,
    estimatedCompletion,
    requiredMonthly: requiredMonthly != null ? Math.round(requiredMonthly * 100) / 100 : null,
    projection,
  };
}
