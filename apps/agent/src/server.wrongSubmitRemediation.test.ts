import { describe, expect, it } from 'vitest';
import type { ClientEvent } from '@polymath/contract';
import { loadLesson } from './lessons/loader.js';
import { wrongSubmitRemediationAction } from './server.js';

const SESSION_ID = '33333333-3333-3333-3333-333333333333';

/** Build a `submit` frame for a NON-authored (LLM-generated continued-practice) item.
 *  The client sets `itemId` = the mounted spec's expression, so for a generated item the
 *  itemId IS the Boolean expression — and it is NOT one of lesson 1's authored content.items. */
function nonAuthoredWrongSubmit(
  expression: string,
  rep: 'truth_table' | 'circuit' | 'pseudocode',
): ClientEvent {
  return {
    kind: 'submit',
    sessionId: SESSION_ID,
    itemId: expression,
    submission: expression,
    repSubmission:
      rep === 'truth_table'
        ? { rep: 'truth_table', cells: [1, 1, 1, 1] }
        : rep === 'circuit'
          ? { rep: 'circuit', expression, nodes: [], edges: [] }
          : { rep: 'pseudocode', expression, source: 'x' },
    correct: false,
    responseTimeMs: 5000,
  };
}

describe('R2-2 wrong-submit remediation on a NON-authored item', () => {
  it('re-mounts an editable truth_table practice with a SERVER-recomputed claimedTruthTable (not no_action)', () => {
    // "A AND B" is NOT one of lesson 1's authored items (those are l1-and "B AND A",
    // l1-or, l1-not, l1-review-mix). Before the fix, the lookup missed and returned null
    // → the turn dead-ended at no_action. Now it must re-mount the same expression editable.
    const action = wrongSubmitRemediationAction(
      nonAuthoredWrongSubmit('A AND B', 'truth_table'),
      loadLesson(1),
      {},
    );

    expect(action).not.toBeNull();
    expect(action?.type).toBe('mount');
    if (action?.type === 'mount') {
      expect(action.component.kind).toBe('TruthTablePractice');
      if (action.component.kind === 'TruthTablePractice') {
        expect(action.component.expression).toBe('A AND B');
        // Server-recomputed via @polymath/booleans, NOT a client-supplied answer key.
        expect(action.component.claimedTruthTable).toEqual([0, 0, 0, 1]);
        // Honors visibleReps so the surface actually renders the learner's rep.
        expect(action.component.visibleReps).toContain('truth_table');
      }
    }
  });

  it('honors the submitted rep (pseudocode) for a non-authored item', () => {
    const action = wrongSubmitRemediationAction(
      nonAuthoredWrongSubmit('A OR NOT B', 'pseudocode'),
      loadLesson(1),
      {},
    );

    expect(action?.type).toBe('mount');
    if (action?.type === 'mount') {
      expect(action.component.kind).toBe('PseudocodeChallenge');
      if (action.component.kind === 'PseudocodeChallenge') {
        expect(action.component.targetExpression).toBe('A OR NOT B');
        expect(action.component.claimedTruthTable).toEqual([1, 0, 1, 1]);
        expect(action.component.visibleReps).toContain('pseudocode');
        // B11: pseudocode retry guidance must not use truth-table "row by row" language.
        expect(action.component.prompt).not.toContain('row');
      }
    }
  });

  it('still re-mounts authored items (regression — the original B11 path is unchanged)', () => {
    const action = wrongSubmitRemediationAction(
      {
        kind: 'submit',
        sessionId: SESSION_ID,
        itemId: 'l1-and',
        submission: 'B AND A',
        repSubmission: { rep: 'truth_table', cells: [1, 1, 1, 1] },
        correct: false,
        responseTimeMs: 5000,
      },
      loadLesson(1),
      {},
    );

    expect(action?.type).toBe('mount');
    if (action?.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.expression).toBe('B AND A');
    }
  });

  it('fails closed (null) for an over-cap expression rather than enumerating 2^n', () => {
    // 11 distinct variables exceeds MAX_EQUIVALENCE_VARS (10); the recompute must skip, never
    // synchronously enumerate 2^11 rows on the WS turn (CLAUDE.md DoS invariant). Null here
    // lets the wrong-submit forward-progress net leave the turn as-is rather than fabricate.
    const overCap = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J AND K';
    const action = wrongSubmitRemediationAction(
      nonAuthoredWrongSubmit(overCap, 'truth_table'),
      loadLesson(1),
      {},
    );

    expect(action).toBeNull();
  });
});
