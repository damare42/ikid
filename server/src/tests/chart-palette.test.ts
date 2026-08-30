/**
 * Chart-palette guard.
 *
 * The colours in client/src/lib/chartPalette.ts encode a rule — green and
 * crimson mean the direction money moved, everything else is categorical — and
 * they were chosen by search rather than by eye, against three constraints:
 *
 *   1. every colour clears WCAG 1.4.11 (3:1) against the surface it's drawn on
 *   2. colours that appear on the SAME chart stay distinguishable under
 *      simulated deuteranopia and protanopia (~8% of men)
 *   3. no categorical colour is close enough to the semantic pair to be
 *      mistaken for a verdict
 *
 * None of that survives a well-meant "let's warm this blue up a bit" unless
 * something checks.
 *
 * Constraint 2 is deliberately per-chart. The global version — every colour
 * distinct from every other — is unsatisfiable here and also untrue to how a
 * chart is read: `muted` is a neutral grey that collapses onto the income green
 * under deuteranopia, and requiring otherwise drives the whole palette to
 * greyscale. It never shares a chart with income. So `chartCombinations` lists
 * what actually co-occurs and this file measures those pairs. Adding a chart
 * means adding an entry, which is the prompt to check the new combination.
 *
 * The CVD simulation is the standard Viénot/Brettel LMS reduction — an
 * approximation of an approximation, since real dichromacy varies — so the
 * thresholds sit well clear of the ~2.3 just-noticeable ΔE rather than on it.
 * Tritanopia (~1 in 10,000) is deliberately not asserted: the blue↔yellow axis
 * that makes a palette safe for red-green CVD is the axis tritanopia collapses,
 * and asserting it would mean claiming something the palette doesn't do.
 */
import { describe, expect, it } from "vitest";
import {
  type ChartPalette,
  chartCombinations,
  chartPalette,
  chartSurface,
} from "../../../client/src/lib/chartPalette.js";

// --------------------------------------------------------------------------
// colour maths
// --------------------------------------------------------------------------

const channels = (hex: string) => hex.replace("#", "").match(/../g)!.map((h) => parseInt(h, 16) / 255);
const linearise = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toLinear = (hex: string) => channels(hex).map(linearise);

