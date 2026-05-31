import { describe, expect, it } from 'vitest';
import { LearnerUtteranceRegistry } from './learnerUtteranceRegistry.js';

/**
 * F-30 (checklist item 3): unit tests for the session-keyed utterance registry.
 *
 * The registry is the server-side seam that makes `latestLearnerUtteranceFor(sessionId)`
 * work. It is sessionId-only (no targetItemId) — a simpler key than the
 * ExplainBackCaptureRegistry which uses (session, item).
 *
 * Invariants:
 *  - Unknown session → undefined (fails closed, not empty string).
 *  - Empty string → undefined (also fails closed — must not answer an unspoken question).
 *  - No cross-session leak.
 */
describe('LearnerUtteranceRegistry', () => {
  it('unknown session → undefined', () => {
    const registry = new LearnerUtteranceRegistry();
    expect(registry.latestFor('unknown-session-id')).toBeUndefined();
  });

  it('stores and retrieves the latest utterance for a session', () => {
    const registry = new LearnerUtteranceRegistry();
    registry.setLatest('session-a', 'what is NAND?');
    expect(registry.latestFor('session-a')).toBe('what is NAND?');
  });

  it('overwrites the previous utterance with the newest one', () => {
    const registry = new LearnerUtteranceRegistry();
    registry.setLatest('session-a', 'first question');
    registry.setLatest('session-a', 'updated question');
    expect(registry.latestFor('session-a')).toBe('updated question');
  });

  it('empty string → undefined (fails closed)', () => {
    const registry = new LearnerUtteranceRegistry();
    registry.setLatest('session-a', '');
    expect(registry.latestFor('session-a')).toBeUndefined();
  });

  it('whitespace-only string → undefined (fails closed)', () => {
    const registry = new LearnerUtteranceRegistry();
    registry.setLatest('session-a', '   ');
    expect(registry.latestFor('session-a')).toBeUndefined();
  });

  it('no cross-session leak: session A cannot read session B utterance', () => {
    const registry = new LearnerUtteranceRegistry();
    registry.setLatest('session-a', 'question from A');
    expect(registry.latestFor('session-b')).toBeUndefined();
  });

  it('multiple sessions are independent', () => {
    const registry = new LearnerUtteranceRegistry();
    registry.setLatest('session-a', 'question A');
    registry.setLatest('session-b', 'question B');
    expect(registry.latestFor('session-a')).toBe('question A');
    expect(registry.latestFor('session-b')).toBe('question B');
  });
});
