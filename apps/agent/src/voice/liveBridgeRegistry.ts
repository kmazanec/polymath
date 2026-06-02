/**
 * Registry of live `VoiceBridge` handles, keyed by session id.
 *
 * Used by the submit path (C6) to push server-computed lesson state into the
 * active realtime session after each graded turn, so the model can react to
 * BKT / streak / phase changes without the server revealing those values to
 * the client or the model computing them itself.
 *
 * Lifecycle:
 *  - `register(sessionId, bridge)` — called by `startVoiceBridge` once the
 *    bridge is started and connected.
 *  - `unregister(sessionId)` — called when the bridge is stopped (room leaves,
 *    WS closes, etc.). Keeps the map bounded.
 *  - `get(sessionId)` — returns the live bridge for a session, or `undefined`
 *    when there is none (session has no active voice, or already stopped).
 *
 * There is at most one live bridge per session; a second `register` for the
 * same session id replaces the old entry (the previous bridge must have been
 * stopped before re-starting).
 */
import type { VoiceBridge } from './bridge.js';

export class LiveBridgeRegistry {
  private readonly bridges = new Map<string, VoiceBridge>();

  register(sessionId: string, bridge: VoiceBridge): void {
    this.bridges.set(sessionId, bridge);
  }

  unregister(sessionId: string): void {
    this.bridges.delete(sessionId);
  }

  get(sessionId: string): VoiceBridge | undefined {
    return this.bridges.get(sessionId);
  }
}
