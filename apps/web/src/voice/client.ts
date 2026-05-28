/**
 * Browser-side voice client.
 *
 * The LiveKit SDK (`livekit-client`) is NOT statically imported here. Instead,
 * `createDefaultConnector()` lazy-loads it at connect-time via a dynamic import.
 * This means:
 *  1. The module loads cleanly when `livekit-client` is absent (tests inject a
 *     mock connector and never reach the dynamic import).
 *  2. TypeScript only sees the local `RoomConnector` interface — no type dep on
 *     the external package.
 *
 * To wire the real SDK: add `livekit-client` to apps/web/package.json and run
 * `pnpm install`. `createDefaultConnector()` will pick it up automatically.
 *
 * The specifier is assembled at runtime (not a static string literal) so Vite's
 * import-analysis plugin does not attempt to resolve it at build/transform time.
 * This is the correct pattern for optional peer dependencies.
 */

import { TokenRefresher } from './tokenRefresh.js';

// Assembled at runtime — keeps Vite from resolving the package statically.
const LIVEKIT_PKG = ['livekit', 'client'].join('-');

export interface RoomConnector {
  connect(opts: {
    url: string;
    token: string;
    onRemoteAudio: (stream: MediaStream) => void;
  }): Promise<void>;
  disconnect(): Promise<void>;
  /**
   * Apply a freshly-minted token to the live room so a session can outlast the
   * 5-minute token TTL with no disconnect. Optional: a connector that can't swap
   * a token mid-session simply omits it and the client skips rolling refresh.
   */
  updateToken?(token: string): void | Promise<void>;
}

export interface VoiceClientOptions {
  sessionId: string;
  /** Injectable for tests; defaults to navigator.mediaDevices.getUserMedia */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Injectable for tests; defaults to global fetch */
  fetchFn?: typeof fetch;
  /** Injectable for tests; defaults to createDefaultConnector() */
  connector?: RoomConnector;
}

type VoiceState = 'idle' | 'requesting-permission' | 'connecting' | 'connected' | 'error' | 'unavailable';

/**
 * Returns a RoomConnector backed by `livekit-client` (dynamic import). The
 * caller must ensure the package is installed before this connector's `connect`
 * is invoked; in tests, inject a mock connector instead.
 */
function createDefaultConnector(): RoomConnector {
  let roomInstance:
    | { disconnect: () => Promise<void>; connect: (u: string, t: string) => Promise<void> }
    | null = null;
  let lastUrl: string | null = null;
  // Audio element managed by the connector for remote playback.
  let audioEl: HTMLAudioElement | null = null;

  return {
    async connect({ url, token, onRemoteAudio }) {
      lastUrl = url;
      // Dynamic import via the runtime-assembled specifier — Vite cannot resolve
      // a non-literal, so this silently skips static analysis. The package must be
      // installed before this code path is reached in production.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { Room, RoomEvent } = (await import(LIVEKIT_PKG)) as any;
      const room = new Room();
      roomInstance = room;

      room.on(RoomEvent.TrackSubscribed, (_track: unknown, _pub: unknown, participant: unknown) => {
        // Collect remote audio tracks and pipe them to an <audio> element.
        void (async () => {
          // livekit-client exposes MediaStream via the track object.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const track = _track as any;
          if (track?.kind === 'audio') {
            const stream = new MediaStream([track.mediaStreamTrack as MediaStreamTrack]);
            onRemoteAudio(stream);
            if (typeof document !== 'undefined') {
              if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.autoplay = true;
                document.body.appendChild(audioEl);
              }
              audioEl.srcObject = stream;
            }
          }
        })();
        void participant; // referenced to avoid lint warning
      });

      await room.connect(url, token);
    },

    async disconnect() {
      await roomInstance?.disconnect();
      roomInstance = null;
      if (audioEl) {
        audioEl.srcObject = null;
        audioEl.remove();
        audioEl = null;
      }
    },

    // livekit-client has no in-place token swap, so the supported way to roll a
    // refreshed ephemeral token onto a live session is a fast reconnect: the room
    // re-attaches with the new token, keeping the same published mic track. The
    // refresh fires at T-60s, well inside the old token's validity, so the brief
    // reconnect happens while the prior token is still accepted.
    async updateToken(token: string) {
      if (!roomInstance || lastUrl === null) return;
      await roomInstance.connect(lastUrl, token);
    },
  };
}

