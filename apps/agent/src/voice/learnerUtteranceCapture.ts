import type { VoiceTranscript } from './realtimeClient.js';

/**
 * F-30: General-utterance capture seam — a sibling of `ExplainBackCapture`.
 *
 * Records the latest learner utterance for spoken Q&A routing. Unlike the
 * explain-back capture, this is SESSION-scoped (no targetItemId), prosody-
 * free (we don't need disfluency features here), and purely captures text.
 *
 * Design: the latest learner chunk wins (cumulative partials, then final —
 * same streaming model as the explain-back capture). Tutor chunks are
 * ignored: the agent's side of the conversation is irrelevant to routing
 * the learner's question.
 *
 * Invariant: `transcript()` returns '' before any learner chunk is ingested
 * (fails closed → the spoken-turn handler sees no utterance → acks, no answer).
 */
export class LearnerUtteranceCapture {
  private latestText = '';

  /**
   * Consume one transcript chunk from the voice stream.
   * Only learner-role chunks update the stored utterance.
   */
  ingest(t: VoiceTranscript): void {
    if (t.role !== 'learner') return;
    this.latestText = t.text;
  }

  /**
   * The latest captured learner utterance, or '' if none has been received.
   * Fails closed: a fresh capture (or one that has only seen tutor chunks)
   * returns '' so the spoken-turn handler cannot answer a non-existent question.
   */
  transcript(): string {
    return this.latestText;
  }
}
