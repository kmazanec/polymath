import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { lessonMachine } from '@polymath/statechart';
import type { Action } from '@polymath/contract';
import { adaptAction } from './actionAdapter.js';

describe('adaptAction', () => {
  it('mount of a practice item → mounts the spec + drives start_practice', () => {
    const action: Action = {
      type: 'mount',
      component: { kind: 'TruthTablePractice', expression: 'A AND B', claimedTruthTable: [0, 0, 0, 1], visibleReps: ['truth_table'] },
      rationale: 'r',
    };
    const r = adaptAction(action);
    expect(r.mount?.kind).toBe('TruthTablePractice');
    expect(r.lessonEvent).toEqual({ type: 'start_practice' });
  });

  it('mount of a non-practice spec (HintCard) mounts without a phase change', () => {
    const r = adaptAction({ type: 'mount', component: { kind: 'HintCard', level: 1, body: 'hi' }, rationale: 'r' });
    expect(r.mount?.kind).toBe('HintCard');
    expect(r.lessonEvent).toBeUndefined();
  });

  it('transition to mastered → mastery_ok event', () => {
    expect(adaptAction({ type: 'transition', to: 'mastered', rationale: 'r' }).lessonEvent).toEqual({ type: 'mastery_ok' });
  });

  it('answer_question → surfaces the answer, no mount/transition', () => {
    const r = adaptAction({ type: 'answer_question', question: 'q', answer: 'a', topicClassification: 'off_topic', rationale: 'r' });
    expect(r.answer).toEqual({ question: 'q', answer: 'a', topicClassification: 'off_topic' });
    expect(r.mount).toBeUndefined();
    expect(r.lessonEvent).toBeUndefined();
  });

  it('no_action → no effect', () => {
    expect(adaptAction({ type: 'no_action', reason: 'thinking', rationale: 'r' })).toEqual({});
  });

  it('the emitted lessonEvents actually drive the real statechart spine', () => {
    const actor = createActor(lessonMachine, { input: { lessonId: 1 } }).start();
    // intro → practicing via a mounted practice item
    const mount = adaptAction({
      type: 'mount',
      component: { kind: 'TruthTablePractice', expression: 'A AND B', claimedTruthTable: [0, 0, 0, 1], visibleReps: ['truth_table'] },
      rationale: 'r',
    });
    if (mount.lessonEvent) actor.send(mount.lessonEvent);
    expect(actor.getSnapshot().value).toBe('practicing');
  });
});