export class VoiceClient {
  private _state: VoiceState = 'idle';
  private _stream: MediaStream | null = null;
  private readonly sessionId: string;
  private readonly getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly fetchFn: typeof fetch;
  private readonly connector: RoomConnector;
  private refresher: TokenRefresher | null = null;
  // Set when stop() lands while an async start() is still in flight, so start()
  // bails at its next checkpoint instead of finishing into a 'connected' session
  // the caller already tore down.
  private _stopping = false;

  constructor(opts: VoiceClientOptions) {
    this.sessionId = opts.sessionId;
    this.getUserMedia =
      opts.getUserMedia ??
      ((c) => navigator.mediaDevices.getUserMedia(c));
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.connector = opts.connector ?? createDefaultConnector();
    // No side effects at construction — microphone is NOT requested here.
  }

  get state(): VoiceState {
    return this._state;
  }

  /**
   * Request mic permission, mint a realtime token, and join the LiveKit room.
   * Call this ONLY in response to a user gesture (e.g. button click).
   * Errors are caught and reflected as state — this method never rejects.
   */
  async start(): Promise<void> {
    if (this._state !== 'idle') return;
    this._stopping = false;

    // Phase 1: request microphone permission.
    this._state = 'requesting-permission';
    let stream: MediaStream;
    try {
      stream = await this.getUserMedia({ audio: true });
    } catch {
      this._state = 'error';
      return;
    }
    this._stream = stream;
    // stop() may have been called while the permission prompt was open.
    if (this._abortStart()) return;

    // Phase 2: mint a token from the server.
    this._state = 'connecting';
    let body: { token: string; url: string; roomName: string; expiresAt: string };
    try {
      const res = await this.fetchFn('/api/realtime/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId }),
      });

      if (res.status === 503) {
        // Voice is not configured on this deployment — degrade gracefully.
        this._state = 'unavailable';
        this._stopTracks();
        return;
      }

      if (!res.ok) {
        this._state = 'error';
        this._stopTracks();
        return;
      }

      body = (await res.json()) as typeof body;
    } catch {
      this._state = 'error';
      this._stopTracks();
      return;
    }
    if (this._abortStart()) return;

    // Phase 3: join the LiveKit room.
    try {
      await this.connector.connect({
        url: body.url,
        token: body.token,
        onRemoteAudio: (_stream: MediaStream) => {
          // Remote audio playback is handled by the connector implementation.
          // In jsdom tests, onRemoteAudio is never invoked (mock connector).
        },
      });
    } catch {
      this._state = 'error';
      this._stopTracks();
      return;
    }
    // stop() may have landed during the room join — don't start a refresher or
    // mark connected on a session the caller already tore down.
    if (this._abortStart()) {
      void this.connector.disconnect();
      return;
    }

    // Roll the token before its 5-minute TTL so a long session never drops. Only
    // when the connector can swap a token mid-session; otherwise the session is
    // capped at one token lifetime (still valid, just not extended).
    if (this.connector.updateToken) {
      const apply = this.connector.updateToken.bind(this.connector);
      this.refresher = new TokenRefresher({
        sessionId: this.sessionId,
        mint: async () => {
          const res = await this.fetchFn('/api/realtime/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: this.sessionId }),
          });
          if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
          const b = (await res.json()) as { token: string; expiresAt: string | number };
          return { token: b.token, expiresAt: Number(b.expiresAt) };
        },
        applyToken: (t) => apply(t),
      });
      this.refresher.start(Number(body.expiresAt));
    }

    this._state = 'connected';
  }

  /**
   * Stop the mic, leave the room, and return to idle.
   * Idempotent — safe to call multiple times.
   */
  async stop(): Promise<void> {
    if (this._state === 'idle') return;
    // Signal any in-flight start() to abort at its next checkpoint.
    this._stopping = true;
    this.refresher?.stop();
    this.refresher = null;
    this._stopTracks();
    await this.connector.disconnect();
    this._state = 'idle';
  }

  /** True if stop() landed mid-start(); if so, clean up the mic + state so an
   *  aborted start leaves the client idle rather than half-connected. */
  private _abortStart(): boolean {
    if (!this._stopping) return false;
    this._stopTracks();
    this._state = 'idle';
    return true;
  }

  private _stopTracks(): void {
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
  }
}
