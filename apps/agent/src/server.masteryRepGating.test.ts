import { describe, expect, it } from 'vitest';
import type { AgentInput, TurnSummary } from './agent/client.js';
import { loadLesson } from './lessons/loader.js';
import {
  authoredHintAction,
  deterministicAuthoredPhaseAction,
  forwardProgressFallbackAction,
} from './server.js';
import type { Rep } from '@polymath/contract';

const SESSION_ID = '33333333-3333-3333-3333-333333333333';

const baseSnapshot = {
  bktByKc: {},
  hintsUsed: 0,
  consecutiveCorrect: 0,
  ruleGatePassed: false,
  explainBackPassed: false,
  topicGuardrailClean: true,
};

function mountTurn(componentKind: string, expression: string): TurnSummary {
  return {
    eventKind: 'submit',
    actionType: 'mount',
    rationale: 'prior mount',
    componentKind,
    expression,
  };
}

function submitInput(
  lessonId: number,
  itemId: string,
  rep: Rep,
  opts: {
    recentHistory?: TurnSummary[];
    passedItemIds?: Set<string>;
    correct?: boolean;
    hintsByItem?: Record<string, number>;
  } = {},
): AgentInput {
  const lesson = loadLesson(lessonId);
  const repSubmission =
    rep === 'truth_table'
      ? { rep, cells: [0, 0, 0, 1] as (0 | 1)[] }
      : rep === 'circuit'
        ? { rep, expression: itemId, nodes: [], edges: [] }
        : { rep, expression: itemId, source: itemId };
  return {
    event: { kind: 'submit', sessionId: SESSION_ID, itemId, submission: itemId, repSubmission, correct: opts.correct ?? true, responseTimeMs: 5000 },
    lesson,
    learnerState: baseSnapshot,
    recentHistory: opts.recentHistory ?? [],
    passedItemIds: opts.passedItemIds,
    currentSubmitCorrect: opts.correct ?? true,
    hintsByItem: opts.hintsByItem,
  };
}

const mountRep = (action: ReturnType<typeof forwardProgressFallbackAction>): Rep | undefined => {
  if (action?.type !== 'mount') return undefined;
  switch (action.component.kind) {
    case 'TruthTablePractice':
      return 'truth_table';
    case 'CircuitBuilder':
      return 'circuit';
    case 'PseudocodeChallenge':
      return 'pseudocode';
    default:
      return undefined;
  }
};

const mountExpr = (action: ReturnType<typeof forwardProgressFallbackAction>): string | undefined => {
  if (action?.type !== 'mount') return undefined;
  const c = action.component;
  if (c.kind === 'TruthTablePractice') return c.expression;
  if (c.kind === 'CircuitBuilder' || c.kind === 'PseudocodeChallenge') return c.targetExpression;
  return undefined;
};

describe('#3/#8 interleaved forward-progress ladder', () => {
  it('never re-mounts the identical (item, rep) as the previous practice mount (single hardest item → rotate rep)', () => {
    // L1: all items tier 1; the previous mount was l1-and in truth_table. The ladder
    // step must rotate the rep (truth_table → circuit) for the same item rather than
    // re-mount the identical (item, rep).
    const allPassed = new Set(['l1-and', 'l1-or', 'l1-not', 'l1-review-mix']);
    const input = submitInput(1, 'l1-and', 'truth_table', {
      recentHistory: [mountTurn('TruthTablePractice', 'B AND A')],
      passedItemIds: allPassed,
    });
    const action = forwardProgressFallbackAction(input, false);
    expect(action?.type).toBe('mount');
    // It must NOT be the identical (B AND A, truth_table).
    const sameItemSameRep = mountExpr(action) === 'B AND A' && mountRep(action) === 'truth_table';
    expect(sameItemSameRep).toBe(false);
    // The rep rotated off truth_table.
    expect(mountRep(action)).not.toBe('truth_table');
  });

  it('rotates across hardest-tier ITEMS when the lesson has ≥2 (L2)', () => {
    const lesson = loadLesson(2);
    const items = lesson.content.items;
    const maxTier = Math.max(...items.map((i) => i.difficultyTier));
    const hardest = items.filter((i) => i.difficultyTier === maxTier);
    expect(hardest.length).toBeGreaterThanOrEqual(2); // lessons 2–4 have ≥3 hardest items
    const allPassed = new Set(items.map((i) => i.itemId));
    const prevHardest = hardest[0]!;
    const input = submitInput(2, prevHardest.itemId, 'truth_table', {
      recentHistory: [mountTurn('TruthTablePractice', prevHardest.targetExpression)],
      passedItemIds: allPassed,
    });
    const action = forwardProgressFallbackAction(input, false);
    expect(action?.type).toBe('mount');
    // A DIFFERENT hardest-tier item than the one just shown.
    expect(mountExpr(action)).not.toBe(prevHardest.targetExpression);
    // And the rep rotated off the previous truth_table.
    expect(mountRep(action)).not.toBe('truth_table');
  });

  it('returns null (lets the mastery celebration own the turn) when FULL mastery is satisfied', () => {
    const input = submitInput(1, 'l1-and', 'truth_table', { passedItemIds: new Set(['l1-and']) });
    expect(forwardProgressFallbackAction(input, true)).toBeNull();
  });

  it('keeps the learner in interleaved practice when the rule gate passed but FULL mastery is NOT yet reached (the I1 dead-end fix)', () => {
    // The stuck-session scenario: every authored item passed, the rule gate is cleared,
    // but mastery is unreachable this turn (no transfer item / explain-back deferred).
    // `fullMasterySatisfied` is FALSE → the fallback must hand back a practice mount,
    // never null (which would let the caller fall through to a silent no_action).
    const allPassed = new Set(['l1-and', 'l1-or', 'l1-not', 'l1-review-mix']);
    const input = submitInput(1, 'l1-not', 'pseudocode', {
      recentHistory: [mountTurn('PseudocodeChallenge', 'NOT A')],
      passedItemIds: allPassed,
    });
    const action = forwardProgressFallbackAction(input, false);
    expect(action?.type).toBe('mount'); // NOT null, NOT no_action — the learner can act.
  });
});

