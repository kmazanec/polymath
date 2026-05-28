/**
 * Transparent token-refresh scheduler for a voice session.
 *
 * The realtime token has a short TTL (the server mints it as `now + 300_000`).
 * A session can outlast that, so the browser must re-mint a fresh token and
 * apply it to the live room BEFORE the current one expires — with no gap. This
 * scheduler runs a rolling refresh: it arms a timer for `T - skew`, mints +
 * applies on fire, then re-arms off the NEW expiry, indefinitely.
 *
 * All time/timer/network dependencies are injectable so the logic is testable
 * without real waiting or a DOM. In production, `mint` POSTs
 * /api/realtime/session and `applyToken` updates the live room's token.
 */

export interface TokenRefreshOptions {
  sessionId: string;
  /** Mint a fresh token. Injectable; in prod it POSTs /api/realtime/session. */
  mint: () => Promise<{ token: string; expiresAt: number }>;
  /** Apply the refreshed token to the live room. Injectable. */
  applyToken: (token: string) => void | Promise<void>;
  /** How long before expiry to refresh. Default 60_000ms (refresh at T-60s). */
  refreshSkewMs?: number;
  /** Injectable clock; default Date.now. */
  now?: () => number;
  /** Injectable timer; default setTimeout/clearTimeout. */
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  /** Optional hook fired on each (possibly transient, retried) refresh failure. */
  onError?: (err: unknown) => void;
  /** Fired once when the refresher gives up permanently — a non-finite expiry, or
   *  more than `maxConsecutiveFailures` failed re-mints in a row. The session
   *  should be torn down / surfaced as an error rather than silently riding to the
   *  token's TTL. */
  onGiveUp?: (err: unknown) => void;
  /** Consecutive failures tolerated before giving up. Default 5. */
  maxConsecutiveFailures?: number;
}

const DEFAULT_SKEW_MS = 60_000;
const MAX_BACKOFF_MS = 10_000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;

export class TokenRefresher {
  private readonly sessionId: string;
  private readonly mint: () => Promise<{ token: string; expiresAt: number }>;
  private readonly applyToken: (token: string) => void | Promise<void>;
  private readonly refreshSkewMs: number;
  private readonly now: () => number;
  private readonly setTimer: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (id: ReturnType<typeof setTimeout>) => void;
  private readonly onError?: (err: unknown) => void;
  private readonly onGiveUp?: (err: unknown) => void;
  private readonly maxConsecutiveFailures: number;

  private timer: ReturnType<typeof setTimeout> | null = null;
  // `true` between start() and stop(); guards in-flight mint results from being
  // applied (or re-scheduling) after the session was torn down.
  private running = false;
  // Set once by stop(); makes teardown permanent so a late start() can't re-arm.
  private stopped = false;
  // Resets to 0 on any successful refresh; when it exceeds the cap we give up.
  private consecutiveFailures = 0;

  constructor(opts: TokenRefreshOptions) {
    this.sessionId = opts.sessionId;
    this.mint = opts.mint;
    this.applyToken = opts.applyToken;
    this.refreshSkewMs = opts.refreshSkewMs ?? DEFAULT_SKEW_MS;
    this.now = opts.now ?? (() => Date.now());
    this.setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id));
    this.onError = opts.onError;
    this.onGiveUp = opts.onGiveUp;
    this.maxConsecutiveFailures = opts.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
  }

  /** Record a refresh failure: surface it, and if too many in a row, give up
   *  permanently (stop + fire onGiveUp) instead of retrying forever. Returns true
   *  if it gave up (caller should not schedule a retry). */
  private recordFailure(err: unknown): boolean {
    this.onError?.(err);
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures > this.maxConsecutiveFailures) {
      this.stop();
      this.onGiveUp?.(err);
      return true;
    }
    return false;
  }

  /** Begin scheduling refreshes given the CURRENT token's expiresAt (ms-epoch).
   *  A refresher that has been stopped never re-arms — stop() is permanent, so a
   *  late start() (e.g. racing a teardown) can't silently resume token minting. */
  start(initialExpiresAt: number): void {
    if (this.stopped) return;
    this.running = true;
    this.scheduleFor(initialExpiresAt);
  }

  /** Stop all scheduled refreshes. Idempotent and permanent; no mint/apply after this. */
  stop(): void {
    this.stopped = true;
    this.running = false;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  /** Arm a one-shot timer to fire `expiresAt - skew - now` ms from now (floored at 0). */
  private scheduleFor(expiresAt: number): void {
    if (!this.running) return;
    // A non-finite expiresAt (a missing/ISO-string/garbage mint response that the
    // caller ran through Number(...) → NaN) would make `delay` NaN, which browser
    // timers treat as 0 — a tight re-mint loop hammering the endpoint. Refuse to
    // schedule on a bad expiry: surface it and stop rather than spin.
    if (!Number.isFinite(expiresAt)) {
      // A bad expiry is unrecoverable, not transient — give up immediately rather
      // than counting toward the retry budget.
      const err = new Error(`token refresh: non-finite expiresAt (${expiresAt})`);
      this.onError?.(err);
      this.stop();
      this.onGiveUp?.(err);
      return;
    }
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const delay = Math.max(0, expiresAt - this.refreshSkewMs - this.now());
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.refresh();
    }, delay);
  }

  /** Re-arm after a transient failure: soon, but bounded — there's still ~skew left. */
  private scheduleRetry(): void {
    if (!this.running) return;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const delay = Math.min(this.refreshSkewMs, MAX_BACKOFF_MS);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.refresh();
    }, delay);
  }

  private async refresh(): Promise<void> {
    if (!this.running) return;
    let next: { token: string; expiresAt: number };
    try {
      next = await this.mint();
    } catch (err) {
      // A transient failure must not permanently end refreshes — retry on a short
      // backoff while the current token still has ~skew of validity left — UNLESS
      // we've failed too many times in a row, in which case give up + surface it.
      if (!this.recordFailure(err)) this.scheduleRetry();
      return;
    }
    // The session may have been stopped while mint() was in flight; if so, do
    // not apply the stale token or re-arm.
    if (!this.running) return;
    try {
      await this.applyToken(next.token);
    } catch (err) {
      // Applying the fresh token failed (e.g. the room reconnect rejected). Treat
      // it like a mint failure: retry while the old token is still valid (or give
      // up after too many), rather than letting the rejection escape silently.
      if (!this.recordFailure(err)) this.scheduleRetry();
      return;
    }
    if (!this.running) return;
    // A successful refresh clears the failure streak.
    this.consecutiveFailures = 0;
    // Rolling refresh: arm the next one off the NEW expiry.
    this.scheduleFor(next.expiresAt);
  }
}
