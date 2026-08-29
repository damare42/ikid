/**
 * A `node:crypto` stand-in for the hosted demo build only.
 *
 * `services/dedupe.ts` computes each transaction's duplicate-detection hash
 * with `createHash("sha256")`. That module is shared with the demo generator,
 * and `node:crypto` doesn't exist in a browser, so the demo build aliases the
 * import here.
 *
 * This is deliberately NOT a SHA-256 implementation. It is a fast 128-bit
 * FNV-1a/xorshift mix, and it is used for exactly one thing: giving the ~1,200
 * generated demo transactions distinct, stable keys so duplicate detection has
 * something to work with. Nothing security-relevant depends on it — the demo
 * has no passwords, no sessions and no real data.
 *
 * The server keeps using real SHA-256; this alias only applies when
 * VITE_IKID_DEMO is set. If a genuine digest is ever needed in the browser,
 * use `crypto.subtle` and make the call site async rather than strengthening
 * this — a hand-rolled hash that *looks* cryptographic is worse than one that
 * obviously isn't.
 */

const OFFSET = 0xcbf29ce4n;
const PRIME = 0x01000193n;
const MASK = (1n << 64n) - 1n;

class DemoHash {
  private parts: string[] = [];

  update(data: string): this {
    this.parts.push(String(data));
    return this;
  }

  digest(_encoding?: string): string {
    const input = this.parts.join("");
    // Four independently seeded lanes, concatenated — 64 hex characters, the
    // same width as SHA-256, so anything that slices the output still works.
    const lanes: string[] = [];
    for (let seed = 0; seed < 4; seed++) {
      let h = (OFFSET + BigInt(seed) * 0x9e3779b97f4a7c15n) & MASK;
      for (let i = 0; i < input.length; i++) {
        h ^= BigInt(input.charCodeAt(i));
        h = (h * PRIME) & MASK;
        h ^= h >> 29n;
      }
      lanes.push(h.toString(16).padStart(16, "0"));
    }
    return lanes.join("");
  }
}

export const createHash = (_algorithm: string): DemoHash => new DemoHash();

export default { createHash };
