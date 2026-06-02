import { describe, expect, it } from 'vitest';
import type { AgentInput } from './client.js';
import type { TurnSummary } from '@polymath/contract';
import { openingMove } from './introAdvance.js';
import { loadLesson } from '../lessons/loader.js';

const lesson = loadLesson(1);

function input(
  recentHistory: TurnSummary[],
  openingWalkMounts?: number,
): AgentInput {
  return {
    event: { kind: 'intro_advance', sessionId: '00000000-0000-0000-0000-000000000000' } as AgentInput['event'],
    lesson,
    learnerState: {
      bktByKc: {},
      hintsUsed: 0,
      consecutiveCorrect: 0,
      ruleGatePassed: false,
      explainBackPassed: false,
      topicGuardrailClean: true,
    },
    recentHistory,
    ...(openingWalkMounts !== undefined ? { openingWalkMounts } : {}),
  };
}

function mount(componentKind: string): TurnSummary {
  return { eventKind: 'intro_advance', actionType: 'mount', rationale: '', componentKind } as TurnSummary;
}
function nonMount(eventKind: string): TurnSummary {
  return { eventKind, actionType: 'unknown', rationale: '' } as TurnSummary;
}

// The capped 5-event window observed in prod (session 8e35fb4c): the AND +
// Truth-tables IntroExplanation mounts have scrolled OUT; only WorkedExample
// mounts + intelligibility responses remain. Lesson 1 opening walk = 3 mounts
// (AND, Truth tables, WorkedExample) before the first practice item.
const cappedWindow: TurnSummary[] = [
  nonMount('intelligibility_response'),
  mount('WorkedExample'),
  nonMount('intelligibility_response'),
  mount('WorkedExample'),
  nonMount('intelligibility_response'),
];

describe('opening walk stage derivation (BUG-02)', () => {
  it('BUG REPRO: deriving stage from the capped window re-mounts the WorkedExample (the trap)', () => {
    // Without the server-supplied uncapped count, the window count (2) === the
    // opening explanations length (2) → stuck re-mounting the worked example.
    const move = openingMove(input(cappedWindow));
    expect(move.move).toBe('worked_example');
  });

  it('FIX: with the uncapped opening-walk mount count, the walk advances to the first practice item', () => {
    // The server's uncapped count knows 3 opening-walk cards (AND, Truth tables,
    // WorkedExample) have already been shown → next is the first practice item,
    // regardless of what scrolled out of the capped window.
    const move = openingMove(input(cappedWindow, 3));
    expect(move.move).toBe('next_practice_item');
  });

  it('FIX: stage 0/1/2 still walk explanations → worked example in order via the uncapped count', () => {
    expect(openingMove(input([], 0)).move).toBe('intro_explanation');
    expect(openingMove(input([], 1)).move).toBe('intro_explanation');
    expect(openingMove(input([], 2)).move).toBe('worked_example');
    expect(openingMove(input([], 3)).move).toBe('next_practice_item');
  });
});
