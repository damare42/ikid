/**
 * A small fixed-window rate limiter.
 *
 * Why in-house rather than `express-rate-limit`: PRINCIPLES.md keeps the
 * dependency list short, and the whole mechanism is forty lines of arithmetic
 * that we can unit-test directly. It also means no new supply-chain surface on
 * the request path of a finance app.
 *
 * What this is and isn't for. Running on localhost, the only client is you, so
 * this never fires. It matters in the hosted mode (`docs/DEPLOY-ONLINE.md`),
 * where the server is reachable from the internet and an unauthenticated
 * endpoint answering as fast as it can be asked is a free denial-of-service —
 * and where /api/auth is a place to guess passwords. `authService` already
 * locks a *profile* after repeated failures; this limits an *address*, which
 * is what stops someone spraying one guess across many usernames.
 *
 * Deliberately not distributed: state is per-process and in memory. Restarting
 * clears it. For a single-instance self-host that is the honest trade, and
 * pretending otherwise would need Redis.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** Seconds until the window resets — what a Retry-After header wants. */
  retryAfterSeconds: number;
}

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {
    if (max < 1) throw new Error("rate limit max must be at least 1");
    if (windowMs < 1) throw new Error("rate limit window must be positive");
  }

  /** Record a request from `key` and say whether it's allowed. */
  check(key: string, now = Date.now()): RateLimitDecision {
    const entry = this.hits.get(key);

    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.max - 1, retryAfterSeconds: 0 };
    }

    entry.count++;
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    if (entry.count > this.max) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: this.max - entry.count, retryAfterSeconds };
  }

  /**
   * Drop windows that have expired. Without this the map grows once per unique
   * address forever, which would turn a rate limiter into the memory leak it
   * was added to prevent.
   */
  prune(now = Date.now()): number {
    let removed = 0;
    for (const [key, entry] of this.hits) {
      if (now >= entry.resetAt) {
        this.hits.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Number of addresses currently being tracked (for tests and diagnostics). */
  get size(): number {
    return this.hits.size;
  }

  reset(): void {
    this.hits.clear();
  }
}

// ---------- express glue ----------

import type { NextFunction, Request, Response } from "express";

/**
 * Limits chosen so a person never meets them and a script does.
 *
 * A dashboard load fires roughly a dozen API calls, so 300/minute leaves an
 * order of magnitude of headroom for normal use, including a fast click-around
 * or a big import. Auth is far tighter because there is no legitimate reason to
 * attempt 30 sign-ins in five minutes.
 */
export const API_MAX = Number(process.env.IKID_RATE_LIMIT_MAX ?? 300);
export const API_WINDOW_MS = 60_000;
export const AUTH_MAX = Number(process.env.IKID_AUTH_RATE_LIMIT_MAX ?? 30);
export const AUTH_WINDOW_MS = 5 * 60_000;

/** Identify the caller. Behind a proxy this needs IKID_TRUST_PROXY set, or
 *  every request looks like it comes from the proxy — see docs/DEPLOY-ONLINE.md. */
const keyOf = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? "unknown";

export function rateLimit(limiter: RateLimiter, message: string) {
  // Prune on a timer rather than per-request: sweeping the whole map on every
  // call would make the limiter itself the slow path.
  const timer = setInterval(() => limiter.prune(), 60_000);
  timer.unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    const decision = limiter.check(keyOf(req));
    res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    if (decision.allowed) return next();
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    res.status(429).json({ error: message });
  };
}
