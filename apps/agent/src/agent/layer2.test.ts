import { describe, expect, it } from 'vitest';
import type { Action } from '@polymath/contract';
import { validateLayer2 } from './layer2.js';
import { loadFallbackBank } from '../fallback_bank/index.js';
import { compileMove } from './menu.js';

function mountItem(kind: string, expression: string, claimed: (0 | 1)[]): Action {
  const base =
    kind === 'TruthTablePractice'
      ? { kind, expression, claimedTruthTable: claimed, visibleReps: ['truth_table'] }
      : kind === 'CircuitBuilder'
        ? { kind, targetExpression: expression, claimedTruthTable: claimed, allowedGates: ['AND', 'OR', 'NOT'], visibleReps: ['circuit'] }
        : { kind, targetExpression: expression, claimedTruthTable: claimed, visibleReps: ['pseudocode'] };
  return { type: 'mount', component: base as Action extends { component: infer C } ? C : never, rationale: 'test' } as Action;
}

describe('validateLayer2', () => {
  it('passes a correct claimedTruthTable for each item-generating kind', () => {
    expect(validateLayer2(mountItem('TruthTablePractice', 'A AND B', [0, 0, 0, 1])).ok).toBe(true);
    expect(validateLayer2(mountItem('CircuitBuilder', 'A OR B', [0, 1, 1, 1])).ok).toBe(true);
    expect(validateLayer2(mountItem('PseudocodeChallenge', 'NOT A', [1, 0])).ok).toBe(true);
  });

  it('rejects a wrong claimedTruthTable with an explanatory detail', () => {
    const r = validateLayer2(mountItem('TruthTablePractice', 'A AND B', [0, 0, 0, 0]));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.detail).toMatch(/disagrees/);
  });

  it('rejects an unparseable targetExpression', () => {
    const r = validateLayer2(mountItem('CircuitBuilder', 'A AND', [0, 0]));
    expect(r.ok).toBe(false);
  });

  it('passes non-item Actions trivially (transition / answer_question / no_action)', () => {
    expect(validateLayer2({ type: 'transition', to: 'mastered', rationale: 'r' }).ok).toBe(true);
    expect(
      validateLayer2({ type: 'answer_question', question: 'q', answer: 'a', topicClassification: 'on_topic', rationale: 'r' }).ok,
    ).toBe(true);
    expect(validateLayer2({ type: 'no_action', reason: 'thinking', rationale: 'r' }).ok).toBe(true);
  });

  it('passes a non-item mount (HintCard) trivially', () => {
    expect(validateLayer2({ type: 'mount', component: { kind: 'HintCard', level: 1, body: 'hi' }, rationale: 'r' }).ok).toBe(true);
  });

  it('every fallback-bank item passes Layer 2 (the bank is the answer-key of last resort)', () => {
    // F-13: both L1 and L2 banks must hold — every claimedTruthTable agrees with
    // the validator (XOR ships as a composition, never the bare keyword).
    for (const lessonId of [1, 2]) {
      const bank = loadFallbackBank(lessonId);
      expect(bank.length, `lesson ${lessonId} fallback bank is empty`).toBeGreaterThan(0);
      for (const item of bank) {
        expect(item.targetExpression).not.toMatch(/\bXOR\b/);
        const action = compileMove({
          move: 'next_practice_item',
          tier: item.tier,
          rationale: 'fallback',
          item: { rep: 'truth_table', targetExpression: item.targetExpression, claimedTruthTable: item.claimedTruthTable, visibleReps: ['truth_table'] },
        });
        const r = validateLayer2(action);
        expect(r.ok, `L${lessonId.toString()} fallback item ${item.itemId} (${item.targetExpression}) failed Layer 2`).toBe(true);
      }
    }
  });
});
