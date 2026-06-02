/**
 * Session-to-WebSocket registry.
 *
 * Maps a `session_start`-bound session id to its owning WebSocket so HTTP
 * handlers (such as the voice-bridge transcript-stream forwarder) can push
 * server→client `transcript_stream` messages without knowing the WS object
 * at construction time.
 *
 * Binding rules (ADR-016, MR !8):
 *  - A socket is registered ONLY when its `session_start` frame binds it to a
 *    session id. `register()` is therefore called from the same branch in
 *    `createServer` that sets `boundSessionId` — after binding, not before.
 *  - A socket is NEVER reregistered to a different session id on the same
 *    connection (the binding is once-and-final per socket, matching the MR !8
 *    rule that prevents a stray frame from stealing a victim's binding).
 *  - `unregister()` is called on WS `close`, so the map stays bounded and
 *    dead sockets never accumulate.
 */
import type { WebSocket } from 'ws';

export class SocketRegistry {
  private readonly sockets = new Map<string, WebSocket>();

  /**
   * Bind a session id to its WebSocket. Idempotent for the same (id, ws) pair.
   * If the id is already bound to a DIFFERENT socket, the binding is NOT replaced
   * (once-and-final per session, consistent with the once-and-final binding rule
   * in the WS message handler).
   */
  register(sessionId: string, ws: WebSocket): void {
    if (!this.sockets.has(sessionId)) {
      this.sockets.set(sessionId, ws);
    }
  }

  /**
   * Remove the binding for a session on close. A missing entry is a no-op so
   * this is safe to call unconditionally from the `close` handler.
   */
  unregister(sessionId: string): void {
    this.sockets.delete(sessionId);
  }

  /**
   * Look up the WebSocket for a session. Returns `undefined` when the session
   * has no bound socket (not yet connected, or already closed). Callers must
   * handle the absent case — never assume a socket exists.
   */
  get(sessionId: string): WebSocket | undefined {
    return this.sockets.get(sessionId);
  }
}
