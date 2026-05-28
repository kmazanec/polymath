import { describe, expect, it } from 'vitest';
import { Action } from '@polymath/contract';
import { compileMove, type ProposedItem, type TacticalMove } from './menu.js';

const item: ProposedItem = {
  rep: 'truth_table',
  targetExpression: 'A AND B',
  claimedTruthTable: [0, 0, 0, 1],
  visibleReps: ['truth_table'],
};

/** Every compiled move must be a contract-valid wire Action (the menu is internal;
 *  only its compiled output crosses the wire). */
function assertValidAction(move: TacticalMove): ReturnType<typeof Action.parse> {
  const action = compileMove(move);
  return Action.parse(action);
}

describe('compileMove', () => {
  it('next_practice_item → mount of the rep-appropriate item spec', () => {
    const a = assertValidAction({
      move: 'next_practice_item',
      item,
      tier: 1,
      rationale: 'learner ready for the next AND item',
    });
    expect(a.type).toBe('mount');
    if (a.type !== 'mount') throw new Error('unreachable');
    expect(a.component.kind).toBe('TruthTablePractice');
  });

  it('simpler_item and rephrase also mount an item', () => {
    expect(assertValidAction({ move: 'simpler_item', item, rationale: 'two misses' }).type).toBe(
      'mount',
    );
    expect(assertValidAction({ move: 'rephrase', item, rationale: 're-word' }).type).toBe('mount');
  });

  it('alt_representation mounts the item in the requested rep (overriding item.rep)', () => {
    const a = compileMove({ move: 'alt_representation', item, rep: 'circuit', rationale: 'try circuit' });
    expect(a.type).toBe('mount');
    if (a.type !== 'mount') throw new Error('unreachable');
    expect(a.component.kind).toBe('CircuitBuilder');
    if (a.component.kind !== 'CircuitBuilder') throw new Error('unreachable');
    expect(a.component.targetExpression).toBe('A AND B');
    expect(a.component.allowedGates).toEqual(['AND', 'OR', 'NOT']);
    Action.parse(a);
  });

  it('circuit items use targetExpression + default gates; pseudocode uses targetExpression', () => {
    const circuit = compileMove({
      move: 'next_practice_item',
      tier: 2,
      rationale: 'r',
      item: { ...item, rep: 'circuit' },
    });
    expect(circuit.type === 'mount' && circuit.component.kind).toBe('CircuitBuilder');
    const pseudo = compileMove({
      move: 'next_practice_item',
      tier: 2,
      rationale: 'r',
      item: { ...item, rep: 'pseudocode' },
    });
    expect(pseudo.type === 'mount' && pseudo.component.kind).toBe('PseudocodeChallenge');
  });

  it('worked_example → mount of a WorkedExample', () => {
    const a = assertValidAction({
      move: 'worked_example',
      expression: 'A AND B',
      steps: [{ label: 'AND', detail: 'true only when both inputs are true' }],
      visibleReps: ['truth_table', 'circuit'],
      rationale: 'show the pattern',
    });
    expect(a.type).toBe('mount');
    expect(a.type === 'mount' && a.component.kind).toBe('WorkedExample');
  });

  it('answer_question → answer_question with topic classification preserved', () => {
    const on = assertValidAction({
      move: 'answer_question',
      question: 'what does AND mean?',
      answer: 'true only when both inputs are true',
      topicClassification: 'on_topic',
      rationale: 'q&a',
    });
    expect(on.type).toBe('answer_question');
    expect(on.type === 'answer_question' && on.topicClassification).toBe('on_topic');

    const off = assertValidAction({
      move: 'answer_question',
      question: 'help with my essay?',
      answer: "I can help with Boolean logic — for essays, Nerdy has other tutors.",
      topicClassification: 'off_topic',
      rationale: 'deflect',
    });
    expect(off.type === 'answer_question' && off.topicClassification).toBe('off_topic');
  });

  it('propose_mastery_transition → transition to mastered', () => {
    const a = assertValidAction({ move: 'propose_mastery_transition', rationale: 'gate passed' });
    expect(a.type).toBe('transition');
    expect(a.type === 'transition' && a.to).toBe('mastered');
  });

  it('no_action → no_action with reason preserved', () => {
    const a = assertValidAction({
      move: 'no_action',
      reason: 'wait_for_learner',
      rationale: 'nothing to do',
    });
    expect(a.type).toBe('no_action');
    expect(a.type === 'no_action' && a.reason).toBe('wait_for_learner');
  });
});
