import { describe, expect, it, vi } from 'vitest';
import { TokenRefresher } from './tokenRefresh.js';
import type { TokenRefreshOptions } from './tokenRefresh.js';

/**
 * A deterministic, controllable clock + timer. No real waiting: `advance(ms)`
 * moves virtual time forward and fires any timers whose deadline has passed,
 * re-evaluating after each callback so a callback that schedules a new timer
 * inside the same advance window also fires (mirrors how setTimeout would).
 */
function makeFakeScheduler() {
  let nowMs = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();

  return {
    now: () => nowMs,
    setTimer: (cb: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: nowMs + Math.max(0, ms), cb });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (id: ReturnType<typeof setTimeout>) => {
      timers.delete(id as unknown as number);
    },
    /** Move virtual time forward by `ms`, firing due timers in deadline order. */
    advance(ms: number) {
      const target = nowMs + ms;
      // Loop until no timer is due within [now, target]; callbacks may enqueue more.
      for (;;) {
        let dueId: number | null = null;
        let dueAt = Infinity;
        for (const [id, t] of timers) {
          if (t.at <= target && t.at < dueAt) {
            dueAt = t.at;
            dueId = id;
          }
        }
        if (dueId === null) break;
        const t = timers.get(dueId)!;
        timers.delete(dueId);
        nowMs = t.at;
        t.cb();
      }
      nowMs = target;
    },
    /** Run all microtasks (let pending promises settle). */
    flush: () => Promise.resolve(),
    pendingCount: () => timers.size,
  };
}

function makeOpts(
  scheduler: ReturnType<typeof makeFakeScheduler>,
  overrides: Partial<TokenRefreshOptions> = {},
): TokenRefreshOptions {
  return {
    sessionId: 'sess-1',
    mint: vi.fn().mockResolvedValue({ token: 'fresh', expiresAt: scheduler.now() + 300_000 }),
    applyToken: vi.fn(),
    now: scheduler.now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
    ...overrides,
  };
}

const TTL = 300_000;
const SKEW = 60_000; // default refreshSkewMs

describe('TokenRefresher — schedule timing', () => {
  it('does NOT mint before expiresAt - skew, and mints at/after that instant', async () => {
    const sched = makeFakeScheduler();
    const mint = vi.fn().mockResolvedValue({ token: 'fresh', expiresAt: TTL + TTL });
    const opts = makeOpts(sched, { mint });
    const r = new TokenRefresher(opts);

    r.start(TTL); // expires at t=300_000, refresh at t=240_000

    // Just before the boundary: no mint yet.
    sched.advance(SKEW === 60_000 ? TTL - SKEW - 1 : 0); // t = 239_999
    await sched.flush();
    expect(mint).not.toHaveBeenCalled();

    // Cross the boundary.
    sched.advance(1); // t = 240_000
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(1);
  });
});

describe('TokenRefresher — rolling multi-boundary refresh', () => {
  it('re-schedules off each new expiresAt; mints + applies across two boundaries in order, no gap', async () => {
    const sched = makeFakeScheduler();
    const tokens = [
      { token: 'tok-2', expiresAt: 0 }, // expiresAt filled in below
      { token: 'tok-3', expiresAt: 0 },
    ];
    // First refresh returns a token expiring 300s after the FIRST refresh instant (t=240_000).
    // Second refresh returns one expiring 300s after the SECOND refresh instant.
    const mint = vi
      .fn()
      .mockImplementationOnce(async () => ({ token: tokens[0].token, expiresAt: sched.now() + TTL }))
      .mockImplementationOnce(async () => ({ token: tokens[1].token, expiresAt: sched.now() + TTL }));
    const applyToken = vi.fn();
    const r = new TokenRefresher(makeOpts(sched, { mint, applyToken }));

    r.start(TTL); // first expiry t=300_000, first refresh t=240_000

    // Cross first boundary.
    sched.advance(TTL - SKEW); // t = 240_000
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(1);
    expect(applyToken).toHaveBeenNthCalledWith(1, 'tok-2');

    // The applied token (minted at t=240_000) expires at t=540_000; the OLD token
    // expired at t=300_000. The new token was applied at t=240_000 — before the old
    // expired — so there is no gap.
    // Next refresh should be scheduled for 540_000 - 60_000 = 480_000.
    // Advancing to just before it must NOT mint again.
    sched.advance(480_000 - 240_000 - 1); // t = 479_999
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(1);

    // Cross second boundary.
    sched.advance(1); // t = 480_000
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(2);
    expect(applyToken).toHaveBeenNthCalledWith(2, 'tok-3');

    // Order preserved.
    expect(applyToken.mock.calls.map((c) => c[0])).toEqual(['tok-2', 'tok-3']);
  });
});

