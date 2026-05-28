import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { PhaseName } from '@polymath/contract';
import { lessonMachine, LESSON_PHASES, isHiddenRepMountRefused } from './lesson.js';

function start(masteryReady = false) {
  const actor = createActor(lessonMachine, {
    input: { lessonId: 1, masteryReady },
  });
  actor.start();
  return actor;
}

describe('lesson_1 statechart', () => {
  it('starts in introducing', () => {
    const actor = start();
    expect(actor.getSnapshot().value).toBe('introducing');
    expect(actor.getSnapshot().context.lessonId).toBe(1);
  });

  // acceptance criterion 7
  it('transitions introducing → practicing on start_practice', () => {
    const actor = start();
    actor.send({ type: 'start_practice' });
    expect(actor.getSnapshot().value).toBe('practicing');
  });

  it('practicing → hint on request_hint, and back on resume_practice', () => {
    const actor = start();
    actor.send({ type: 'start_practice' });
    actor.send({ type: 'request_hint' });
    expect(actor.getSnapshot().value).toBe('hint');
    actor.send({ type: 'resume_practice' });
    expect(actor.getSnapshot().value).toBe('practicing');
  });

  it('practicing → transferring on enter_transfer once the rule gate opens (set_transfer_ready)', () => {
    const actor = start();
    actor.send({ type: 'start_practice' });
    actor.send({ type: 'set_transfer_ready', ready: true });
    actor.send({ type: 'enter_transfer' });
    expect(actor.getSnapshot().value).toBe('transferring');
  });

  it('REFUSES practicing → transferring while the rule gate is closed (F-09 canEnterTransfer)', () => {
    const actor = start();
    actor.send({ type: 'start_practice' });
    actor.send({ type: 'enter_transfer' }); // no set_transfer_ready → guard refuses
    expect(actor.getSnapshot().value).toBe('practicing');
  });

  it('practicing → assessed on submit', () => {
    const actor = start();
    actor.send({ type: 'start_practice' });
    actor.send({ type: 'submit' });
    expect(actor.getSnapshot().value).toBe('assessed');
  });

  it('transferring → assessed on assess', () => {
    const actor = start();
    actor.send({ type: 'start_practice' });
    actor.send({ type: 'set_transfer_ready', ready: true });
    actor.send({ type: 'enter_transfer' });
    actor.send({ type: 'assess' });
    expect(actor.getSnapshot().value).toBe('assessed');
  });

  it('assessed → remediating on remediate, then back to practicing', () => {
    const actor = start();
    actor.send({ type: 'start_practice' });
    actor.send({ type: 'submit' });
    actor.send({ type: 'remediate' });
    expect(actor.getSnapshot().value).toBe('remediating');
    actor.send({ type: 'resume_practice' });
    expect(actor.getSnapshot().value).toBe('practicing');
  });

  // ADR-005 refusal #3: the mastery guard refuses while the gate is unsatisfied.
  it('assessed → mastered is REFUSED when canDeclareMastery is false (F-01 stub)', () => {
    const actor = start();
    actor.send({ type: 'start_practice' });
    actor.send({ type: 'submit' });
    actor.send({ type: 'mastery_ok' });
    // guard returns context.masteryReady (false) → no transition
    expect(actor.getSnapshot().value).toBe('assessed');
  });

  it('reaches mastered when canDeclareMastery is satisfied', () => {
    // F-09/F-12 will flip masteryReady via assign actions; here we seed it via
    // input to assert the guard wiring lets the transition through when true.
    const actor = start(true);
    actor.send({ type: 'start_practice' });
    actor.send({ type: 'submit' });
    actor.send({ type: 'mastery_ok' });
    expect(actor.getSnapshot().value).toBe('mastered');
    expect(actor.getSnapshot().status).toBe('done');
  });
});

describe('lesson_1 machine definition (Stately-importable)', () => {
  it('state nodes match the locked PhaseName contract enum exactly', () => {
    // spine ↔ contract: no missing phase, no extra phase
    expect([...LESSON_PHASES].sort()).toEqual([...PhaseName.options].sort());
    expect(Object.keys(lessonMachine.states).sort()).toEqual(
      [...PhaseName.options].sort(),
    );
  });

  it('marks mastered as a final state', () => {
    expect(lessonMachine.states.mastered.type).toBe('final');
  });
});

describe('isHiddenRepMountRefused (ADR-005 refusal #2)', () => {
  it('refuses mounting a hidden rep during transferring', () => {
    expect(isHiddenRepMountRefused('transferring', 'truth_table', ['truth_table'])).toBe(true);
  });

  it('allows the target rep (not hidden) during transferring', () => {
    expect(isHiddenRepMountRefused('transferring', 'circuit', ['truth_table'])).toBe(false);
  });

  it('hides nothing outside the transferring phase', () => {
    expect(isHiddenRepMountRefused('practicing', 'truth_table', ['truth_table'])).toBe(false);
    expect(isHiddenRepMountRefused('assessed', 'circuit', ['circuit'])).toBe(false);
  });

  it('is a no-op when the candidate has no rep (e.g. an AgentAnswer mount)', () => {
    expect(isHiddenRepMountRefused('transferring', undefined, ['truth_table'])).toBe(false);
  });
});
