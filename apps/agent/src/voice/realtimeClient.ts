/**
 * The realtime voice boundary: the abstract `RealtimeSession` interface plus a
 * fully in-memory `MockRealtimeSession` test double.
 *
 * This is the seam that isolates the rest of the voice stack from the network
 * (OpenAI-Realtime over LiveKit). The bridge that wires LiveKit audio to the
 * model, and the event logger that records transcripts/timing, both program
 * against `RealtimeSession` — so they can be driven deterministically in tests
 * with no keys and no sockets. A future real implementation satisfies the same
 * contract.
 *
 * Mental model: feed learner audio in, get transcripts + tutor audio out, support
 * barge-in (interrupt), and observe `cacheHit` + per-chunk timing.
 */

export interface VoiceTranscript {
  role: 'learner' | 'tutor';
  text: string;
  /** ms epoch when this transcript chunk was finalized. */
  at: number;
  /** true once the model considers the utterance complete. */
  final: boolean;
}

export interface RealtimeSessionConfig {
  /** Cache-friendly system prompt, from persona.buildVoiceSystemPrompt. */
  systemPrompt: string;
  /** Stable per (session, lesson-state); enables provider prompt caching. */
  cacheKey: string;
  /** e.g. process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime'. */
  model: string;
}

export interface RealtimeSession {
  /** Open the realtime connection. Resolves once ready to receive audio. */
  connect(): Promise<void>;
  /** Push a chunk of learner audio (PCM/opus frame as bytes). */
  sendAudioFrame(frame: Uint8Array): void;
  /** Subscribe to finalized/partial transcripts (both learner ASR + tutor text). */
  onTranscript(cb: (t: VoiceTranscript) => void): void;
  /** Subscribe to outbound tutor audio frames to play back to the room. */
  onAudio(cb: (frame: Uint8Array) => void): void;
  /** Barge-in: stop the model's current spoken response immediately. */
  interrupt(): void;
  /** Whether the model is currently speaking (for barge-in logic). */
  isResponding(): boolean;
  /** Tear down. Idempotent. */
  close(): Promise<void>;
  /** True if this session's systemPrompt hit the provider prompt cache. */
  readonly cacheHit: boolean;
}

/** Scripted tutor reply the mock emits after a learner utterance. */
export interface MockReply {
  tutorText: string;
  /** How many tutor audio frames to emit for this reply. */
  audioFrames: number;
}

export interface MockRealtimeSessionOpts {
  /** The canned tutor reply emitted for each pushed learner utterance. */
  reply?: MockReply;
  /**
   * Force the reported cacheHit. When omitted, cacheHit is derived from the
   * shared registry: false on the first connect with a given cacheKey, true on
   * later connects with the same key (the "cache warms after first turn" shape).
   */
  cacheHit?: boolean;
}

const DEFAULT_REPLY: MockReply = { tutorText: 'Tell me more.', audioFrames: 1 };

/**
 * Module-level registry of cacheKeys that have been connected with at least once.
 * Drives the default cacheHit behavior so a test can demonstrate the prefix cache
 * warming across turns. Reset between tests via `resetCacheRegistry()`.
 */
const seenCacheKeys = new Set<string>();

/** Clear the cache-warming registry — call in a test `beforeEach`. */
export function resetCacheRegistry(): void {
  seenCacheKeys.clear();
}

type Emission =
  | { kind: 'transcript'; value: VoiceTranscript }
  | { kind: 'audio'; value: Uint8Array };

/**
 * Deterministic in-memory `RealtimeSession`. No timers, no network: emissions are
 * queued when a learner utterance is pushed, and the test drains them manually
 * via `tick()` (one emission) or `flush()` (all remaining). `isResponding()` is
 * true while the queue holds tutor output; `interrupt()` discards the queue and
 * clears it. This gives C3/C4 full control over ordering and barge-in timing
 * without flaky real-time behavior.
 */
