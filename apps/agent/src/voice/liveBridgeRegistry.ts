/**
 * Registry of live voice bridge handles, keyed by session id.
 *
 * Used by two distinct callers:
 *
 *  - The submit path (C6) calls `get(sessionId)` to retrieve the `VoiceBridge`
 *    and push server-computed lesson state (BKT, streak, phase, correctness) into
 *    the active realtime session after each graded turn. The model reacts to these
 *    pushes without ever computing those values itself (ADR-018 server-derive rule).
 *
 *  - The WS-close handler calls `closeAndUnregister(sessionId)` to tear down the
 *    underlying LiveKit room + OpenAI Realtime WebSocket when the learner's socket
 *    disconnects. Teardown is always deferred to WS close — never called eagerly at
 *    bridge-start time — so the live session is not destroyed the moment it opens.
 *
 * Singleton-per-session guarantee: `register()` is a no-op when the session already
 * has a live entry. This prevents a second token-mint from constructing a second
 * bridge for the same session (which would orphan the first bridge's room + socket).
 * The caller must not construct the bridge if `get()` returns a live entry.
 *
 * Lifecycle:
 *  - `register(sessionId, bridge, close)` — called after `startVoiceBridge` succeeds.
 *    No-op if the session already has an entry (singleton guarantee).
 *  - `closeAndUnregister(sessionId)` — awaits the factory's `close()` then removes
 *    the entry. Called from the WS-close handler to drive teardown.
 *  - `get(sessionId)` — returns the live `VoiceBridge` for a session, or `undefined`.
 *  - `has(sessionId)` — returns `true` when a live entry exists (used to enforce the
 *    singleton guarantee before constructing a new bridge).
 */
import type { VoiceBridge } from './bridge.js';

interface BridgeEntry {
  bridge: VoiceBridge;
  close: () => Promise<void>;
}

export class LiveBridgeRegistry {
  private readonly entries = new Map<string, BridgeEntry>();

  /**
   * Register a bridge + its teardown function for a session. No-op when the
   * session already has a live entry (singleton-per-session guarantee).
   */
  register(sessionId: string, bridge: VoiceBridge, close: () => Promise<void>): void {
    if (this.entries.has(sessionId)) return; // singleton: never replace a live entry
    this.entries.set(sessionId, { bridge, close });
  }

  /**
   * Tear down the bridge (close the LiveKit room + OpenAI WS) and remove the entry.
   * Idempotent: a missing entry is a no-op. Called from the WS-close lifecycle so
   * teardown is deferred until the learner's socket closes, never triggered at start.
   */
  async closeAndUnregister(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.entries.delete(sessionId); // remove first so a re-entrant close is a no-op
    try {
      await entry.close();
    } catch (err) {
      // Log but do not rethrow — the WS-close handler must not crash on teardown errors.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[voice] bridge close failed during WS teardown', { sessionId, message: msg });
    }
  }

  /** Returns the live `VoiceBridge` for a session, or `undefined` when none. */
  get(sessionId: string): VoiceBridge | undefined {
    return this.entries.get(sessionId)?.bridge;
  }

  /**
   * Returns `true` when a live bridge entry exists for the session. Used by the
   * token-mint path to enforce the singleton guarantee before constructing a new bridge.
   */
  has(sessionId: string): boolean {
    return this.entries.has(sessionId);
  }
}
