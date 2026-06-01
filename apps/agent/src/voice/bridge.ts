/**
 * The voice bridge: wires a `RealtimeSession` to a (logical) LiveKit room and
 * persists each completed turn.
 *
 * The bridge programs against the `RealtimeSession` seam, never a concrete SDK.
 * In tests the session is a `MockRealtimeSession` and `publishAudio` is a spy; in
 * production the same surface is satisfied by a LiveKit-backed `RealtimeSession`
 * (publishing learner mic frames in, receiving tutor frames out) and a
 * `publishAudio` that writes tutor frames to the room's audio track. Keeping both
 * injected means the whole turn lifecycle — connect, transcript capture, barge-in,
 * persistence, observability — is exercised deterministically with no network.
 *
 * Responsibilities:
 *  - Build the cache-friendly persona prompt + cache key and connect the session.
 *  - Forward tutor audio frames to `publishAudio`.
 *  - Barge-in: when the room's VAD reports learner audio while the tutor is still
 *    responding, interrupt the model immediately so it stops talking.
 *  - On each completed learner→tutor exchange, persist a `voice_turn` row and emit
 *    a `voice.turn` OTel span, measuring time-to-first-token off the transcript
 *    timestamps.
 */
import type { Db } from '../db/client.js';
import {
  type RealtimeSession,
  type VoiceTranscript,
} from './realtimeClient.js';
import { buildVoiceSystemPrompt, voiceCacheKey } from './persona.js';
import { logVoiceTurn, type VoiceTurnPayload } from './voiceTurn.js';
import { recordVoiceTurnSpan } from './otel.js';

export interface VoiceBridgeOpts {
  /** The realtime model boundary — a mock in tests, LiveKit-backed in prod. */
  session: RealtimeSession;
  db: Db;
  sessionId: string;
  learnerId: string;
  lessonId: number;
  lessonTitle: string;
  /** Statechart phase the turn happens in (drives persona + cache key). */
  phase: string;
  /** Model identifier recorded on the turn + span (e.g. 'gpt-realtime'). Also the
   *  realtime model the session connects with, unless `realtimeModel` overrides. */
  modelVersion: string;
  /** Realtime model id for the connection config; defaults to `modelVersion`. */
  realtimeModel?: string;
  /** Publishes a tutor audio frame to the room. Injected so it is testable. */
  publishAudio: (frame: Uint8Array) => void;
  /** Injected clock for deterministic ttft measurement; defaults to Date.now. */
  now?: () => number;
  /**
   * F-30 (ADR-016): general-utterance fill-the-seam callback.
   *
   * Fired on each LEARNER transcript chunk (not tutor chunks). The production
   * wiring calls `utteranceRegistry.setLatest(sessionId, text)` here so the
   * server-captured utterance is available when a `spoken_turn` frame arrives.
   *
   * This is the "legitimate path actually fills the seam" half of the CLAUDE.md
   * invariant: "a fail-closed input nothing fills is a gate nobody can pass."
   * When absent (tests, or a future non-spoken session) it silently no-ops.
   */
  onLearnerUtterance?: (text: string) => void;
}

/** Mutable accumulator for the turn currently being assembled. */
interface PendingTurn {
  turnId: string;
  learnerText: string | undefined;
  tutorText: string | undefined;
  /** When the learner utterance finalized — the ttft start mark. */
  learnerFinalAt: number | undefined;
  /** When the first tutor output (transcript or audio frame) arrived. */
  firstTutorOutputAt: number | undefined;
  bargeIn: boolean;
}

function freshTurn(turnId: string): PendingTurn {
  return {
    turnId,
    learnerText: undefined,
    tutorText: undefined,
    learnerFinalAt: undefined,
    firstTutorOutputAt: undefined,
    bargeIn: false,
  };
}

/** A turn is real once a learner utterance has begun it (text or a final mark).
 *  A fresh, untouched accumulator is not a turn worth persisting. */
function turnHasContent(turn: PendingTurn): boolean {
  return turn.learnerText !== undefined || turn.learnerFinalAt !== undefined;
}

export class VoiceBridge {
  private readonly opts: VoiceBridgeOpts;
  private readonly now: () => number;
  private turn: PendingTurn;
  private turnSeq = 0;
  private started = false;
  private stopped = false;

