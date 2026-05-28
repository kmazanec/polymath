import { describe, expect, it } from 'vitest';
import { MockRealtimeSession, resetCacheRegistry } from './realtimeClient.js';
import { ExplainBackCapture } from './explainBackCapture.js';

/**
 * AC#10 — the explain-back-phase prosody capture over the WebRTC/RealtimeSession
 * seam. It subscribes to the SAME `onTranscript` stream the voice bridge uses, but
 * scoped to the explain-back phase: it accumulates the learner's utterance and
 * derives prosody features (filled pauses, mid-utterance silences, restarts) the
 * LLM judge consumes. Driven deterministically by MockRealtimeSession.
 *
 * The bare `explain_back_recording_ended` ClientEvent stays the server-side
 * completion signal; the transcript + prosody arrive over this bridge.
 */
describe('ExplainBackCapture', () => {
  function freshSession(): MockRealtimeSession {
    resetCacheRegistry();
    return new MockRealtimeSession({ systemPrompt: 'p', cacheKey: 'k', model: 'gpt-realtime' });
  }

  it('captures the learner transcript and counts filled pauses + restarts', async () => {
    const session = freshSession();
    await session.connect();
    const capture = new ExplainBackCapture(session);
    capture.start();

    // Emit learner chunks directly through the transcript stream (the capture only
    // cares about learner-role chunks).
    capture.ingest({ role: 'learner', text: 'um, for A and B uh the— the output is true', at: 1, final: false });
    capture.ingest({ role: 'learner', text: 'um, for A and B uh the— the output is true when both are true', at: 2, final: true });

    const prosody = capture.prosody();
    expect(prosody.filledPauses).toBeGreaterThanOrEqual(2); // "um", "uh"
    expect(prosody.restarts).toBeGreaterThanOrEqual(1); // "the— the"
    expect(capture.transcript()).toMatch(/output is true when both are true/);
  });

  it('counts mid-utterance silences from gaps between non-final chunks', () => {
    const session = freshSession();
    const capture = new ExplainBackCapture(session);
    capture.start();
    // Two chunks far apart in time → a mid-utterance silence.
    capture.ingest({ role: 'learner', text: 'A and B', at: 1000, final: false });
    capture.ingest({ role: 'learner', text: 'A and B ... are both true', at: 4000, final: true });
    expect(capture.prosody().midUtteranceSilences).toBeGreaterThanOrEqual(1);
  });

  it('ignores tutor-role chunks (only the learner utterance feeds prosody)', () => {
    const session = freshSession();
    const capture = new ExplainBackCapture(session);
    capture.start();
    capture.ingest({ role: 'tutor', text: 'um, can you say more?', at: 1, final: true });
    expect(capture.transcript()).toBe('');
    expect(capture.prosody().filledPauses).toBe(0);
  });

  it('a clean, fluent recitation has zero disfluency (reads-not-thinks signal)', () => {
    const session = freshSession();
    const capture = new ExplainBackCapture(session);
    capture.start();
    capture.ingest({
      role: 'learner',
      text: 'The AND gate produces a true output only when both inputs A and B are true.',
      at: 1,
      final: true,
    });
    expect(capture.prosody()).toEqual({ filledPauses: 0, midUtteranceSilences: 0, restarts: 0 });
  });

  it('subscribes to the live session onTranscript when started against a real session', async () => {
    const session = freshSession();
    await session.connect();
    const capture = new ExplainBackCapture(session);
    capture.start();
    session.pushLearnerUtterance('um for A and B the output is true');
    session.flush();
    // The mock's canned tutor reply is ignored; only the learner chunk feeds prosody.
    expect(capture.transcript()).toMatch(/A and B/);
    expect(capture.prosody().filledPauses).toBeGreaterThanOrEqual(1);
  });
});
