import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { lessonMachine } from '@polymath/statechart';
import type { Action } from '@polymath/contract';
import { adaptAction } from './actionAdapter.js';

const ttItem: Action = {
  type: 'mount',
  component: { kind: 'TruthTablePractice', expression: 'A AND B', claimedTruthTable: [0, 0, 0, 1], visibleReps: ['truth_table'] },
  rationale: 'r',
};
const probeMount: Action = {
  type: 'mount',
  component: { kind: 'TransferProbe', expression: 'A AND B', hiddenReps: ['truth_table'], targetRep: 'circuit', itemId: 'L1-01' },
  rationale: 'probe',
};

describe('adaptAction', () => {
  it('mount of a practice item → mounts the spec + drives start_practice', () => {
    const r = adaptAction(ttItem);
    expect(r.mount?.kind).toBe('TruthTablePractice');
    expect(r.lessonEvents).toEqual([{ type: 'start_practice' }]);
  });

  it('mount of a non-practice spec (HintCard) mounts without a phase change', () => {
    const r = adaptAction({ type: 'mount', component: { kind: 'HintCard', level: 1, body: 'hi' }, rationale: 'r' });
    expect(r.mount?.kind).toBe('HintCard');
    expect(r.lessonEvents).toBeUndefined();
  });

  it('a TransferProbe mount opens the transfer gate then enters transferring', () => {
    const r = adaptAction(probeMount);
    expect(r.mount?.kind).toBe('TransferProbe');
    expect(r.lessonEvents).toEqual([{ type: 'set_transfer_ready', ready: true }, { type: 'enter_transfer' }]);
  });

  it('transition to mastered → mastery_ok (from a non-transfer phase)', () => {
    expect(adaptAction({ type: 'transition', to: 'mastered', rationale: 'r' }).lessonEvents).toEqual([
      { type: 'mastery_ok' },
    ]);
  });

  it('transition to mastered FROM transferring → assess then mastery_ok', () => {
    const r = adaptAction({ type: 'transition', to: 'mastered', rationale: 'r' }, { phase: 'transferring', hiddenReps: [] });
    expect(r.lessonEvents).toEqual([{ type: 'assess' }, { type: 'mastery_ok' }]);
  });

  it('answer_question → surfaces the answer, no mount/transition', () => {
    const r = adaptAction({ type: 'answer_question', question: 'q', answer: 'a', topicClassification: 'off_topic', rationale: 'r' });
    expect(r.answer).toEqual({ question: 'q', answer: 'a', topicClassification: 'off_topic' });
    expect(r.mount).toBeUndefined();
    expect(r.lessonEvents).toBeUndefined();
  });

  it('no_action → no effect', () => {
    expect(adaptAction({ type: 'no_action', reason: 'thinking', rationale: 'r' })).toEqual({});
  });

  it('refuses a mount that would reveal a hidden rep during a transfer probe (ADR-005 #2)', () => {
    const r = adaptAction(ttItem, { phase: 'transferring', hiddenReps: ['truth_table'] });
    expect(r.refused).toBe(true);
    expect(r.mount).toBeUndefined();
  });

  it('allows the target rep mount during a transfer probe', () => {
    const r = adaptAction(probeMount, { phase: 'transferring', hiddenReps: ['truth_table'] });
    expect(r.refused).toBeUndefined();
    expect(r.mount?.kind).toBe('TransferProbe');
  });

  it('END-TO-END on the real spine: practice → probe → pass → mastered (gate open)', () => {
    // `masteryReady: true` stands in for F-09/F-12's gate flag — the spine refuses
    // `mastered` without it (ADR-005 refusal #3), which is correct; here we prove
    // the F-07 transition path itself reaches mastered once the gate allows.
    const actor = createActor(lessonMachine, { input: { lessonId: 1, masteryReady: true } }).start();
    adaptAction(ttItem).lessonEvents?.forEach((e) => actor.send(e));
    expect(actor.getSnapshot().value).toBe('practicing');

    adaptAction(probeMount, { phase: 'practicing', hiddenReps: [] }).lessonEvents?.forEach((e) => actor.send(e));
    expect(actor.getSnapshot().value).toBe('transferring');

    // a passed transfer → mastery transition (assess → mastery_ok) → mastered
    adaptAction({ type: 'transition', to: 'mastered', rationale: 'pass' }, { phase: 'transferring', hiddenReps: [] }).lessonEvents?.forEach((e) => actor.send(e));
    expect(actor.getSnapshot().value).toBe('mastered');
  });

  it('the spine refuses mastery after a passed transfer when the gate is closed (refusal #3 holds)', () => {
    const actor = createActor(lessonMachine, { input: { lessonId: 1 } }).start(); // masteryReady false
    adaptAction(ttItem).lessonEvents?.forEach((e) => actor.send(e));
    adaptAction(probeMount, { phase: 'practicing', hiddenReps: [] }).lessonEvents?.forEach((e) => actor.send(e));
    adaptAction({ type: 'transition', to: 'mastered', rationale: 'pass' }, { phase: 'transferring', hiddenReps: [] }).lessonEvents?.forEach((e) => actor.send(e));
    // assess succeeds → assessed, but mastery_ok is refused (guard) → stays assessed.
    expect(actor.getSnapshot().value).toBe('assessed');
  });

  it('END-TO-END on the real spine: probe → fail → remediate → practicing', () => {
    const actor = createActor(lessonMachine, { input: { lessonId: 1 } }).start();
    adaptAction(ttItem).lessonEvents?.forEach((e) => actor.send(e));
    adaptAction(probeMount, { phase: 'practicing', hiddenReps: [] }).lessonEvents?.forEach((e) => actor.send(e));
    expect(actor.getSnapshot().value).toBe('transferring');

    // a failed transfer → the agent mounts a simpler practice item; the adapter
    // walks transferring → assessed → remediating → practicing.
    const remediate = adaptAction(ttItem, { phase: 'transferring', hiddenReps: [] });
    remediate.lessonEvents?.forEach((e) => actor.send(e));
    expect(actor.getSnapshot().value).toBe('practicing');
  });
});
