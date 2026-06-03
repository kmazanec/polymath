import { describe, expect, it } from 'vitest';
import type { AgentInput } from './client.js';
import { openingMove } from './introAdvance.js';
import { loadLesson } from '../lessons/loader.js';

/**
 * REPRO (idle-reconnect intro auto-advance): a learner loads the lesson INTRO,
 * takes NO action, and a truth-table PRACTICE item appears on its own (phase →
 * PRACTICING). Root cause: `AgentSocket` re-sends `session_start` on EVERY
 * WebSocket reconnect (no user gesture), and `session_start` was wired as an
 * opening-walk ADVANCE trigger — each reconnect walked the intro one stage
 * forward (AND → Truth tables → WorkedExample → first practice item).
 *
 * Invariant under test: `session_start` is IDEMPOTENT. A re-announce (reconnect)
 * re-mounts the CURRENT opening stage; it NEVER advances. Only the learner's
 * "Continue" (`intro_advance`) advances the walk. The stage is the server's
 * uncapped `openingWalkMounts` count of cards ALREADY shown, so a re-announce
 * re-mounts card `openingWalkMounts - 1`, not `openingWalkMounts`.
 */

const lesson = loadLesson(1);

function input(eventKind: 'session_start' | 'intro_advance', openingWalkMounts: number): AgentInput {
  return {
    event: { kind: eventKind, sessionId: '00000000-0000-0000-0000-000000000000' } as AgentInput['event'],
    lesson,
    learnerState: {
      bktByKc: {},
      hintsUsed: 0,
      consecutiveCorrect: 0,
      ruleGatePassed: false,
      explainBackPassed: false,
      topicGuardrailClean: true,
    },
    recentHistory: [],
    openingWalkMounts,
  };
}

// Lesson 1 opening walk: openingExplanations = [AND, Truth tables] (2 cards),
// then the WorkedExample, then the first practice item.
//   stage/openingWalkMounts 0 → IntroExplanation (AND)
//   stage 1 → IntroExplanation (Truth tables)
//   stage 2 → WorkedExample
//   stage 3 → first practice item

describe('session_start is idempotent across reconnects (idle intro auto-advance bug)', () => {
  it('a re-announced session_start re-mounts the CURRENT stage, never advances', () => {
    // First real session_start: nothing shown yet → mount card 0 (AND).
    expect(openingMove(input('session_start', 0)).move).toBe('intro_explanation');

    // Reconnect after the AND card was shown (count=1). A session_start re-announce
    // must RE-MOUNT the AND card, NOT advance to "Truth tables".
    const reAnnounceAfterAnd = openingMove(input('session_start', 1));
    expect(reAnnounceAfterAnd.move).toBe('intro_explanation');
    expect(reAnnounceAfterAnd.move === 'intro_explanation' && reAnnounceAfterAnd.topic).toBe('AND');

    // Reconnect after AND + Truth tables (count=2): re-mount Truth tables, NOT the WorkedExample.
    const reAnnounceAfterTables = openingMove(input('session_start', 2));
    expect(reAnnounceAfterTables.move).toBe('intro_explanation');
    expect(
      reAnnounceAfterTables.move === 'intro_explanation' && reAnnounceAfterTables.topic,
    ).toBe('Truth tables');

    // Reconnect after AND + Truth tables + WorkedExample (count=3): re-mount the
    // WorkedExample, NOT the first practice item. THIS is the exact symptom: a bare
    // reconnect must never flip the learner into a practice item / PRACTICING.
    expect(openingMove(input('session_start', 3)).move).toBe('worked_example');
  });

  it('intro_advance (the learner clicked Continue) STILL advances the walk', () => {
    // The fix must not break the legitimate path: Continue advances by one stage.
    expect(openingMove(input('intro_advance', 0)).move).toBe('intro_explanation');
    expect(openingMove(input('intro_advance', 1)).move).toBe('intro_explanation');
    expect(openingMove(input('intro_advance', 2)).move).toBe('worked_example');
    expect(openingMove(input('intro_advance', 3)).move).toBe('next_practice_item');
  });
});
