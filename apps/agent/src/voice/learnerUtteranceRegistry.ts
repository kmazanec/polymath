/**
 * F-30: The server-side registry that backs `latestLearnerUtteranceFor(sessionId)`.
 *
 * This is the INTEGRITY SEAM for spoken Q&A: the server reads the learner's
 * question from here, never from the client-sent `spoken_turn` frame. The frame
 * carries NO transcript/question field for exactly this reason.
 *
 * Design (copy/strip of `ExplainBackCaptureRegistry`, sessionId-only key):
 *  - `setLatest(sessionId, text)` — called by the VoiceBridge when a learner
 *    chunk finalizes. Empty/whitespace text is treated as no utterance.
 *  - `latestFor(sessionId)` — read by `handleSpokenTurnTurn`. Returns
 *    `undefined` for unknown sessions or empty captures → fail closed.
 *
 * Invariant: a missing or empty capture → `undefined` → the spoken-turn
 * handler acks without answering. This is the "fails closed" half of the
 * "server-captured only, never the client frame" rule.
 */
export class LearnerUtteranceRegistry {
  private readonly latest = new Map<string, string>();

  /**
   * Store the latest captured learner utterance for a session.
   * Empty or whitespace-only text is treated as no utterance (fails closed):
   * the next `latestFor` call returns undefined rather than answering the
   * empty question.
   */
  setLatest(sessionId: string, text: string): void {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      this.latest.set(sessionId, trimmed);
    } else {
      // Explicitly clear so a previous real utterance isn't accidentally reused
      // when the next chunk is empty (e.g. a partial with no content yet).
      this.latest.delete(sessionId);
    }
  }

  /**
   * The most recent server-captured utterance for a session, or `undefined`
   * when none was captured (→ the spoken-turn handler fails closed).
   */
  latestFor(sessionId: string): string | undefined {
    return this.latest.get(sessionId);
  }
}
