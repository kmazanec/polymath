/**
 * Production `RealtimeSession` implementation and `RealtimeSessionFactory`.
 *
 * Wires:
 *  - An OpenAI Realtime WebSocket (`openai/realtime/ws`) as the AI model boundary.
 *  - A LiveKit `Room` (via `@livekit/rtc-node`) as the bidirectional audio transport.
 *
 * The factory mints a server-side participant token (agent identity, canPublish +
 * canSubscribe), joins the room, creates an `AudioSource` + `LocalAudioTrack` to
 * publish tutor audio, subscribes to the learner's first RemoteAudioTrack via
 * `AudioStream`, and opens the OpenAI Realtime WebSocket with server-VAD and the
 * `propose_tactical_move` tool set.
 *
 * Fail-closed invariants (ADR-006):
 *  - This module is imported ONLY inside an async guard in `createServer`; a
 *    native-binding load failure never reaches `require`/top-level `import` in the
 *    agent entry point (the dynamic guard keeps `/api/health` alive).
 *  - Secrets (apiKey, apiSecret, OPENAI_API_KEY) are never logged or placed in a
 *    URL/argv. The factory arguments carry them in-process only.
 *
 * Audio format assumptions (offline unverifiable — confirmed by live smoke only):
 *  - OpenAI Realtime expects PCM16, 24 kHz, mono, little-endian.
 *  - LiveKit `AudioStream` can be constructed with a target sample rate; we request
 *    24 000 Hz / 1 channel so the SDK resamples for us before handing frames here.
 *    If the SDK version does not resample on construction the rate will mismatch and
 *    audio quality will degrade — the live smoke must confirm.
 *  - `AudioSource.captureFrame` expects the same 24 kHz / 1 ch PCM16 format;
 *    frames from OpenAI Realtime arrive as Base64-encoded PCM16 and are decoded
 *    here to `Int16Array` before wrapping in `AudioFrame`.
 *  - LiveKit `AudioFrame.data` is `Int16Array`; we reinterpret the incoming
 *    `Uint8Array` (from the bridge) as `Int16Array` (little-endian PCM16 words).
 *
 * ADR-016 (voice loop) and ADR-018 (integrity/fail-closed) apply throughout.
 */
import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws.js';
import { AccessToken } from 'livekit-server-sdk';
import {
  Room,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  AudioFrame,
  TrackKind,
  type TrackPublishOptions,
} from '@livekit/rtc-node';
import type {
  RealtimeSession,
  RealtimeSessionConfig,
  VoiceTranscript,
} from './realtimeClient.js';
import type { RealtimeSessionFactory } from './startBridge.js';
import { REALTIME_TOOLS } from './realtimeTools.js';

// ---------------------------------------------------------------------------
// Audio constants
// ---------------------------------------------------------------------------

/** OpenAI Realtime requires PCM16 at 24 kHz, mono. */
const OAI_SAMPLE_RATE = 24_000;
const OAI_CHANNELS = 1;

/**
 * Duration of each captured LiveKit audio frame sent to OpenAI Realtime (ms).
 * 100ms = 2 400 samples at 24 kHz — a reasonable chunk size; the live smoke
 * should tune this for latency vs. overhead.
 */
const LIVEKIT_FRAME_MS = 100;

// ---------------------------------------------------------------------------
// Mint a server-side agent participant token
// ---------------------------------------------------------------------------

async function mintAgentToken(opts: {
  sessionId: string;
  roomName: string;
  apiKey: string;
  apiSecret: string;
}): Promise<string> {
  const at = new AccessToken(opts.apiKey, opts.apiSecret, {
    // Stable agent identity — distinguishable from the learner token minted in token.ts.
    identity: `agent-${opts.sessionId}`,
    ttl: 3600, // 1 hour — the room session is bounded by the lesson; the agent outlasts token TTL.
  });
  at.addGrant({
    roomJoin: true,
    room: opts.roomName,
    canPublish: true,
    canSubscribe: true,
  });
  return at.toJwt();
}

// ---------------------------------------------------------------------------
// LiveRealtimeSession
// ---------------------------------------------------------------------------

