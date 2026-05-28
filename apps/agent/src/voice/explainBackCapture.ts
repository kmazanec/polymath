import type { ProsodyFeatures } from '@polymath/graph';
import type { RealtimeSession, VoiceTranscript } from './realtimeClient.js';

/**
 * AC#10 — the explain-back-phase prosody capture (the largest-scope I2 item).
 *
 * It programs against the F-10 `RealtimeSession` seam (NOT a concrete SDK): the
 * same `onTranscript` stream the `VoiceBridge` consumes, but scoped to the
 * explain-back phase. It accumulates the learner's utterance and derives the
 * `ProsodyFeatures` (filled pauses, mid-utterance silences, restarts) the LLM judge
 * uses to tell thinking-while-speaking from reading-from-elsewhere.
 *
 * Deterministically testable with `MockRealtimeSession` driving synthetic
 * disfluency markers. The live cross-platform device smoke is DEFERRED (needs real
 * keys + devices; see docs/voice-cross-platform-smoke.md) — the prosody DERIVATION
 * is what's tested here.
 *
 * Design note: this EXTENDS the voice path (a new consumer of the existing
 * `RealtimeSession.onTranscript`); it does not reshape `RealtimeSession`.
 */

/** Filled-pause fillers, matched case-insensitively as whole words. */
const FILLERS = ['um', 'uh', 'er', 'erm', 'uhh', 'umm', 'hmm', 'like'];
/** A gap (ms) between successive learner chunks that counts as a mid-utterance
 *  silence. The mock clock is monotonic-small; a 1.5s gap is a conservative bar. */
const SILENCE_GAP_MS = 1_500;
/** A self-restart marker: a dash/ellipsis immediately repeated word ("the— the"). */
const RESTART_RE = /(\b\w+)\s*[—–-]+\s*\1\b/gi;

export class ExplainBackCapture {
  private readonly session: RealtimeSession;
  private latestText = '';
  private filledPauses = 0;
  private restarts = 0;
  private midUtteranceSilences = 0;
  private lastChunkAt: number | undefined;
  private started = false;

  constructor(session: RealtimeSession) {
    this.session = session;
  }

  /** Subscribe to the session's transcript stream for the explain-back phase. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.session.onTranscript((t) => this.ingest(t));
  }

  /** Consume one transcript chunk. Public so tests can drive it directly without a
   *  full session round-trip; `start()` wires the live stream to the same path. */
  ingest(t: VoiceTranscript): void {
    if (t.role !== 'learner') return; // only the learner's utterance feeds prosody

    // Mid-utterance silence: a large gap since the previous learner chunk.
    if (this.lastChunkAt !== undefined && t.at - this.lastChunkAt >= SILENCE_GAP_MS) {
      this.midUtteranceSilences++;
    }
    this.lastChunkAt = t.at;

    // The latest learner chunk is the most complete transcript so far (the provider
    // emits cumulative partials, then a final). Recount disfluency from the latest
    // text so partial/final duplication doesn't double-count.
    this.latestText = t.text;
    this.recountDisfluency(t.text);
  }

  /** The captured learner transcript (the most complete chunk seen). */
  transcript(): string {
    return this.latestText;
  }

  /** The derived prosody features for the judge input. */
  prosody(): ProsodyFeatures {
    return {
      filledPauses: this.filledPauses,
      midUtteranceSilences: this.midUtteranceSilences,
      restarts: this.restarts,
    };
  }

  /** Recompute filled-pause + restart counts from the latest (most complete) text.
   *  Mid-utterance silences are timing-derived and accumulate across chunks. */
  private recountDisfluency(text: string): void {
    const lower = text.toLowerCase();
    let pauses = 0;
    for (const filler of FILLERS) {
      const re = new RegExp(`\\b${filler}\\b`, 'g');
      pauses += (lower.match(re) ?? []).length;
    }
    this.filledPauses = pauses;
    this.restarts = (text.match(RESTART_RE) ?? []).length;
  }
}
