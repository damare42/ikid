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
import { DEFAULT_CATEGORIES } from "../services/defaults.js";

const AA = 4.5;

/** `fg` laid over `bg` at the given alpha — what a translucent tint resolves to. */
function blend(fg: string, bg: string, alpha: number): string {
  const ch = (h: string) => h.replace("#", "").match(/../g)!.map((x) => parseInt(x, 16));
  const [f, b] = [ch(fg), ch(bg)];
  const out = f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

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

describe("user-chosen colours are never used as text", () => {
  // Measured on the live demo: the category chips were painting their labels in
  // the category's own colour, and the shipped defaults are stock Tailwind
  // hues — Transportation came out at 2.15:1, Groceries 2.28, Utilities 2.77,
  // Dining 2.80. The app rebuilt its own ramps precisely because stock hues
  // fail as text, then handed the category defaults a way around it.
  //
  // Curating better defaults would not fix it. The colour is user-editable, so
  // any rule that depends on it being legible is a rule a colour picker can
  // break. `Badge` therefore puts the colour in a dot and leaves the label in
  // body text. This test exists to show why that isn't a stylistic preference.
  it("a category colour is legible as a dot, everywhere it is drawn", () => {
    // The dot is a graphical object (WCAG 1.4.11, 3:1). It sits on a 13% tint
    // of itself, and that chip sits on either the light card or the dark panel.
    // Utilities used to fail this at 2.42:1 — which is what sent the default
    // palette back for a lightness pass.
    for (const { name, color } of DEFAULT_CATEGORIES) {
      for (const [surface, label] of [[WHITE, "light"], [PANEL_DARK, "dark"]] as const) {
        const tint = blend(color, surface, 0x22 / 255);
        expect(contrast(color, tint), `${name} dot on its tint (${label})`).toBeGreaterThanOrEqual(3);
        expect(contrast(color, surface), `${name} dot on the ${label} surface`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("but is still not safe as text, which is why Badge doesn't use it that way", () => {
    // Clearing 3:1 as a graphic is not the same as clearing 4.5:1 as text, and
    // most of these don't. The colour is user-editable besides, so no palette
    // can make a rule of it. Hence: colour in the dot, label in body text.
    const readableAsText = DEFAULT_CATEGORIES.filter((c) => contrast(c.color, WHITE) >= AA);
    expect(readableAsText.length).toBeLessThan(DEFAULT_CATEGORIES.length);
  });
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
