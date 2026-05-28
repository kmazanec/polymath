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
  /** Model identifier recorded on the turn + span (e.g. 'gpt-realtime'). */
  modelVersion: string;
  /** Publishes a tutor audio frame to the room. Injected so it is testable. */
  publishAudio: (frame: Uint8Array) => void;
  /** Injected clock for deterministic ttft measurement; defaults to Date.now. */
  now?: () => number;
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

    await session.connect();
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
      if (t.final) this.turn.learnerFinalAt = t.at;
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
    if (t.final && this.turnHasContent()) {
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

  /** A turn is real once a learner utterance has begun it (text or a final mark).
   *  A fresh, untouched accumulator is not a turn worth persisting. */
  private turnHasContent(): boolean {
    return this.turn.learnerText !== undefined || this.turn.learnerFinalAt !== undefined;
  }

  /**
   * Assemble, persist, and observe a finished turn, then reset the accumulator for
   * the next one. Persistence runs before the span so the span can carry the real
   * `transcriptLogId` (the persisted row's id).
   */
  private async completeTurn(): Promise<void> {
    const finished = this.turn;
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
