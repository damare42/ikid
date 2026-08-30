/**
 * Chart colours, and the rule about what they mean.
 *
 * There are two palettes here and the distinction between them is the entire
 * point of the file.
 *
 *   `in` / `out` are SEMANTIC. Green means money came in. Crimson means money
 *            went out. A series may only use them if that is literally what it
 *            is: income vs spending, assets vs liabilities, tax paid, a debt
 *            balance. If a reader sees green they are entitled to conclude
 *            "money arrived", and nothing in the app may make that wrong.
 *
 *   `series` is CATEGORICAL. It means "this is a different thing from that
 *            thing" and nothing more. Use it whenever two series are simply
 *            different — principal vs interest, Roth vs brokerage, a proposed
 *            scenario vs its baseline.
 *
 * The rule exists because the app was breaking it. The amortization chart drew
 * principal in green and interest in crimson, but both of those are money
 * leaving your account every month — the green was saying "good", not "in".
 * Roth balances were green, goal progress was green, budget bars under 100%
 * were green, and the planner drew its proposed scenario in green *before the
 * engine had said whether it beat the baseline*. Once green means "the nice
 * one", it stops meaning "income", and then the income chart is making a claim
 * the reader can no longer trust.
 *
 * ---------------------------------------------------------------------------
 * Why there are two ramps rather than one
 *
 * WCAG 1.4.11 asks for 3:1 between a meaningful graphical object and its
 * background. Clearing that against BOTH white and the dark panel (#201e1d)
 * confines a colour to relative luminance ~0.14–0.30 — and no crimson in that
 * band still looks like crimson; searching it returns neon reds. So light and
 * dark are chosen separately against their own surface. Every value below
 * clears 3:1 on the surface it is actually drawn on.
 *
 * ---------------------------------------------------------------------------
 * Why these particular values
 *
 * Picked by search, not by eye, then checked under simulated deuteranopia and
 * protanopia — together about 8% of men. Two series a reader can't tell apart
 * are one series.
 *
 * The check is per chart, not global, because that is the only thing that
 * matters and the global version is unsatisfiable. Requiring `muted` grey to
 * be distinct from the income green forces the whole palette to greyscale, and
 * `muted` never appears on a chart that shows income. So the guard in
 * server/src/tests/chart-palette.test.ts encodes which colours actually share a
 * chart and measures those pairs. Worst co-occurring pair as shipped: ΔE 13.1.
 *
 * `series` is an ORDERED ramp and callers take from the front, so a stack or a
 * grouped bar assigns colours in order and the ends never touch. Four is the
 * ceiling. On the blue↔yellow axis that survives red-green colour blindness
 * there is room for about three hues plus a neutral; a fifth categorical
 * colour would have to collide with something, and the honest response is to
 * redesign the chart rather than to add one.
 *
 * Tritanopia (~1 in 10,000) is not satisfied and isn't claimed to be: the same
 * blue↔yellow axis that rescues red-green CVD is the one tritanopia collapses.
 *
 * The palette lives here rather than in Tailwind because Recharts takes literal
 * colour props, not classes. It has no imports so the test can read the shipped
 * values without pulling React into a node process; the `useChartColors` hook
 * that picks between the two ramps is next door in chartColors.ts.
 */

export type ChartPalette = {
  /** Semantic: money arrived. Only for series that really are money in. */
  in: string;
  /** Semantic: money left. Only for series that really are money out. */
  out: string;
  /**
   * A second slice of the same money-out stack — the same meaning as `out`, one
   * step along so two outflows in one bar stay countable (tax and penalty, say).
   * Darker than `out` in light mode, lighter in dark mode; either way it is the
   * same colour family, which is the point. Only ever used *with* `out`.
   */
  outAlt: string;
  /** Categorical. Take from the front; consecutive slots are the safe pairs. */
  series: readonly [string, string, string, string];
  /** A comparator that should recede: a baseline, a "keep as-is", a contributed line. */
  muted: string;
  /**
   * Annotation lines and their labels — a target, a threshold, an age marker.
   * Deliberately near-neutral rather than a hue: an annotation is not a series,
   * and giving it one costs a slot in the ramp and invites the reader to weigh
   * it against the data as though it were more data. The FIRE target used to be
   * drawn in the money-out crimson, which framed the goal as a warning.
   */
  reference: string;
};

const LIGHT: ChartPalette = {
  // emerald-500 rather than the emerald-600 used for positive *text*. To a
  // protanope this green and the crimson below differ by 4.7 in hue and
  // saturation — effectively not at all — so the pair is carried entirely by
  // lightness, and 600 left only an 11.9 gap. One step lighter makes it 14.1
  // and costs nothing: the value is already in the app's ramp and already
  // clears AA on white.
  in: "#1c8560",
  out: "#a4123a",
  outAlt: "#5f0a21",
  series: ["#3a6098", "#8a5f0e", "#5a52d8", "#6d2352"],
  muted: "#6b6666",
  reference: "#211f1e",
};

const DARK: ChartPalette = {
  in: "#5fd3a3",
  out: "#c9436b",
  outAlt: "#e86e8d",
  series: ["#8ab0e0", "#d9a83f", "#4fb6c4", "#936834"],
  muted: "#a8a3a3",
  reference: "#6f6a6a",
};

export const chartPalette = { light: LIGHT, dark: DARK } as const;

/** The surface each ramp is drawn on — what the contrast guard measures against. */
export const chartSurface = { light: "#ffffff", dark: "#201e1d" } as const;

/**
 * Which colours end up on the same chart.
 *
 * This is the list the accessibility guard checks, and it is the reason the
 * guard is useful rather than decorative: a global "everything must differ from
 * everything" rule is both unsatisfiable and untrue to how the charts are read.
 * Adding a chart, or recolouring one, means adding or amending an entry here —
 * which is the prompt to check whether the new combination actually works.
 */
export const chartCombinations: Record<string, readonly (keyof ChartPalette | `series${0 | 1 | 2 | 3}`)[]> = {
  "Analytics · yearly totals": ["in", "out", "series0", "series1"],
  "Analytics · trends": ["in", "out"],
  "Dashboard · income vs expenses": ["in", "out"],
  "Reports · income vs expenses": ["in", "out"],
  "Net Worth · assets, liabilities, net": ["in", "out", "series0"],
  "Calculators · amortization": ["series0", "series1", "muted"],
  "Calculators · compound growth": ["series0", "muted"],
  "Calculators · FIRE": ["series0", "muted", "reference"],
  "Calculators · Coast FIRE": ["series0", "series1", "reference"],
  "Retirement · account balances": ["series0", "series1", "series2", "series3", "reference"],
  "Retirement · tax and penalties": ["out", "outAlt", "series0"],
  "Planner · scenario vs baseline": ["series0", "muted"],
  "Admin · events and users": ["series0", "series1"],
};