describe('#4 L3 NAND-construction items are mounted in the CIRCUIT rep', () => {
  it('starts l3-nand-basic in circuit even when the learner requests truth_table', () => {
    const lesson = loadLesson(3);
    const action = deterministicAuthoredPhaseAction({
      event: { kind: 'session_start', sessionId: SESSION_ID, lessonId: 3, startRep: 'truth_table' },
      lesson,
      learnerState: baseSnapshot,
      recentHistory: [],
    });
    expect(action?.type).toBe('mount');
    if (action?.type === 'mount') {
      expect(action.component.kind).toBe('CircuitBuilder');
      if (action.component.kind === 'CircuitBuilder') {
        expect(action.component.allowedGates).toEqual(['NAND']);
        expect(action.component.targetExpression).toBe('A NAND B');
      }
    }
  });

  it('a forward-progress re-mount of a NAND-construction item forces circuit+NAND', () => {
    // Only NAND-construction items unfinished → step (2) mounts the next one in circuit.
    const lesson = loadLesson(3);
    const passed = new Set(
      lesson.content.items.filter((i) => i.itemId !== 'l3-and-from-nand').map((i) => i.itemId),
    );
    const input = submitInput(3, 'l3-nand-basic', 'pseudocode', {
      recentHistory: [mountTurn('PseudocodeChallenge', 'A NAND B')],
      passedItemIds: passed,
    });
    const action = forwardProgressFallbackAction(input, false);
    expect(action?.type).toBe('mount');
    if (action?.type === 'mount') {
      expect(action.component.kind).toBe('CircuitBuilder');
      if (action.component.kind === 'CircuitBuilder') {
        expect(action.component.allowedGates).toEqual(['NAND']);
        expect(action.component.targetExpression).toBe('A AND B'); // l3-and-from-nand
      }
    }
  });
});

describe('#7 genuine hint fading', () => {
  function hintInput(
    lessonId: number,
    itemId: string,
    hintsByItem: Record<string, number>,
    recentHistory: TurnSummary[] = [],
  ): AgentInput {
    return {
      event: { kind: 'request_hint', sessionId: SESSION_ID, itemId },
      lesson: loadLesson(lessonId),
      learnerState: baseSnapshot,
      recentHistory,
      hintsByItem,
    };
  }

  const itemOf = (lessonId: number, itemId: string) =>
    loadLesson(lessonId).content.items.find((i) => i.itemId === itemId)!;

  it('L1 is a strategy cue (truth_table: row-by-row, no answer content)', () => {
    const action = authoredHintAction(hintInput(1, 'l1-and', {}), itemOf(1, 'l1-and'));
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'HintCard') {
      expect(action.component.level).toBe(1);
      expect(action.component.body.toLowerCase()).toContain('row by row');
    }
  });

  it('L2 routes to the item NAMED MISCONCEPTION when one exists', () => {
    const action = authoredHintAction(hintInput(1, 'l1-and', { 'l1-and': 1 }), itemOf(1, 'l1-and'));
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'HintCard') {
      expect(action.component.level).toBe(2);
      // l1-and's named misconception text ("That looks like an OR table, not AND.")
      expect(action.component.body).toContain('OR table');
    }
  });

  it('L2 works a CONCRETE server-computed row when no misconception entry exists (truth_table)', () => {
    // l2-a-or-bc has NO misconception entry → the concrete-row path.
    const action = authoredHintAction(hintInput(2, 'l2-a-or-bc', { 'l2-a-or-bc': 1 }), itemOf(2, 'l2-a-or-bc'));
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'HintCard') {
      expect(action.component.level).toBe(2);
      // Names a concrete row + the computed output of THIS expression.
      expect(action.component.body).toContain('Work one row');
      expect(action.component.body).toMatch(/the output of .* is [01]/);
    }
  });

  it('L2 gives a CIRCUIT-analogous partial when the learner is in the circuit rep', () => {
    const action = authoredHintAction(
      hintInput(2, 'l2-a-or-bc', { 'l2-a-or-bc': 1 }, [mountTurn('CircuitBuilder', 'A OR (B AND C)')]),
      itemOf(2, 'l2-a-or-bc'),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'HintCard') {
      expect(action.component.body.toLowerCase()).toContain('gate');
      expect(action.component.body.toLowerCase()).not.toContain('row');
    }
  });

  it('L3 is a near-complete completion scaffold naming the count of 1-rows (truth_table)', () => {
    const action = authoredHintAction(hintInput(1, 'l1-and', { 'l1-and': 2 }), itemOf(1, 'l1-and'));
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'HintCard') {
      expect(action.component.level).toBe(3);
      expect(action.component.body).toMatch(/row\(s\) that output 1/);
    }
  });

  it('hint LEVEL is server-derived from hintsByItem and caps at 3', () => {
    const action = authoredHintAction(hintInput(1, 'l1-and', { 'l1-and': 9 }), itemOf(1, 'l1-and'));
    if (action.type === 'mount' && action.component.kind === 'HintCard') {
      expect(action.component.level).toBe(3);
    }
  });
});