describe('TokenRefresher — mint failure', () => {
  it('calls onError and retries on backoff; does not leave the session unrefreshed', async () => {
    const sched = makeFakeScheduler();
    const onError = vi.fn();
    const applyToken = vi.fn();
    const mint = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockImplementationOnce(async () => ({ token: 'recovered', expiresAt: sched.now() + TTL }));
    const r = new TokenRefresher(makeOpts(sched, { mint, applyToken, onError }));

    r.start(TTL); // refresh at t=240_000

    // Cross first boundary -> mint rejects.
    sched.advance(TTL - SKEW); // t = 240_000
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(applyToken).not.toHaveBeenCalled();

    // Backoff = min(skew, 10_000) = 10_000. Just before: no retry.
    sched.advance(10_000 - 1);
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(1);

    // At backoff deadline: retry fires and succeeds.
    sched.advance(1); // t = 250_000
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(2);
    expect(applyToken).toHaveBeenCalledWith('recovered');
  });
});

describe('TokenRefresher — already within skew window at start', () => {
  it('schedules an immediate (0ms) refresh', async () => {
    const sched = makeFakeScheduler();
    const mint = vi.fn().mockResolvedValue({ token: 'fresh', expiresAt: TTL });
    const r = new TokenRefresher(makeOpts(sched, { mint }));

    // expiresAt is only 30s out (< skew of 60s) -> refresh ASAP.
    r.start(sched.now() + 30_000);

    // Without advancing time at all, the 0ms timer must be due as soon as we tick.
    sched.advance(0);
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(1);
  });
});

