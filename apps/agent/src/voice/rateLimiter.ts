/**
 * A tiny fixed-window rate limiter for the token-mint route.
 *
 * Minting a realtime token signs a JWT and provisions a room participant slot,
 * so an unthrottled caller holding a session id could loop on the endpoint and
 * amplify into unbounded LiveKit connections / realtime cost. A coarse per-key
 * cap closes that amplification without any external dependency. The legitimate
 * client mints once on join and once per ~4-minute refresh, so a window of a few
 * mints per minute is far above real use yet well below abuse.
 *
 * Fixed-window (not token-bucket) on purpose: it's one Map lookup + compare, has
 * no background timer, and self-prunes lazily as keys are touched — cheap enough
 * to sit on a hot request path. State is per-process (acceptable: the limit is a
 * safety backstop, not a billing-grade quota).
 */
export interface RateLimiter {
  /** Returns true if this key may proceed; false if it has exceeded the window. */
  take(key: string, now?: number): boolean;
}

export interface RateLimiterOptions {
  /** Max allowed calls per key within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  // key -> [windowStart, countInWindow]
  const windows = new Map<string, { start: number; count: number }>();

  return {
    take(key, now = Date.now()): boolean {
      const w = windows.get(key);
      if (w === undefined || now - w.start >= opts.windowMs) {
        // Opportunistically drop windows that have fully elapsed so the Map can't
        // grow without bound under a stream of distinct keys.
        for (const [k, v] of windows) {
          if (now - v.start >= opts.windowMs) windows.delete(k);
        }
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      if (w.count >= opts.limit) return false;
      w.count += 1;
      return true;
    },
  };
}
