/**
 * Design-token accessibility guard.
 *
 * Every colour the app uses as TEXT must meet WCAG 2.1 AA (4.5:1 for normal
 * text). Tailwind's stock palettes do NOT — `emerald-600` is 3.77:1 on white,
 * `rose-500` is 3.67:1, `amber-500` is 2.15:1 — so client/tailwind.config.js
 * repoints them. This test pins the ramps that shipped, so a future palette
 * tweak can't silently reintroduce unreadable text.
 *
 * Keep in sync with client/tailwind.config.js.
 */
import { describe, expect, it } from "vitest";

const AA = 4.5;

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const rgb = hex.replace("#", "").match(/../g)!.map((h) => {
    const v = parseInt(h, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Surfaces text sits on.
const WHITE = "#ffffff";      // --panel, light
const GROUND = "#f3f2f2";     // --bg, light
const PANEL_DARK = "#201e1d"; // --panel, dark

// The ramps shipped in client/tailwind.config.js.
const brand = { 600: "#c62f14", 700: "#a82710", 800: "#8a1f0c", 400: "#df5f42" };
const emerald = { 500: "#1c8560", 600: "#1a7f5a", 700: "#146849", 300: "#74c0a4", 400: "#45a883" };
const rose = { 500: "#bd2453", 600: "#a4123a", 700: "#8a0f31", 300: "#e88ea9", 400: "#dd6288" };
const amber = { 500: "#9c6d11", 600: "#9a6a10", 700: "#82590f", 300: "#e0ad55" };
const slate = { 400: "#949090", 500: "#767272", 600: "#645f5f", 700: "#565252", 900: "#201e1d" };

describe("contrast() helper", () => {
  it("matches known WCAG values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("flags the stock Tailwind colours we had to replace", () => {
    expect(contrast("#059669", WHITE)).toBeLessThan(AA); // stock emerald-600
    expect(contrast("#f43f5e", WHITE)).toBeLessThan(AA); // stock rose-500
    expect(contrast("#f59e0b", WHITE)).toBeLessThan(AA); // stock amber-500
    expect(contrast("#1cb474", WHITE)).toBeLessThan(AA); // the old ikid green
  });
});

describe("light-mode text tokens meet WCAG AA", () => {
  const cases: [string, string][] = [
    ["brand-600 (primary action / link)", brand[600]],
    ["brand-700 (active nav)", brand[700]],
    ["emerald-500 (positive)", emerald[500]],
    ["emerald-600 (positive, most used)", emerald[600]],
    ["emerald-700", emerald[700]],
    ["rose-500 (negative / destructive)", rose[500]],
    ["rose-600 (negative)", rose[600]],
    ["rose-700", rose[700]],
    ["amber-500 (warning)", amber[500]],
    ["amber-600 (warning)", amber[600]],
    ["slate-700 (body)", slate[700]],
    ["slate-900 (headings)", slate[900]],
  ];

  for (const [name, hex] of cases) {
    it(`${name} on white`, () => {
      expect(contrast(hex, WHITE)).toBeGreaterThanOrEqual(AA);
    });
  }

  // Text also sits directly on the ground colour, which is darker than panel.
  it("body text passes on the ground colour too", () => {
    expect(contrast(slate[700], GROUND)).toBeGreaterThanOrEqual(AA);
    expect(contrast(slate[900], GROUND)).toBeGreaterThanOrEqual(AA);
  });

  // slate-500/600 carry small muted/meta text, so they must clear AA outright.
  it("muted meta text (slate-500/600) clears AA for small text", () => {
    expect(contrast(slate[500], WHITE)).toBeGreaterThanOrEqual(AA);
    expect(contrast(slate[600], WHITE)).toBeGreaterThanOrEqual(AA);
  });

  // slate-400 is only used for de-emphasised hints and icon glyphs.
  it("slate-400 clears the 3:1 non-text / large-text floor", () => {
    expect(contrast(slate[400], WHITE)).toBeGreaterThanOrEqual(3);
  });
});

describe("dark-mode text tokens meet WCAG AA", () => {
  const cases: [string, string][] = [
    ["brand-400 (active nav, dark)", brand[400]],
    ["emerald-300", emerald[300]],
    ["emerald-400", emerald[400]],
    ["rose-300", rose[300]],
    ["rose-400", rose[400]],
    ["amber-300", amber[300]],
  ];

  for (const [name, hex] of cases) {
    it(`${name} on the dark panel`, () => {
      expect(contrast(hex, PANEL_DARK)).toBeGreaterThanOrEqual(AA);
    });
  }
});

describe("semantic colours stay distinguishable", () => {
  it("the negative colour is NOT the brand accent", () => {
    // "money out" must never render in the same colour as "primary action".
    expect(rose[600]).not.toBe(brand[600]);
    // and they should differ enough to read as different hues
    expect(Math.abs(luminance(rose[600]) - luminance(brand[600]))).toBeGreaterThan(0.005);
  });

  it("positive and negative differ strongly in luminance, not just hue", () => {
    // Red/green pairs are the classic colour-blindness trap. A luminance gap
    // means they remain tellable apart in greyscale — the labels do the rest.
    const gap = Math.abs(luminance(emerald[600]) - luminance(rose[600]));
    expect(gap).toBeGreaterThan(0.02);
  });
});