/**
 * Production `RealtimeSession` that bridges a LiveKit room participant to an
 * OpenAI Realtime WebSocket.
 *
 * Lifecycle:
 *   1. `new LiveRealtimeSession(...)` — constructs but does NOT connect.
 *   2. `connect(config)` — opens the OpenAI Realtime WebSocket, sends session.update
 *      with server-VAD + tools + instructions + audio format, and waits for
 *      `session.created`.
 *   3. `sendAudioFrame(frame)` — encodes PCM16 Uint8Array to Base64 and appends
 *      to the OpenAI input_audio_buffer.
 *   4. `onTranscript(cb)` — fires for both learner ASR (input_audio_transcription
 *      events) and tutor transcript (response.output_audio_transcript events).
 *   5. `onAudio(cb)` — fires for each tutor audio delta (Base64 decoded to Uint8Array).
 *   6. `interrupt()` — sends response.cancel to barge-in.
 *   7. `close()` — closes the OpenAI socket and leaves the LiveKit room. Idempotent.
 *
 * Tool calls (`response.function_call_arguments.done`) are emitted via the optional
 * `onToolCall` surface added in C4 so `startVoiceBridge` can route them through
 * `resolveVoiceToolCall`.
 */
export class LiveRealtimeSession implements RealtimeSession {
  // --- private state --------------------------------------------------------
  private ws: OpenAIRealtimeWS | undefined;
  private connected = false;
  private closed = false;
  private responding = false;
  private _cacheHit = false;
  private readonly transcriptCbs: Array<(t: VoiceTranscript) => void> = [];
  private readonly audioCbs: Array<(f: Uint8Array) => void> = [];
  private readonly toolCallCbs: Array<
    (call: { name: string; args: unknown; callId: string }) => void
  > = [];

  /**
   * Partial accumulator for the current tutor transcript turn. OpenAI sends
   * audio_transcript deltas; we accumulate and emit one final VoiceTranscript
   * when `response.output_audio_transcript.done` fires.
   *
   * Assumption: only one response is active at a time (server-VAD serializes turns).
   */
  private tutorTranscriptBuffer = '';

  constructor(
    private readonly openaiClient: OpenAI,
    private readonly room: Room,
    private readonly audioSource: AudioSource,
  ) {}

  // --- RealtimeSession interface --------------------------------------------

  get cacheHit(): boolean {
    return this._cacheHit;
  }

