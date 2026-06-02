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
 * Singleton-per-session guarantee: a session has at most one live bridge. Because
 * bridge construction is async (it awaits the realtime/room connect), a plain
 * "check then construct" leaves a race window — two near-simultaneous mints both
 * observe no entry, both construct, and the second orphans a LiveKit room + OpenAI
 * socket. The guarantee is therefore enforced by a SYNCHRONOUS reservation taken
 * BEFORE the await: `reserve()` atomically (single-threaded event loop) marks the
 * slot and returns whether the caller won. Only the winner constructs; it then
 * `register()`s the real handle into its reservation, or `release()`s it on failure.
 * A loser that somehow still constructed must `close()` its orphan handle.
 *
 * Lifecycle:
 *  - `reserve(sessionId)` — synchronous slot claim before constructing. Returns
 *    `true` to the single winner; `false` if a reservation or live entry exists.
 *  - `register(sessionId, bridge, close)` — fills the reserved slot after
 *    `startVoiceBridge` succeeds; returns `true` if stored. Returns `false` (and the
 *    caller must `close()` the orphan handle) if the slot is no longer the caller's
 *    reservation — e.g. the WS closed mid-construction and dropped it, or a live
 *    entry already exists.
 *  - `release(sessionId)` — drops a reservation that never produced a bridge
 *    (construction threw), so a later mint can retry.
 *  - `closeAndUnregister(sessionId)` — awaits the factory's `close()` then removes
 *    the entry. Called from the WS-close handler to drive teardown.
 *  - `get(sessionId)` — returns the live `VoiceBridge` for a session, or `undefined`.
 *  - `has(sessionId)` — returns `true` when a reservation OR a live entry exists
 *    (used to short-circuit a re-mint before constructing a new bridge).
 */
import type { VoiceBridge } from './bridge.js';

interface BridgeEntry {
  bridge: VoiceBridge;
  close: () => Promise<void>;
}

export class LiveBridgeRegistry {
  private readonly entries = new Map<string, BridgeEntry>();
  /** Sessions whose bridge is being constructed (slot reserved, not yet filled). */
  private readonly reserved = new Set<string>();

  /**
   * Synchronously claim the singleton slot for a session before the async
   * construction begins. Returns `true` to the one winner; `false` if a
   * reservation or a live entry already exists. Taken right after the mint, with
   * no `await` between the check and the claim, so two racing mints cannot both win.
   */
  reserve(sessionId: string): boolean {
    if (this.reserved.has(sessionId) || this.entries.has(sessionId)) return false;
    this.reserved.add(sessionId);
    return true;
  }

  /** Drop a reservation that never produced a bridge (construction failed). */
  release(sessionId: string): void {
    this.reserved.delete(sessionId);
  }

  /**
   * Fill the slot with the constructed bridge + its teardown. Stores and returns
   * `true` only when this caller still holds the reservation and no live entry
   * exists. Returns `false` when the reservation is gone (the WS closed
   * mid-construction) or a live entry already exists — the caller then owns an
   * orphan handle it must `close()`. Never replaces a live entry (singleton).
   */
  register(sessionId: string, bridge: VoiceBridge, close: () => Promise<void>): boolean {
    const heldReservation = this.reserved.delete(sessionId);
    if (!heldReservation || this.entries.has(sessionId)) return false;
    this.entries.set(sessionId, { bridge, close });
    return true;
  }

  /**
   * Tear down the bridge (close the LiveKit room + OpenAI WS) and remove the entry.
   * Idempotent: a missing entry is a no-op. Called from the WS-close lifecycle so
   * teardown is deferred until the learner's socket closes, never triggered at start.
   */
  async closeAndUnregister(sessionId: string): Promise<void> {
    // Drop any pending reservation so a bridge still constructing for this session
    // can't fill the slot after the socket has gone (its register() returns false
    // and the caller closes the orphan).
    this.reserved.delete(sessionId);
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
   * Returns `true` when a reservation OR a live bridge entry exists for the session.
   * Reflects in-flight construction too, so a re-mint short-circuits during the
   * (async) construction window, not only after it completes.
   */
  has(sessionId: string): boolean {
    return this.reserved.has(sessionId) || this.entries.has(sessionId);
  }
}
