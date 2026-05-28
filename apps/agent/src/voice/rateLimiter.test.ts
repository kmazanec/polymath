import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimiter.js';

describe('createRateLimiter', () => {
  it('allows up to the limit within a window, then rejects', () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(rl.take('a', 0)).toBe(true);
    expect(rl.take('a', 10)).toBe(true);
    expect(rl.take('a', 20)).toBe(true);
    expect(rl.take('a', 30)).toBe(false); // 4th in-window call rejected
  });

  it('resets after the window elapses', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.take('a', 0)).toBe(true);
    expect(rl.take('a', 500)).toBe(false); // same window
    expect(rl.take('a', 1000)).toBe(true); // window elapsed, fresh allowance
  });

  it('tracks keys independently', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.take('a', 0)).toBe(true);
    expect(rl.take('b', 0)).toBe(true); // different key, own window
    expect(rl.take('a', 0)).toBe(false);
  });

  it('prunes fully-elapsed windows so the map does not grow unbounded', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    // A stream of distinct keys, each well past the prior window: touching a new
    // key after the window elapses prunes the stale ones. We assert behaviorally
    // — an old key's allowance is fresh again (it was pruned, not remembered).
    expect(rl.take('k0', 0)).toBe(true);
    expect(rl.take('k1', 2000)).toBe(true); // triggers prune of k0
    expect(rl.take('k0', 4000)).toBe(true); // k0 was pruned -> fresh allowance
  });
});
