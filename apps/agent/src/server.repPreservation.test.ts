/**
 * R2-3 — the learner's chosen representation must persist across the authored
 * per-KC walk. A learner who starts a lesson in `?rep=pseudocode` / `?rep=circuit`
 * ("Skip to code", etc.) gets the FIRST item in that rep (already covered in
 * server.authoredPhase.test.ts), but the BUG was that every SUBSEQUENT authored
 * item snapped back to `truth_table` — the `authoredPracticeAction` default — so
 * the OR item after a correct code AND mounted as a truth table.
 *
 * There are two server seams that hand the learner a next authored item:
 *  1. `deterministicAuthoredPhaseAction` direct correct-submit branch — mounts the
 *     NEXT per-KC item itself (only when no just-in-time explanation intervenes).
 *  2. `practiceAfterLatestExplanation` — for lesson 1, the next KC has an authored
 *     concept card, so the item arrives AFTER the explanation, on an
 *     `intro_advance` turn that carries no `repSubmission`. The active rep is then
 *     recovered from the most recent item-bearing mount's `componentKind` in
 *     `recentHistory`.
 * Both must preserve the learner's rep; this file proves each.
 */
import { describe, expect, it } from 'vitest';
import type { AgentInput, TurnSummary } from './agent/client.js';
import { practiceAfterLatestExplanation } from './agent/introAdvance.js';
import { loadLesson } from './lessons/loader.js';
import { deterministicAuthoredPhaseAction } from './server.js';

const SESSION_ID = '33333333-3333-3333-3333-333333333333';

type Rep = 'truth_table' | 'circuit' | 'pseudocode';

function baseInput(overrides: Partial<AgentInput>): AgentInput {
  return {
    event: { kind: 'session_start', sessionId: SESSION_ID, lessonId: 1 },
    lesson: loadLesson(1),
    learnerState: {
      bktByKc: {},
      hintsUsed: 0,
      consecutiveCorrect: 0,
      ruleGatePassed: false,
      explainBackPassed: false,
      topicGuardrailClean: true,
    },
    recentHistory: [],
    ...overrides,
  };
}

function correctSubmit(itemId: string, rep: Rep, cells: (0 | 1)[]): AgentInput['event'] {
  return {
    kind: 'submit',
    sessionId: SESSION_ID,
    itemId,
    submission: itemId,
    repSubmission: { rep, cells },
    correct: true,
    responseTimeMs: 5000,
  };
}

/** A prior item-bearing mount turn, so `practiceAfterLatestExplanation` /
 *  `activeRepFromHistory` can recover the rep the learner is working in. */
function itemMountTurn(componentKind: string): TurnSummary {
  return {
    eventKind: 'submit',
    actionType: 'mount',
    rationale: 'prior practice item',
    componentKind,
  };
}

function introMountTurn(topic: string): TurnSummary {
  return {
    eventKind: 'intro_advance',
    actionType: 'mount',
    rationale: 'taught concept',
    componentKind: 'IntroExplanation',
    topic,
  };
}

describe('R2-3 rep preservation across the authored walk', () => {
  // --- Path 2: explanation -> next-KC item (the exact user-reported path) -----
  // Lesson 1: correct AND (in pseudocode) -> OR explanation -> OR item. The OR
  // item must come up as a PseudocodeChallenge, not a TruthTablePractice.
  it('mounts the post-explanation OR item in pseudocode when the learner worked the prior item in pseudocode', () => {
    const input = baseInput({
      event: { kind: 'intro_advance', sessionId: SESSION_ID },
      recentHistory: [itemMountTurn('PseudocodeChallenge'), introMountTurn('OR')],
    });

    const move = practiceAfterLatestExplanation(input);
    expect(move?.move).toBe('next_practice_item');
    if (move?.move === 'next_practice_item') {
      expect(move.item.rep).toBe('pseudocode');
      expect(move.item.visibleReps).toEqual(['pseudocode']);
      expect(move.item.targetExpression).toBe('A OR B');
    }
  });

  it('mounts the post-explanation OR item in circuit when the learner worked the prior item in circuit', () => {
    const input = baseInput({
      event: { kind: 'intro_advance', sessionId: SESSION_ID },
      recentHistory: [itemMountTurn('CircuitBuilder'), introMountTurn('OR')],
    });

    const move = practiceAfterLatestExplanation(input);
    expect(move?.move).toBe('next_practice_item');
    if (move?.move === 'next_practice_item') {
      expect(move.item.rep).toBe('circuit');
      expect(move.item.visibleReps).toEqual(['circuit']);
    }
  });

  it('defaults the post-explanation item to truth_table when no prior item rep is in history', () => {
    const input = baseInput({
      event: { kind: 'intro_advance', sessionId: SESSION_ID },
      recentHistory: [introMountTurn('OR')],
    });

    const move = practiceAfterLatestExplanation(input);
    expect(move?.move).toBe('next_practice_item');
    if (move?.move === 'next_practice_item') {
      expect(move.item.rep).toBe('truth_table');
    }
  });

  // --- Path 1: direct correct-submit -> next per-KC item ----------------------
  // Force the direct branch by marking the next KC (OR) as already practiced in
  // history, so the just-in-time explanation is suppressed and
  // deterministicAuthoredPhaseAction mounts the next item itself. It must honor
  // the submit's rep.
  it('threads pseudocode into the next per-KC item on a direct correct submit', () => {
    const input = baseInput({
      event: correctSubmit('l1-and', 'pseudocode', [0, 0, 0, 1]),
      currentSubmitCorrect: true,
      recentHistory: [
        { eventKind: 'submit', actionType: 'mount', rationale: 'or practiced', itemId: 'l1-or' },
      ],
    });

    const action = deterministicAuthoredPhaseAction(input);
    expect(action?.type).toBe('mount');
    if (action?.type === 'mount') {
      expect(action.component.kind).toBe('PseudocodeChallenge');
      if (action.component.kind === 'PseudocodeChallenge') {
        expect(action.component.targetExpression).toBe('A OR B');
        expect(action.component.visibleReps).toEqual(['pseudocode']);
      }
    }
  });

  it('threads circuit into the next per-KC item on a direct correct submit', () => {
    const input = baseInput({
      event: correctSubmit('l1-and', 'circuit', [0, 0, 0, 1]),
      currentSubmitCorrect: true,
      recentHistory: [
        { eventKind: 'submit', actionType: 'mount', rationale: 'or practiced', itemId: 'l1-or' },
      ],
    });

    const action = deterministicAuthoredPhaseAction(input);
    expect(action?.type).toBe('mount');
    if (action?.type === 'mount') {
      expect(action.component.kind).toBe('CircuitBuilder');
      if (action.component.kind === 'CircuitBuilder') {
        expect(action.component.targetExpression).toBe('A OR B');
        expect(action.component.visibleReps).toEqual(['circuit']);
      }
    }
  });
});