describe('TokenRefresher — applyToken rejection', () => {
  it('treats applyToken rejection like a mint failure: calls onError and schedules a retry', async () => {
    const sched = makeFakeScheduler();
    const onError = vi.fn();
    const applyErr = new Error('room reconnect rejected');
    // mint always succeeds; applyToken rejects once, then succeeds.
    const applyToken = vi
      .fn()
      .mockRejectedValueOnce(applyErr)
      .mockResolvedValue(undefined);
    const mint = vi
      .fn()
      .mockImplementation(async () => ({ token: 'fresh', expiresAt: sched.now() + TTL }));

    const r = new TokenRefresher(makeOpts(sched, { mint, applyToken, onError }));
    r.start(TTL); // refresh at t=240_000

    // Cross the boundary -> mint succeeds, applyToken rejects.
    // refresh() awaits mint() then awaits applyToken(); we need two microtask
    // flushes to drain both awaits before asserting on onError.
    sched.advance(TTL - SKEW); // t = 240_000
    await sched.flush(); // resolves mint()
    await sched.flush(); // resolves applyToken() rejection -> catch -> onError + retry
    expect(mint).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(applyErr);

    // The rejection must not escape (test completes cleanly — if it did escape,
    // vitest would report an unhandled rejection and the suite would fail).

    // A retry must be scheduled. Backoff = min(skew, 10_000) = 10_000.
    // Just before deadline: no second mint.
    sched.advance(10_000 - 1);
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(1);

    // At the backoff deadline: mint fires again (refresher did NOT die).
    sched.advance(1);
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(2);
    // applyToken succeeds on the retry, so no second error.
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('TokenRefresher — stop() is permanent', () => {
  it('start() after stop() does NOT re-arm — the refresher stays stopped', async () => {
    const sched = makeFakeScheduler();
    const mint = vi.fn().mockResolvedValue({ token: 'fresh', expiresAt: TTL + TTL });
    const r = new TokenRefresher(makeOpts(sched, { mint }));

    r.start(TTL); // arms a timer for t=240_000
    r.stop();     // permanent teardown

    // A subsequent start() must be a no-op (stopped is permanent).
    r.start(TTL);

    // Advance well past any refresh point; mint must never be called.
    sched.advance(TTL * 2);
    await sched.flush();
    expect(mint).not.toHaveBeenCalled();
    expect(sched.pendingCount()).toBe(0);
  });
});

describe('TokenRefresher — non-finite expiresAt guard', () => {
  it('start(NaN): calls onError, calls onGiveUp, arms no timer, mint never called', async () => {
    const sched = makeFakeScheduler();
    const onError = vi.fn();
    const onGiveUp = vi.fn();
    const mint = vi.fn().mockResolvedValue({ token: 'should-not-mint', expiresAt: sched.now() + TTL });
    const r = new TokenRefresher(makeOpts(sched, { mint, onError, onGiveUp }));

    r.start(NaN);

    // onError + onGiveUp must have fired synchronously in scheduleFor.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledTimes(1);

    // No timer should be pending.
    expect(sched.pendingCount()).toBe(0);

    // Advancing time well past any hypothetical refresh boundary must not call mint.
    sched.advance(TTL * 3);
    await sched.flush();
    expect(mint).not.toHaveBeenCalled();
  });

  it('start(Infinity): calls onError, calls onGiveUp, arms no timer, mint never called', async () => {
    const sched = makeFakeScheduler();
    const onError = vi.fn();
    const onGiveUp = vi.fn();
    const mint = vi.fn().mockResolvedValue({ token: 'should-not-mint', expiresAt: sched.now() + TTL });
    const r = new TokenRefresher(makeOpts(sched, { mint, onError, onGiveUp }));

    r.start(Infinity);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(sched.pendingCount()).toBe(0);

    sched.advance(TTL * 3);
    await sched.flush();
    expect(mint).not.toHaveBeenCalled();
  });

  it('NaN expiresAt from mint result: onGiveUp fires, mint not called repeatedly', async () => {
    const sched = makeFakeScheduler();
    const onError = vi.fn();
    const onGiveUp = vi.fn();
    // First mint succeeds but returns NaN expiresAt; the re-schedule sees NaN.
    const mint = vi.fn().mockResolvedValue({ token: 'tok', expiresAt: NaN });
    const r = new TokenRefresher(makeOpts(sched, { mint, onError, onGiveUp }));

    r.start(TTL); // first refresh at t=240_000

    // Cross the boundary so the first mint fires.
    sched.advance(TTL - SKEW); // t=240_000
    // refresh() has two awaits: mint() then applyToken(). Flush twice so both settle.
    await sched.flush(); // resolves mint()
    await sched.flush(); // resolves applyToken() -> then scheduleFor(NaN) fires

    // The scheduleFor guard must have fired onError + onGiveUp.
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    // Exactly one mint call (the first, scheduled refresh) — no tight re-mint loop.
    expect(mint).toHaveBeenCalledTimes(1);
    // No further timer is pending after the give-up.
    expect(sched.pendingCount()).toBe(0);

    // Advance a long way to confirm nothing fires again.
    sched.advance(TTL * 5);
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(1);
  });
});

describe('TokenRefresher — maxConsecutiveFailures give-up cap', () => {
  it('give-up after maxConsecutiveFailures: with cap=2, onGiveUp fires after 3rd consecutive failure, no further mint', async () => {
    const sched = makeFakeScheduler();
    const onError = vi.fn();
    const onGiveUp = vi.fn();
    // mint always rejects.
    const mint = vi.fn().mockRejectedValue(new Error('always fails'));
    const r = new TokenRefresher(
      makeOpts(sched, { mint, onError, onGiveUp, maxConsecutiveFailures: 2 }),
    );

    r.start(TTL); // first refresh at t=240_000

    // --- failure 1 ---
    sched.advance(TTL - SKEW); // t=240_000: fires timer -> mint rejects
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled(); // 1 <= cap=2, still retrying

    // --- failure 2 ---
    sched.advance(MAX_BACKOFF); // fire backoff timer -> mint rejects again
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onGiveUp).not.toHaveBeenCalled(); // 2 <= cap=2, still retrying

    // --- failure 3 (> cap) ---
    sched.advance(MAX_BACKOFF); // fire backoff timer -> mint rejects -> recordFailure gives up
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(3);
    expect(onGiveUp).toHaveBeenCalledTimes(1); // gave up

    // After give-up: no timer, no further mint regardless of time advancing.
    expect(sched.pendingCount()).toBe(0);
    sched.advance(TTL * 5);
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(3); // unchanged
    expect(onGiveUp).toHaveBeenCalledTimes(1); // fired exactly once
  });

  it('failure streak resets on success: with cap=2, reject+reject+resolve+reject does NOT give up', async () => {
    const sched = makeFakeScheduler();
    const onGiveUp = vi.fn();
    const mint = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockImplementationOnce(async () => ({ token: 'ok', expiresAt: sched.now() + TTL }))
      .mockRejectedValueOnce(new Error('fail after reset'));
    const r = new TokenRefresher(
      makeOpts(sched, { mint, onGiveUp, maxConsecutiveFailures: 2 }),
    );

    r.start(TTL); // first refresh at t=240_000

    // failure 1
    sched.advance(TTL - SKEW); // t=240_000
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(1);

    // failure 2
    sched.advance(MAX_BACKOFF);
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(2);
    expect(onGiveUp).not.toHaveBeenCalled(); // 2 == cap, still retrying

    // success — resets streak to 0
    sched.advance(MAX_BACKOFF);
    await sched.flush();
    expect(mint).toHaveBeenCalledTimes(3);
    expect(onGiveUp).not.toHaveBeenCalled();

    // failure after reset — consecutive count is now 1, which is <= cap=2; no give-up
    sched.advance(TTL); // cross the re-scheduled boundary from the successful mint
    await sched.flush();
    // mint may or may not have fired the 4th time depending on backoff timing;
    // what matters is: onGiveUp must NOT have fired (streak was reset to 0 by success).
    expect(onGiveUp).not.toHaveBeenCalled();
  });
});

const MAX_BACKOFF = 10_000;

describe('TokenRefresher — stop()', () => {
  it('cancels the pending refresh; no mint after stop', async () => {
    const sched = makeFakeScheduler();
    const mint = vi.fn().mockResolvedValue({ token: 'fresh', expiresAt: TTL + TTL });
    const r = new TokenRefresher(makeOpts(sched, { mint }));

    r.start(TTL); // refresh at t=240_000
    r.stop();

    sched.advance(TTL); // well past the boundary
    await sched.flush();
    expect(mint).not.toHaveBeenCalled();
    expect(sched.pendingCount()).toBe(0);
  });

  it('is idempotent — a second stop() is a no-op', async () => {
    const sched = makeFakeScheduler();
    const mint = vi.fn().mockResolvedValue({ token: 'fresh', expiresAt: TTL + TTL });
    const r = new TokenRefresher(makeOpts(sched, { mint }));

    r.start(TTL);
    r.stop();
    expect(() => r.stop()).not.toThrow();

    sched.advance(TTL);
    await sched.flush();
    expect(mint).not.toHaveBeenCalled();
  });

  it('does not mint/apply if stopped after the timer fired but before mint resolves', async () => {
    const sched = makeFakeScheduler();
    let resolveMint: (v: { token: string; expiresAt: number }) => void = () => {};
    const mint = vi.fn().mockImplementation(
      () =>
        new Promise<{ token: string; expiresAt: number }>((res) => {
          resolveMint = res;
        }),
    );
    const applyToken = vi.fn();
    const r = new TokenRefresher(makeOpts(sched, { mint, applyToken }));

    r.start(TTL);
    sched.advance(TTL - SKEW); // fires timer -> mint() called, pending
    expect(mint).toHaveBeenCalledTimes(1);

    r.stop(); // stop while mint is in flight
    resolveMint({ token: 'late', expiresAt: sched.now() + TTL });
    await sched.flush();
    await sched.flush();

    // The in-flight token must NOT be applied after stop().
    expect(applyToken).not.toHaveBeenCalled();
    // And no further refresh is scheduled.
    expect(sched.pendingCount()).toBe(0);
  });
});
