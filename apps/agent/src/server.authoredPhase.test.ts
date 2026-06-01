import { describe, expect, it } from 'vitest';
import type { AgentInput } from './agent/client.js';
import { loadLesson } from './lessons/loader.js';
import { deterministicAuthoredPhaseAction } from './server.js';

const SESSION_ID = '22222222-2222-2222-2222-222222222222';

function inputForSubmit(
  itemId: string,
  correct: boolean,
  cells: (0 | 1)[],
  priorMissesByItem: Record<string, number> = {},
): AgentInput {
  return {
    event: {
      kind: 'submit',
      sessionId: SESSION_ID,
      itemId,
      submission: itemId,
      repSubmission: { rep: 'truth_table', cells },
      correct,
      responseTimeMs: 5000,
    },
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
    priorMissesByItem,
    currentSubmitCorrect: correct,
  };
}

function inputForHint(itemId: string, hintsByItem: Record<string, number> = {}): AgentInput {
  return {
    event: {
      kind: 'request_hint',
      sessionId: SESSION_ID,
      itemId,
    },
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
    hintsByItem,
  };
}

function inputForShortcut(startRep: 'truth_table' | 'circuit' | 'pseudocode'): AgentInput {
  return {
    event: {
      kind: 'session_start',
      sessionId: SESSION_ID,
      lessonId: 1,
      startRep,
    },
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
  };
}

describe('deterministic authored lesson phase', () => {
  it('remounts the same authored item after a wrong answer before any LLM move', () => {
    const action = deterministicAuthoredPhaseAction(inputForSubmit('l1-and', false, [0, 1, 0, 0]));

    expect(action?.type).toBe('mount');
    if (action?.type === 'mount') {
      expect(action.component.kind).toBe('TruthTablePractice');
      if (action.component.kind === 'TruthTablePractice') {
        expect(action.component.expression).toBe('B AND A');
        expect(action.component.visibleReps).toContain('truth_table');
      }
    }
  });

  it('teaches OR after the authored AND item is answered correctly', () => {
    const action = deterministicAuthoredPhaseAction(inputForSubmit('l1-and', true, [0, 0, 0, 1]));

    expect(action?.type).toBe('mount');
    if (action?.type === 'mount') {
      expect(action.component.kind).toBe('IntroExplanation');
      if (action.component.kind === 'IntroExplanation') {
        expect(action.component.topic).toBe('OR');
      }
    }
  });

  it('owns the INTERLEAVED continued-practice ladder after the last per-KC item (#3) instead of releasing to the rep-blind stub', () => {
    // After the last first-per-KC item (l1-not), there is no next KC to teach. Previously
    // the deterministic phase returned null and the rep-blind stub mounted continued
    // practice in one rep — which would make the new ≥2-rep gate (#1) unreachable. Now the
    // deterministic phase OWNS the interleaved forward-progress ladder: it mounts the next
    // not-yet-passed authored item (here l1-and, the first unfinished one) as a practice
    // surface so continued practice can rotate reps on the trusted path.
    const action = deterministicAuthoredPhaseAction(inputForSubmit('l1-not', true, [1, 0]));

    expect(action?.type).toBe('mount');
    if (action?.type === 'mount') {
      expect(
        ['TruthTablePractice', 'CircuitBuilder', 'PseudocodeChallenge'].includes(action.component.kind),
      ).toBe(true);
    }
  });

  it('serves authored-phase hints without asking the LLM to advance curriculum (#7: L2 routes to the item misconception)', () => {
    const action = deterministicAuthoredPhaseAction(inputForHint('l1-or', { 'l1-or': 1 }));

    expect(action?.type).toBe('mount');
    if (action?.type === 'mount') {
      expect(action.component.kind).toBe('HintCard');
      if (action.component.kind === 'HintCard') {
        expect(action.component.level).toBe(2);
        // #7: L2 routes to l1-or's named misconception (the exclusive-or confusion),
        // not a generic paraphrase.
        expect(action.component.body).toContain('exclusive-or');
      }
    }
  });

  it('starts at the requested representation when a lesson shortcut is present', () => {
    const action = deterministicAuthoredPhaseAction(inputForShortcut('circuit'));

    expect(action?.type).toBe('mount');
    if (action?.type === 'mount') {
      expect(action.component.kind).toBe('CircuitBuilder');
      if (action.component.kind === 'CircuitBuilder') {
        expect(action.component.targetExpression).toBe('B AND A');
        expect(action.component.visibleReps).toEqual(['circuit']);
      }
    }
  });
});