  constructor(opts: VoiceBridgeOpts) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.turn = freshTurn(this.nextTurnId());
  }

  /** Connect the session and subscribe to its transcript/audio streams. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const { session } = this.opts;
    session.onTranscript((t) => this.handleTranscript(t));
    session.onAudio((frame) => this.handleAudio(frame));

    // Build the cache-friendly persona config from this bridge's lesson state and
    // hand it to the session — so the room connects with the Socratic system prompt
    // and a cache key stable across turns in the session (keeping the provider
    // prompt cache warm). The stable persona prefix dominates the prompt; only the
    // small lesson-context tail varies (see persona.ts).
    const personaInput = {
      lessonId: this.opts.lessonId,
      lessonTitle: this.opts.lessonTitle,
      phase: this.opts.phase,
    };
    await session.connect({
      systemPrompt: buildVoiceSystemPrompt(personaInput),
      cacheKey: voiceCacheKey(personaInput),
      model: this.opts.realtimeModel ?? this.opts.modelVersion,
    });
  }

  /**
   * The room's VAD detected the learner speaking. If the tutor is mid-response,
   * this is a barge-in: interrupt the model at once so it stops talking, mark the
   * in-flight turn, and persist it. A barged-in turn never receives a final tutor
   * transcript (the model was cut off), so the interrupt itself — not transcript
   * completion — is what finalizes the record; otherwise the cut-off exchange
   * would never be logged with `bargeIn:true`.
   */
  onLearnerAudioActivity(): void {
    if (this.stopped) return;
    if (this.opts.session.isResponding()) {
      this.turn.bargeIn = true;
      this.opts.session.interrupt();
      void this.completeTurn();
    }
  }

  /** Tear down the session. Idempotent. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.opts.session.close();
  }

  private handleTranscript(t: VoiceTranscript): void {
    // A real provider's WebSocket drains asynchronously, so a transcript can land
    // after close(); ignore it rather than insert against a draining pool.
    if (this.stopped) return;

    if (t.role === 'learner') {
      this.turn.learnerText = t.text;
      if (t.final) {
        this.turn.learnerFinalAt = t.at;
        // F-30: fire the general-utterance callback (fill-the-seam) ONLY on a
        // FINALIZED learner segment — not on interim ASR partials. Firing on every
        // chunk let a client send spoken_turn mid-stream and have the server answer an
        // incomplete question ("what is" instead of "what is NAND"). Gating on `t.final`
        // (the same signal used for learnerFinalAt / voice_turn persistence) means the
        // captured utterance is always a complete thought. Absent callback → silently
        // no-ops (not all sessions need spoken Q&A). (MR !11 review.)
        this.opts.onLearnerUtterance?.(t.text);
      }
      return;
    }

    // Tutor transcript: the first tutor output marks ttft; a final tutor
    // transcript completes the turn.
    if (this.turn.firstTutorOutputAt === undefined) {
      this.turn.firstTutorOutputAt = t.at;
    }
    this.turn.tutorText = t.text;
    // Only a turn that actually started (a learner utterance began it) completes
    // on a final tutor transcript. After a barge-in, completeTurn() already reset
    // to a fresh empty turn; a late final tutor segment racing the interrupt must
    // not log a phantom empty turn.
    if (t.final && turnHasContent(this.turn)) {
      void this.completeTurn();
    }
  }

  private handleAudio(frame: Uint8Array): void {
    if (this.stopped) return;
    // First tutor *audio* can arrive before/without a tutor transcript; either way
    // it counts as first output for ttft. Use the injected clock since audio frames
    // carry no timestamp.
    if (this.turn.firstTutorOutputAt === undefined) {
      this.turn.firstTutorOutputAt = this.now();
    }
    this.opts.publishAudio(frame);
  }

  /**
   * Assemble, persist, and observe a finished turn, then reset the accumulator for
   * the next one. Persistence runs before the span so the span can carry the real
   * `transcriptLogId` (the persisted row's id).
   *
   * The accumulator swap is the serialization point: it is synchronous and there
   * is no `await` before it, so two callers (e.g. a barge-in racing a final tutor
   * transcript) can never both read the *same* pending turn — the first swaps in a
   * fresh turn and the second sees it. The empty-turn guard then drops that second
   * call so it can't insert a phantom `voice_turn` row.
   */
  private async completeTurn(): Promise<void> {
    const finished = this.turn;
    if (!turnHasContent(finished)) return;
    // Reset immediately so any further emissions belong to the next turn, even if
    // the async persistence below is still in flight.
    this.turn = freshTurn(this.nextTurnId());

    const ttftMs = this.computeTtft(finished);

    const payload: VoiceTurnPayload = {
      turnId: finished.turnId,
      transcript: {
        ...(finished.learnerText !== undefined ? { learner: finished.learnerText } : {}),
        ...(finished.tutorText !== undefined ? { tutor: finished.tutorText } : {}),
      },
      modelVersion: this.opts.modelVersion,
      cacheHit: this.opts.session.cacheHit,
      ttftMs,
      bargeIn: finished.bargeIn,
      // Placeholder; logVoiceTurn assigns the real row id before the insert.
      transcriptLogId: '',
    };

    const { transcriptLogId } = await logVoiceTurn(
      this.opts.db,
      this.opts.sessionId,
      payload,
    );

    recordVoiceTurnSpan({
      turnId: finished.turnId,
      learnerId: this.opts.learnerId,
      lessonId: this.opts.lessonId,
      phase: this.opts.phase,
      modelVersion: this.opts.modelVersion,
      cacheHit: this.opts.session.cacheHit,
      ttftMs,
      bargeIn: finished.bargeIn,
      transcriptLogId,
    });
  }

  /**
   * Time-to-first-token: from the learner utterance finalizing to the first tutor
   * output. Both marks come from `VoiceTranscript.at` (or the injected clock for
   * audio), so the value is deterministic in tests. If either mark is missing
   * (a turn with no learner final, say), ttft is 0 rather than a negative/NaN.
   */
  private computeTtft(turn: PendingTurn): number {
    if (turn.learnerFinalAt === undefined || turn.firstTutorOutputAt === undefined) {
      return 0;
    }
    return Math.max(0, turn.firstTutorOutputAt - turn.learnerFinalAt);
  }

  private nextTurnId(): string {
    return `${this.opts.sessionId}:turn:${++this.turnSeq}`;
  }
}
