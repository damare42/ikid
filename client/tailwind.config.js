/** @type {import('tailwindcss').Config} */
// Ikid "Modernist" redesign theme. See design/tokens.json for the source.
// Strategy: remap the two palettes the app already uses everywhere —
//   `brand` -> the brick-red accent, `slate` -> warm neutrals —
// so existing `bg-slate-*`, `text-slate-*`, `bg-brand-600`, etc. adopt the new
// look without touching every component. Per-screen polish follows.
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  darkMode: "class",
  // Absolute, not relative. Tailwind resolves content globs against the
  // process working directory, not against this config file — so when the
  // demo build ran from the repo root ("vite build client"), "./src/**" matched
  // nothing, Tailwind emitted no utilities at all, and the deployed app was a
  // column of unstyled text. It looked like a broken stylesheet; it was a
  // stylesheet that had been generated almost empty.
  content: [path.join(here, "index.html"), path.join(here, "src/**/*.{ts,tsx}")],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Archivo"', "system-ui", "sans-serif"],
        heading: ['"Archivo"', "system-ui", "sans-serif"],
      },
      colors: {
        // Accent (brick red). 600 = the ships-with accent (#c62f14).
        brand: {
          50: "#fff2ef", 100: "#ffe3db", 200: "#f9bcac", 300: "#ee9179",
          400: "#df5f42", 500: "#d13f22", 600: "#c62f14", 700: "#a82710",
          800: "#8a1f0c", 900: "#6f180a",
        },
        // Warm neutral ramp (replaces Tailwind's cool slate). Chosen so the
        // app's usual surfaces land on the Modernist tokens in both modes:
        // light bg=slate-50/100, dark bg=slate-950, dark panel=slate-900.
        // 400/500 are darkened vs. the raw design-system ramp: the app uses
        // slate-500 for small muted/meta text, and the original #9b9797 was
        // only 2.89:1 on white (below even the 3:1 large-text floor).
        // 500 now clears AA for small text; 400 clears 3:1 for icons/hints.
        slate: {
          50: "#faf9f8", 100: "#f3f2f2", 200: "#eae7e7", 300: "#d7d3d3",
          400: "#949090", 500: "#767272", 600: "#645f5f", 700: "#565252",
          800: "#3a3736", 900: "#201e1d", 950: "#161514",
        },
        // Tailwind's stock `rose` is repointed to the same crimson as `neg`.
        // The app uses rose-* widely for destructive/negative text, and the
        // stock rose-500 (#f43f5e) is only 3.67:1 on white — below WCAG AA.
        // This ramp keeps every stop used in the app at AA or better.
        rose: {
          50: "#fdf2f5", 100: "#fbe0e8", 200: "#f4bccd", 300: "#e88ea9",
          400: "#dd6288", 500: "#bd2453", 600: "#a4123a", 700: "#8a0f31",
          800: "#6f0c28", 900: "#5a0a20", 950: "#360513",
        },
        // Same treatment for `emerald` (the app's positive/income colour).
        // Stock emerald-600 (#059669) is 3.77:1 on white and emerald-500 is
        // 2.54:1 — both below AA, and emerald-600 is the most-used positive
        // class in the app. This ramp is built around the `pos` token.
        emerald: {
          50: "#eef7f3", 100: "#d6ece2", 200: "#a9d8c5", 300: "#74c0a4",
          400: "#45a883", 500: "#1c8560", 600: "#1a7f5a", 700: "#146849",
          800: "#10523a", 900: "#0d4230", 950: "#06241a",
        },
        // `amber` (warnings / stale badges). Stock amber-500 is 2.15:1 and
        // amber-600 is 3.19:1 on white — unreadable. Rebuilt around `warn`.
        amber: {
          50: "#fdf6e8", 100: "#f9ead0", 200: "#eed08a", 300: "#e0ad55",
          400: "#c28a1c", 500: "#9c6d11", 600: "#9a6a10", 700: "#82590f",
          800: "#6a480d", 900: "#573b0b", 950: "#2f1f06",
        },
        // Semantic positives/negatives.
        // NOTE: `neg` is deliberately a crimson distinct from the brick-red
        // brand accent, so "primary action" and "money out" never read as the
        // same colour. Both pass WCAG AA as text (7.70:1 / 8.79:1 on panel).
        pos: { DEFAULT: "#1a7f5a", dark: "#5fd3a3" },
        neg: { DEFAULT: "#a4123a", dark: "#ffa2b8" },
        warn: { DEFAULT: "#9a6a10", dark: "#e0ad55" },
      },
      borderRadius: {
        // Design rule: 0 on structure, 9px only on interactive chrome.
        chrome: "9px",
        bubble: "14px",
      },
    },
  },
  plugins: [],
};