export class MockRealtimeSession implements RealtimeSession {
  /** Recorded for wiring assertions. */
  readonly sentFrames: Uint8Array[] = [];
  connectedWith: RealtimeSessionConfig | undefined;

  private readonly config: RealtimeSessionConfig;
  private readonly opts: MockRealtimeSessionOpts;
  private readonly reply: MockReply;
  private readonly transcriptCbs: Array<(t: VoiceTranscript) => void> = [];
  private readonly audioCbs: Array<(f: Uint8Array) => void> = [];

  /** Pending tutor output to drain; learner ASR is enqueued ahead of it. */
  private queue: Emission[] = [];
  private connected = false;
  private closed = false;
  private responding = false;
  private _cacheHit = false;
  /** Monotonic stand-in for ms-epoch timestamps; deterministic across runs. */
  private clock = 0;

  constructor(config: RealtimeSessionConfig, opts: MockRealtimeSessionOpts = {}) {
    this.config = config;
    this.opts = opts;
    this.reply = opts.reply ?? DEFAULT_REPLY;
  }

  get cacheHit(): boolean {
    return this._cacheHit;
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error('cannot connect a closed session');
    this.connectedWith = this.config;
    this._cacheHit = this.opts.cacheHit ?? seenCacheKeys.has(this.config.cacheKey);
    seenCacheKeys.add(this.config.cacheKey);
    this.connected = true;
    return Promise.resolve();
  }

  sendAudioFrame(frame: Uint8Array): void {
    if (!this.connected || this.closed) {
      throw new Error('sendAudioFrame requires an open session');
    }
    this.sentFrames.push(frame);
  }

  onTranscript(cb: (t: VoiceTranscript) => void): void {
    this.transcriptCbs.push(cb);
  }

  onAudio(cb: (frame: Uint8Array) => void): void {
    this.audioCbs.push(cb);
  }

  interrupt(): void {
    // Barge-in: drop everything not yet emitted and stop "speaking" at once.
    this.queue = [];
    this.responding = false;
  }

  isResponding(): boolean {
    return this.responding;
  }

  async close(): Promise<void> {
    // Idempotent teardown.
    this.closed = true;
    this.connected = false;
    this.responding = false;
    this.queue = [];
    return Promise.resolve();
  }

  // --- Test-driving surface (not part of RealtimeSession) ---

  /**
   * Script a learner utterance. Enqueues the finalized learner ASR transcript
   * followed by the canned tutor reply (transcript + N audio frames), and marks
   * the session as responding. Drain with `tick()`/`flush()`.
   */
  pushLearnerUtterance(text: string): void {
    if (!this.connected || this.closed) {
      throw new Error('pushLearnerUtterance requires an open session');
    }
    this.queue.push({
      kind: 'transcript',
      value: { role: 'learner', text, at: this.nextAt(), final: true },
    });
    this.queue.push({
      kind: 'transcript',
      value: { role: 'tutor', text: this.reply.tutorText, at: this.nextAt(), final: true },
    });
    for (let i = 0; i < this.reply.audioFrames; i++) {
      this.queue.push({ kind: 'audio', value: new Uint8Array([i]) });
    }
    this.responding = true;
  }

  /** Emit a single queued emission, if any. Returns true if one was emitted. */
  tick(): boolean {
    const next = this.queue.shift();
    if (!next) {
      this.responding = false;
      return false;
    }
    if (next.kind === 'transcript') {
      for (const cb of this.transcriptCbs) cb(next.value);
    } else {
      for (const cb of this.audioCbs) cb(next.value);
    }
    if (this.queue.length === 0) this.responding = false;
    return true;
  }

  /** Drain all queued emissions synchronously. */
  flush(): void {
    while (this.tick()) {
      // tick() drains one at a time and flips responding off when empty.
    }
  }

  private nextAt(): number {
    return ++this.clock;
  }
}