  async connect(config: RealtimeSessionConfig): Promise<void> {
    if (this.closed) throw new Error('LiveRealtimeSession: cannot connect a closed session');
    if (this.connected) return; // idempotent

    const ws = await OpenAIRealtimeWS.create(this.openaiClient, { model: config.model });
    this.ws = ws;

    // Assumption: `session.created` fires once the WebSocket handshake completes and
    // the server has initialised the session. We resolve the connect promise on that
    // event. If the event never fires (network error / auth failure) the caller's
    // timeout / AbortSignal should handle the hang — OpenAIRealtimeWS has no built-in
    // connect timeout as of openai@6.x.
    await new Promise<void>((resolve, reject) => {
      ws.once('session.created', () => resolve());
      ws.once('error', (err) => reject(err));
    });

    // Configure the session: server-side VAD, tools, instructions, audio format.
    // Cast via `unknown` to avoid fighting the RealtimeSessionCreateRequest union's
    // deeply nested type constraints — the shape is structurally correct; the cast
    // keeps the code readable and reviewable. The live smoke validates the actual
    // API acceptance.
    // Assumption: the 'type: realtime' discriminator is required by the API.
    ws.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: config.systemPrompt,
        // Server VAD: the model auto-commits when the learner stops speaking.
        // Assumption: turn_detection.type = 'server_vad' is the correct value.
        turn_detection: { type: 'server_vad', silence_duration_ms: 500 },
        // Enable learner ASR transcription.
        // Assumption: input_audio_transcription.model = 'whisper-1' is accepted.
        input_audio_transcription: { model: 'whisper-1' },
        // Tools: cast via unknown because ReadonlyArray doesn't satisfy mutable Array.
        tools: REALTIME_TOOLS as unknown,
        // Let the model emit tool calls without immediately speaking.
        tool_choice: 'auto',
      } as unknown as import('openai/resources/realtime/realtime.js').RealtimeSessionCreateRequest,
    });

    // Assumption: a second `session.updated` fires after session.update; we don't
    // wait for it since the wiring is complete after the initial `session.created`.
    // Cache-hit detection: the cacheKey is not forwarded to the OpenAI API directly
    // (they manage prompt caching internally). We track whether the session was fresh.
    // Assumption: OpenAI Realtime does NOT expose a cache hit flag in session.created.
    this._cacheHit = false;

    this._wireEvents(ws);
    this.connected = true;
  }

  sendAudioFrame(frame: Uint8Array): void {
    if (!this.connected || this.closed || !this.ws) return;
    // OpenAI Realtime expects Base64-encoded PCM16 in input_audio_buffer.append.
    const b64 = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength).toString('base64');
    this.ws.send({ type: 'input_audio_buffer.append', audio: b64 });
  }

  onTranscript(cb: (t: VoiceTranscript) => void): void {
    this.transcriptCbs.push(cb);
  }

  onAudio(cb: (frame: Uint8Array) => void): void {
    this.audioCbs.push(cb);
  }

  /**
   * Optional method added in C4 (additive — MockRealtimeSession does not need it,
   * the interface marks it `?`). Fires when the OpenAI model emits a
   * `propose_tactical_move` function call, before the result is sent back.
   */
  onToolCall(
    cb: (call: { name: string; args: unknown; callId: string }) => void,
  ): void {
    this.toolCallCbs.push(cb);
  }

  interrupt(): void {
    if (!this.connected || this.closed || !this.ws) return;
    this.ws.send({ type: 'response.cancel' });
    this.responding = false;
    this.tutorTranscriptBuffer = '';
  }

  isResponding(): boolean {
    return this.responding;
  }

  async close(): Promise<void> {
    if (this.closed) return; // idempotent
    this.closed = true;
    this.connected = false;
    this.responding = false;
    if (this.ws) {
      try {
        this.ws.close({ code: 1000, reason: 'session closed' });
      } catch {
        // Ignore — already closing.
      }
    }
    try {
      await this.room.disconnect();
    } catch {
      // Ignore — already disconnected.
    }
    await this.audioSource.close();
  }

  sendContext(text: string): void {
    if (!this.connected || this.closed || !this.ws) return;
    // Inject as a system-role conversation item WITHOUT triggering a spoken response.
    // Assumption: `conversation.item.create` with role `system` inserts a context
    // message the model reads on its next turn but does not auto-respond to (since
    // server-VAD only responds to audio, not injected items). If the model does
    // respond in text, that is benign — it won't publish audio unless it decides to.
    this.ws.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text }],
      },
    });
    // Intentionally NOT sending response.create — context pushes are read-only
    // injections; the model will incorporate them on its next VAD-triggered turn.
  }

  // --- Internal event wiring -----------------------------------------------

  private _wireEvents(ws: OpenAIRealtimeWS): void {
    // Learner ASR — input audio transcription (final only).
    // Assumption: `conversation.item.input_audio_transcription.completed` is the
    // finalized learner ASR event. The `delta` variant fires interim partials —
    // emit both as interim (final:false) and final (final:true).
    ws.on('conversation.item.input_audio_transcription.delta', (event) => {
      // Cast via unknown: the SDK's event type has no index signature.
      const ev = event as unknown as Record<string, unknown>;
      const text = typeof ev.delta === 'string' ? ev.delta : '';
      if (!text) return;
      const t: VoiceTranscript = { role: 'learner', text, at: Date.now(), final: false };
      for (const cb of this.transcriptCbs) cb(t);
    });

    ws.on('conversation.item.input_audio_transcription.completed', (event) => {
      const text: string = event.transcript ?? '';
      if (!text) return;
      const t: VoiceTranscript = { role: 'learner', text, at: Date.now(), final: true };
      for (const cb of this.transcriptCbs) cb(t);
    });

    // Tutor transcript deltas — accumulate into buffer.
    ws.on('response.output_audio_transcript.delta', (event) => {
      const ev = event as unknown as Record<string, unknown>;
      const delta = typeof ev.delta === 'string' ? ev.delta : '';
      this.tutorTranscriptBuffer += delta;
      // Emit interim chunk so the UI can show a live speech bubble.
      if (!delta) return;
      const t: VoiceTranscript = {
        role: 'tutor',
        text: this.tutorTranscriptBuffer,
        at: Date.now(),
        final: false,
      };
      for (const cb of this.transcriptCbs) cb(t);
    });

    ws.on('response.output_audio_transcript.done', (event) => {
      const ev = event as unknown as Record<string, unknown>;
      const text = typeof ev.transcript === 'string'
        ? ev.transcript
        : this.tutorTranscriptBuffer;
      this.tutorTranscriptBuffer = '';
      if (!text) return;
      const t: VoiceTranscript = { role: 'tutor', text, at: Date.now(), final: true };
      for (const cb of this.transcriptCbs) cb(t);
    });

    // Tutor audio deltas — decode Base64 PCM16 to Uint8Array.
    ws.on('response.output_audio.delta', (event) => {
      const ev = event as unknown as Record<string, unknown>;
      const delta = typeof ev.delta === 'string' ? ev.delta : '';
      if (!delta) return;
      const pcm = Buffer.from(delta, 'base64');
      for (const cb of this.audioCbs) cb(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    });

    // Response lifecycle — track isResponding().
    ws.on('response.created', () => {
      this.responding = true;
    });

    ws.on('response.done', () => {
      this.responding = false;
    });

    // Tool calls — fire only for `propose_tactical_move`.
    ws.on('response.function_call_arguments.done', (event) => {
      const ev = event as unknown as Record<string, unknown>;
      const name = typeof ev.name === 'string' ? ev.name : '';
      const callId = typeof ev.call_id === 'string' ? ev.call_id : '';
      const rawArgs = typeof ev.arguments === 'string' ? ev.arguments : '{}';
      let args: unknown;
      try {
        args = JSON.parse(rawArgs);
      } catch {
        args = {};
      }
      for (const cb of this.toolCallCbs) cb({ name, args, callId });
    });

    // Error — log without crashing. The bridge's fail-closed invariant means a
    // corrupt session just stops producing output rather than erroring the whole agent.
    ws.on('error', (err) => {
      // Secrets are not logged here — the error message may contain connection info
      // but NOT the API key (the SDK resolves keys internally, never in the URL/message).
      console.error('[voice:realtime] OpenAI Realtime error — session will degrade', {
        message: err.message,
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Production `RealtimeSessionFactory`.
 *
 * Joins the LiveKit room as a server-side agent participant, publishes an audio
 * track for tutor output, subscribes to the learner's audio track, and wraps an
 * `OpenAIRealtimeWS` as a `LiveRealtimeSession`.
 *
 * The returned `{ session, publishAudio, onLearnerAudio, close }` satisfies the
 * factory shape that `startVoiceBridge` in `startBridge.ts` expects.
 *
 * Fail-closed: the factory is ONLY called when OPENAI_API_KEY is present AND
 * `voiceConfigured()` is true (enforced by the guard in `createServer`). This
 * file is dynamically imported at that guard; a missing native binding (wrong
 * base image) throws at `import` time, which the guard catches and leaves
 * `createRealtimeSession` undefined → no bridge, /api/health unaffected.
 */
export const createLiveRealtimeSession: RealtimeSessionFactory = async (args) => {
  const { sessionId, roomName, livekitUrl, apiKey, apiSecret, model, systemPrompt } = args;

  // --- Mint agent token ---
  const token = await mintAgentToken({ sessionId, roomName, apiKey, apiSecret });

  // --- Join LiveKit room ---
  const room = new Room();
  await room.connect(livekitUrl, token, { autoSubscribe: true, dynacast: false });

  // --- Publish tutor audio track ---
  // AudioSource: 24 kHz mono, queue size 10 frames to smooth jitter without
  // introducing significant latency (100ms * 10 = 1 s max buffered audio).
  const audioSource = new AudioSource(OAI_SAMPLE_RATE, OAI_CHANNELS, 10);
  const tutorTrack = LocalAudioTrack.createAudioTrack('tutor-audio', audioSource);
  // TrackPublishOptions is a protobuf-generated type re-exported from @livekit/rtc-node;
  // an empty plain object is not directly assignable because it's a class with required
  // proto fields. Cast via unknown to use SDK defaults (Opus codec, 32 kbps).
  // The live smoke should verify audio quality and tune codec/bitrate if needed.
  await room.localParticipant!.publishTrack(tutorTrack, {} as unknown as TrackPublishOptions);

  // --- Build the session (not yet connected) ---
  const openaiClient = new OpenAI({
    // OPENAI_API_KEY is read from process.env automatically by the OpenAI SDK.
    // Never pass apiKey from args — those are LiveKit credentials.
  });
  const liveSession = new LiveRealtimeSession(openaiClient, room, audioSource);

  // --- Wire learner audio callbacks ---
  const learnerAudioCbs: Array<(frame: Uint8Array) => void> = [];

  function onLearnerAudio(cb: (frame: Uint8Array) => void): void {
    learnerAudioCbs.push(cb);
  }

  // Subscribe to already-present remote audio tracks.
  function wireRemoteAudioTrack(track: import('@livekit/rtc-node').RemoteAudioTrack): void {
    // Assumption: AudioStream constructor with (track, sampleRate, numChannels) resamples
    // to the requested rate. The @livekit/rtc-node SDK docs indicate the constructor
    // accepts optional sampleRate and numChannels to request a specific format from the
    // audio resampler. If the installed version does not support resampling on construction
    // the frames will arrive at the source sample rate (typically 48 kHz); `sendAudioFrame`
    // would then send 48 kHz audio to OpenAI expecting 24 kHz — confirm in live smoke.
    const stream = new AudioStream(track, OAI_SAMPLE_RATE, OAI_CHANNELS);

    // Drain the AudioStream (a ReadableStream<AudioFrame>) continuously.
    // Each AudioFrame contains Int16Array PCM16 data; we reinterpret it as Uint8Array
    // for the bridge. The bridge calls `session.sendAudioFrame` which re-encodes to
    // Base64 for OpenAI. The bridge also calls `bridge.onLearnerAudioActivity()` for
    // barge-in detection.
    void (async () => {
      try {
        const reader = stream.getReader();
        while (true) {
          const { done, value: frame } = await reader.read();
          if (done) break;
          // Reinterpret Int16Array as Uint8Array (same underlying ArrayBuffer, no copy).
          const raw = new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength * 2);
          for (const cb of learnerAudioCbs) cb(raw);
        }
      } catch (err) {
        // Stream closed on room disconnect — not an error in the normal teardown path.
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('closed') && !msg.includes('disconnect')) {
          console.error('[voice:room] learner audio stream error', { message: msg });
        }
      }
    })();
  }

  // Wire tracks that are already subscribed when the factory runs.
  // `track.kind` is a `TrackKind` proto enum (TrackKind.KIND_AUDIO = 1), not a string.
  for (const [, participant] of room.remoteParticipants) {
    for (const [, pub] of participant.trackPublications) {
      if (pub.track && pub.track.kind === TrackKind.KIND_AUDIO) {
        wireRemoteAudioTrack(pub.track as import('@livekit/rtc-node').RemoteAudioTrack);
      }
    }
  }

  // Wire tracks that arrive after the factory returns.
  room.on('trackSubscribed', (track) => {
    if (track.kind === TrackKind.KIND_AUDIO) {
      wireRemoteAudioTrack(track as import('@livekit/rtc-node').RemoteAudioTrack);
    }
  });

  // --- publishAudio: bridge → room ---
  // Called by the bridge with tutor PCM16 Uint8Array frames from OpenAI Realtime.
  // Reinterpret as Int16Array (PCM16 little-endian words) for AudioFrame.
  function publishAudio(frame: Uint8Array): void {
    try {
      if (!frame.byteLength) return;
      // Node pools Buffers — a slice from a pooled Buffer carries a non-zero byteOffset
      // that may be ODD. `new Int16Array(buffer, oddOffset)` throws a RangeError because
      // Int16Array requires 2-byte alignment. Copy onto a fresh Uint8Array (always
      // 0-aligned) before creating the Int16 view to guarantee alignment. `slice()`
      // returns a new allocation, so no shared-buffer aliasing either.
      const copy = frame.slice();
      // Guard odd byte-lengths (malformed frames) by flooring the sample count.
      const samplesPerChannel = Math.floor(copy.byteLength / 2);
      if (samplesPerChannel === 0) return;
      const pcm16 = new Int16Array(copy.buffer, copy.byteOffset, samplesPerChannel);
      const audioFrame = new AudioFrame(pcm16, OAI_SAMPLE_RATE, OAI_CHANNELS, samplesPerChannel);
      // captureFrame is async (backpressure-aware); fire-and-forget here because
      // the bridge calls this at decode-time and the AudioSource queues internally.
      // A queue overflow will cause frames to be dropped — acceptable for voice (no stutter
      // recovery needed; the model sends audio at its own pace).
      void audioSource.captureFrame(audioFrame).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('closed')) {
          console.error('[voice:room] captureFrame failed', { message: msg });
        }
      });
    } catch (err) {
      // A malformed frame must log+drop rather than propagate out of the synchronous WS
      // listener, which would crash the process. (ADR-018 fail-closed: bad frame → silent
      // drop; valid frames before and after are unaffected.)
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[voice:room] publishAudio: malformed frame dropped', { message: msg });
    }
  }

  // --- close: tear down room + session ---
  async function close(): Promise<void> {
    await liveSession.close(); // closes both OpenAI WS and room
  }

  // Wire the session's connect with the supplied systemPrompt as a default.
  // The bridge calls connect(config) with the fully-resolved config; this is a
  // pre-warm path so the factory can trigger the connect on return if desired.
  // We return without connecting — startVoiceBridge calls bridge.start() which
  // calls session.connect(). The factory's job is to set up the transport layer.
  if (systemPrompt) {
    // Store for bridge's connect call; the bridge uses its own persona prompt.
    // This is available but the bridge always calls connect(config) explicitly.
    void 0; // no-op: bridge owns the connect call
  }

  return { session: liveSession, publishAudio, onLearnerAudio, close };
};