const luminance = (hex: string) => {
  const [r, g, b] = toLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const apply = (m: number[][], v: number[]) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

const RGB_TO_LMS = [
  [0.31399, 0.63951, 0.04649],
  [0.15537, 0.75789, 0.08670],
  [0.01775, 0.10945, 0.87259],
];
const LMS_TO_RGB = [
  [5.47221, -4.6419, 0.16963],
  [-1.1252, 2.29317, -0.1678],
  [0.02980, -0.19318, 1.16364],
];
/** Collapse the missing cone onto the plane the remaining two span. */
const VISION: Record<string, number[][]> = {
  typical: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  deuteranopia: [[1, 0, 0], [0.49421, 0, 1.24827], [0, 0, 1]],
  protanopia: [[0, 1.05118, -0.05116], [0, 1, 0], [0, 0, 1]],
};

function lab(hex: string, vision: string): [number, number, number] {
  const seen = apply(LMS_TO_RGB, apply(VISION[vision], apply(RGB_TO_LMS, toLinear(hex))))
    .map((v) => Math.max(0, Math.min(1, v)));
  const [r, g, b] = seen;
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X / 0.95047), f(Y), f(Z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Perceptual distance under the least forgiving of the three kinds of vision. */
function separation(a: string, b: string): number {
  return Math.min(
    ...Object.keys(VISION).map((vision) => {
      const [l1, a1, b1] = lab(a, vision);
      const [l2, a2, b2] = lab(b, vision);
      return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
    }),
  );
}

/** How much of that distance is hue and saturation rather than lightness. */
function chromaGap(a: string, b: string, vision: string): number {
  const [, a1, b1] = lab(a, vision);
  const [, a2, b2] = lab(b, vision);
  return Math.hypot(a1 - a2, b1 - b2);
}

/** Lightness difference — the part no kind of colour blindness takes away. */
function lightnessGap(a: string, b: string): number {
  return Math.min(...Object.keys(VISION).map((v) => Math.abs(lab(a, v)[0] - lab(b, v)[0])));
}

/** Resolve the names used in `chartCombinations` to hexes. */
function resolve(p: ChartPalette, key: string): string {
  const slot = /^series(\d)$/.exec(key);
  if (slot) return p.series[Number(slot[1])];
  return p[key as keyof ChartPalette] as string;
}

// --------------------------------------------------------------------------
// the simulation itself has to be worth trusting
// --------------------------------------------------------------------------

describe("the colour-vision simulation is doing something", () => {
  it("collapses the hue difference in a red/green pair", () => {
    // Stock Tailwind green-500 and red-500: 126 apart in hue and saturation to
    // most people, 13 apart to a protanope. If this ever stops shrinking, the
    // matrices have stopped working and every assertion below is worthless.
    expect(chromaGap("#22c55e", "#ef4444", "typical")).toBeGreaterThan(100);
    expect(chromaGap("#22c55e", "#ef4444", "protanopia")).toBeLessThan(20);
  });

  it("agrees with known WCAG contrast values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});

// --------------------------------------------------------------------------

for (const mode of ["light", "dark"] as const) {
  const p = chartPalette[mode];
  const surface = chartSurface[mode];

  describe(`${mode} palette`, () => {
    const named: [string, string][] = [
      ["in", p.in], ["out", p.out], ["outAlt", p.outAlt],
      ...p.series.map((hex, i) => [`series[${i}]`, hex] as [string, string]),
      ["muted", p.muted], ["reference", p.reference],
    ];

    // 1.4.11: a graphical object carrying meaning needs 3:1 against what it is
    // drawn on. This is the whole reason the palette is mode-aware — no crimson
    // clears 3:1 on both white and #201e1d while still reading as crimson.
    for (const [name, hex] of named) {
      it(`${name} clears 3:1 on the ${mode} surface`, () => {
        expect(contrast(hex, surface)).toBeGreaterThanOrEqual(3);
      });
    }

    it("money in and money out are told apart by lightness, not hue", () => {
      // The app's own green and crimson are 4.7 apart in hue and saturation to
      // a protanope — for practical purposes, the same colour. What keeps them
      // legible is that one is markedly lighter than the other, which survives
      // every kind of colour blindness and greyscale printing besides. Asserting
      // total ΔE alone would let a future tweak trade the lightness gap for hue
      // and pass while making the pair unreadable for 8% of men.
      expect(lightnessGap(p.in, p.out)).toBeGreaterThan(12);
      expect(separation(p.in, p.out)).toBeGreaterThan(15);
    });

    it("outAlt reads as a second helping of out, not a different meaning", () => {
      // Far enough to count two stacked bars, near enough to stay the same
      // family, and never close to a categorical colour.
      expect(separation(p.out, p.outAlt)).toBeGreaterThan(10);
      for (const hex of p.series) expect(separation(p.outAlt, hex)).toBeGreaterThan(10);
    });

    it("no categorical colour can be mistaken for a verdict", () => {
      // The point of the whole split. A reader who sees the income green is
      // entitled to conclude money arrived; a series colour landing near it
      // puts that conclusion at risk. `muted` and `reference` are excluded —
      // they are neutrals, and the combinations list shows they never appear
      // on a chart that also shows income or spending.
      for (const hex of p.series) {
        expect(separation(hex, p.in)).toBeGreaterThan(10);
        expect(separation(hex, p.out)).toBeGreaterThan(10);
      }
    });

    it("consecutive series slots are the safe pairs", () => {
      // Callers take colours from the front of the ramp, so slots that end up
      // adjacent in a stack are always consecutive.
      for (let i = 0; i < p.series.length - 1; i++) {
        expect(separation(p.series[i], p.series[i + 1])).toBeGreaterThan(18);
      }
    });

    it("the annotation colour is a neutral, not a hue", () => {
      const [, a, b] = lab(p.reference, "typical");
      expect(Math.hypot(a, b)).toBeLessThan(10);
    });

    // The assertion that actually matters.
    for (const [chart, keys] of Object.entries(chartCombinations)) {
      it(`${chart}: every pair on this chart stays distinguishable`, () => {
        const hexes = keys.map((k) => resolve(p, k));
        for (let i = 0; i < hexes.length; i++) {
          for (let j = i + 1; j < hexes.length; j++) {
            const gap = separation(hexes[i], hexes[j]);
            expect(gap, `${keys[i]} vs ${keys[j]} — ΔE ${gap.toFixed(1)}`).toBeGreaterThan(10);
          }
        }
      });
    }
  });
}

describe("the two modes agree about meaning", () => {
  it("green stays green and crimson stays crimson", () => {
    for (const mode of ["light", "dark"] as const) {
      // a* is the red↔green axis: negative is green, positive is red.
      expect(lab(chartPalette[mode].in, "typical")[1]).toBeLessThan(0);
      expect(lab(chartPalette[mode].out, "typical")[1]).toBeGreaterThan(0);
      expect(lab(chartPalette[mode].outAlt, "typical")[1]).toBeGreaterThan(0);
    }
  });

  it("offers the same categorical slots in both modes", () => {
    expect(chartPalette.dark.series).toHaveLength(chartPalette.light.series.length);
  });

  it("the combinations list covers every colour in the palette", () => {
    // A colour nothing claims to use is either dead or, worse, used somewhere
    // the guard isn't looking.
    const used = new Set(Object.values(chartCombinations).flat());
    for (const key of ["in", "out", "outAlt", "muted", "reference"]) expect(used).toContain(key);
    for (let i = 0; i < chartPalette.light.series.length; i++) expect(used).toContain(`series${i}`);
  });
});
