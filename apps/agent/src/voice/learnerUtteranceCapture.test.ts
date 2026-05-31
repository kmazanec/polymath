import { describe, expect, it } from 'vitest';
import { LearnerUtteranceCapture } from './learnerUtteranceCapture.js';

/**
 * F-30 (checklist item 1): unit tests for the general-utterance capture seam.
 *
 * The seam is a sibling of ExplainBackCapture, scoped to the general Q&A path:
 *  - It captures the latest learner utterance (stripping prosody/disfluency
 *    concerns — we don't need word counts or filled-pause detection here).
 *  - Tutor chunks are ignored.
 *  - An empty LearnerUtteranceCapture returns '' (fails closed).
 */
describe('LearnerUtteranceCapture', () => {
  it('returns empty string before any chunk is ingested', () => {
    const capture = new LearnerUtteranceCapture();
    expect(capture.transcript()).toBe('');
  });

  it('captures the latest learner transcript text', () => {
    const capture = new LearnerUtteranceCapture();
    capture.ingest({ role: 'learner', text: 'what is AND?', at: 1, final: false });
    capture.ingest({ role: 'learner', text: 'what is AND exactly?', at: 2, final: true });
    expect(capture.transcript()).toBe('what is AND exactly?');
  });

  it('tutor-role chunks are ignored', () => {
    const capture = new LearnerUtteranceCapture();
    capture.ingest({ role: 'tutor', text: 'Great question!', at: 1, final: true });
    expect(capture.transcript()).toBe('');
  });

  it('ignores mixed chunks and keeps only learner text', () => {
    const capture = new LearnerUtteranceCapture();
    capture.ingest({ role: 'learner', text: 'can you explain', at: 1, final: false });
    capture.ingest({ role: 'tutor', text: 'Sure...', at: 2, final: false });
    capture.ingest({ role: 'learner', text: 'can you explain boolean logic?', at: 3, final: true });
    expect(capture.transcript()).toBe('can you explain boolean logic?');
  });

  it('subsequent learner chunks overwrite the stored text (latest wins)', () => {
    const capture = new LearnerUtteranceCapture();
    capture.ingest({ role: 'learner', text: 'first partial', at: 1, final: false });
    capture.ingest({ role: 'learner', text: 'first partial updated', at: 2, final: false });
    capture.ingest({ role: 'learner', text: 'final complete question?', at: 3, final: true });
    expect(capture.transcript()).toBe('final complete question?');
  });
});
