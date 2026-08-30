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

/** Re-exported so callers need only one import. */
export { chartPalette };
export type { ChartPalette };
