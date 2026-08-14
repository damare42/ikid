/** @type {import('tailwindcss').Config} */
// Ikid "Modernist" redesign theme. See design/tokens.json for the source.
// Strategy: remap the two palettes the app already uses everywhere —
//   `brand` -> the brick-red accent, `slate` -> warm neutrals —
// so existing `bg-slate-*`, `text-slate-*`, `bg-brand-600`, etc. adopt the new
// look without touching every component. Per-screen polish follows.
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
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
        slate: {
          50: "#faf9f8", 100: "#f3f2f2", 200: "#eae7e7", 300: "#d7d3d3",
          400: "#bab6b6", 500: "#9b9797", 600: "#7d7979", 700: "#565252",
          800: "#3a3736", 900: "#201e1d", 950: "#161514",
        },
        // Semantic positives/negatives from the tokens.
        pos: { DEFAULT: "#1a7f5a", dark: "#5fd3a3" },
        neg: { DEFAULT: "#c62f14", dark: "#ff7a5e" },
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
