/**
 * The limiter is pure arithmetic over a clock, so it's tested directly with an
 * injected `now` rather than by firing hundreds of real requests.
 *
 * The cases that matter are the boundaries: the request that is exactly at the
 * limit must pass, the next must not, and the window must actually reset —
 * an off-by-one here either locks people out of their own app or lets a
 * brute-force through.
 */
import { describe, expect, it } from "vitest";
import { RateLimiter } from "../lib/rateLimit.js";

describe("RateLimiter", () => {
  it("allows exactly `max` requests in a window, then refuses", () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.check("a", 0).allowed).toBe(true);
    expect(rl.check("a", 100).allowed).toBe(true);
    expect(rl.check("a", 200).allowed).toBe(true); // the 3rd is still fine
    expect(rl.check("a", 300).allowed).toBe(false); // the 4th is not
  });

  it("counts down remaining, and floors it at zero", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.check("a", 0).remaining).toBe(1);
    expect(rl.check("a", 1).remaining).toBe(0);
    expect(rl.check("a", 2).remaining).toBe(0);
  });

  it("resets once the window has passed", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.check("a", 0).allowed).toBe(true);
    expect(rl.check("a", 999).allowed).toBe(false);
    expect(rl.check("a", 1000).allowed).toBe(true); // new window, exactly at the edge
  });

  it("tracks each caller separately", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.check("a", 0).allowed).toBe(true);
    expect(rl.check("b", 0).allowed).toBe(true); // b is not punished for a
    expect(rl.check("a", 1).allowed).toBe(false);
  });

  it("reports a Retry-After that is never zero while blocked", () => {
    // A "Retry-After: 0" would invite an immediate retry, which is the
    // opposite of the point.
    const rl = new RateLimiter(1, 1000);
    rl.check("a", 0);
    const blocked = rl.check("a", 999);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("prunes expired windows so the map can't grow forever", () => {
    const rl = new RateLimiter(5, 1000);
    for (let i = 0; i < 50; i++) rl.check(`caller-${i}`, 0);
    expect(rl.size).toBe(50);
    expect(rl.prune(500)).toBe(0); // nothing expired yet
    expect(rl.size).toBe(50);
    expect(rl.prune(1000)).toBe(50); // all windows over
    expect(rl.size).toBe(0);
  });

  it("keeps live windows when pruning", () => {
    const rl = new RateLimiter(5, 1000);
    rl.check("old", 0);
    rl.check("new", 900);
    rl.prune(1000);
    expect(rl.size).toBe(1);
    // "new" kept its window, so it still has its remaining budget
    expect(rl.check("new", 1000).remaining).toBe(3);
  });

  it("refuses nonsense configuration rather than silently allowing everything", () => {
    expect(() => new RateLimiter(0, 1000)).toThrow(/at least 1/);
    expect(() => new RateLimiter(5, 0)).toThrow(/positive/);
  });

  it("does not fire at realistic app usage", () => {
    // A dashboard load is roughly a dozen calls; a busy minute of clicking
    // around might be a hundred. The production limit must not be near that.
    const rl = new RateLimiter(300, 60_000);
    let blocked = 0;
    for (let i = 0; i < 100; i++) if (!rl.check("me", i * 10).allowed) blocked++;
    expect(blocked).toBe(0);
  });
});
