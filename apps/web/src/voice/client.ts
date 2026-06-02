/**
 * Browser-side voice client.
 *
 * The LiveKit SDK (`livekit-client`) is a required dependency. The default
 * connector lazy-loads it at connect time so the main lesson bundle does not pay
 * the cost until voice is used, but the import specifier stays static so Vite can
 * analyze and bundle it normally.
 */

import { TokenRefresher } from './tokenRefresh.js';
import type { Room as LiveKitRoom } from 'livekit-client';

export interface RoomConnector {
  connect(opts: {
    url: string;
    token: string;
    /** The learner's captured mic stream; the connector publishes its audio track
     *  to the room so the tutor/agent actually hears the learner. Without this the
     *  room joins but stays silent and the say-hello round-trip can't work. */
    micStream: MediaStream;
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
  let roomInstance: LiveKitRoom | null = null;
  let lastUrl: string | null = null;
  // Audio element managed by the connector for remote playback.
  let audioEl: HTMLAudioElement | null = null;

  return {
    async connect({ url, token, micStream, onRemoteAudio }) {
      lastUrl = url;
      const { Room, RoomEvent } = await import('livekit-client');
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

      // Publish the learner's mic so the tutor/agent actually hears them — joining
      // the room is not enough on its own. Publish the audio track directly; the
      // room keeps it across the reconnect that updateToken() performs.
      const micTrack = micStream.getAudioTracks()[0];
      if (micTrack) {
        await room.localParticipant.publishTrack(micTrack);
      }
    },

    async disconnect() {
      // Disconnecting the room unpublishes and detaches local tracks; the caller
      // (VoiceClient.stop) stops the underlying mic tracks.
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
   * The live microphone MediaStream, present only while the session is
   * connected. Null when idle, connecting, or errored. Callers use this to
   * feed a level-meter AnalyserNode so the learner can see audio is being
   * captured without granting extra permissions — the stream is already live.
   */
  get stream(): MediaStream | null {
    return this._stream;
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

    // Phase 3: join the LiveKit room and publish the learner's mic.
    try {
      await this.connector.connect({
        url: body.url,
        token: body.token,
        micStream: stream,
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
        // When the refresher gives up (a non-finite expiry, or too many consecutive
        // failed re-mints), surface it as a connection error and tear down rather
        // than letting the session silently ride to the 5-minute TTL and drop with
        // no signal. Transient failures the refresher will retry do NOT fire this.
        onGiveUp: () => {
          if (this._state === 'connected') {
            this._state = 'error';
            void this.stop();
          }
        },
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
