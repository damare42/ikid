/**
 * The React side of the chart palette: pick the ramp that matches the theme.
 *
 * The values themselves, and the reasoning behind them, are in chartPalette.ts.
 */
import { useEffect, useState } from "react";
import { type ChartPalette, chartPalette } from "./chartPalette";

const LIGHT = chartPalette.light;
const DARK = chartPalette.dark;

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

/**
 * The palette for the current theme.
 *
 * The `dark` class on <html> is the source of truth — `applyTheme` in App.tsx
 * writes it, and it also changes when the OS theme changes under the "system"
 * setting. Rather than thread a context through every page to a handful of
 * chart props, this watches the attribute that already exists. One observer
 * per mounted chart is cheap; a stale palette is not, because it would leave
 * dark-mode charts drawn in the light-mode crimson at 2.2:1.
 */
export function useChartColors(): ChartPalette {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(isDark()));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    setDark(isDark());
    return () => obs.disconnect();
  }, []);
  return dark ? DARK : LIGHT;
}

/**
 * Render a Recharts legend label in body text rather than the series colour.
 *
 * Recharts paints each legend label in its series' colour by default, which
 * quietly moves a colour chosen for one contrast rule into a context governed
 * by a stricter one: a chart fill needs 3:1 (WCAG 1.4.11), text needs 4.5
 * (1.4.3). Measured on the live demo in dark mode, the money-out crimson came
 * out at 3.56:1 as a legend label — a value this file had picked, used somewhere
 * this file didn't intend.
 *
 * The swatch beside the label already carries the colour, so the label doesn't
 * need to. Same reasoning as the category Badge.
 */
export function legendLabel(value: string) {
  return <span className="text-slate-700 dark:text-slate-200">{value}</span>;
}

/** Re-exported so callers need only one import. */
export { chartPalette };
export type { ChartPalette };
