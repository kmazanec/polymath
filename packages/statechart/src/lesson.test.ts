import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { PhaseName } from '@polymath/contract';
import {
  createLessonMachine,
  lessonMachine,
  LESSON_PHASES,
  isHiddenRepMountRefused,
} from './lesson.js';

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

// F-13: the lesson spine is a FACTORY parameterised on lessonId. The default
// `lessonMachine` is lesson 1; `createLessonMachine({lessonId})` instantiates the
// SAME locked phase shape for any lesson (L2 is the first non-L1 instantiation).
// The machine id keys on the lessonId (`lesson_${lessonId}`); guards key on
// `context.lessonId` (a number), never the id string.
describe('createLessonMachine (F-13 lesson factory — parameterised spine)', () => {
  it('the default export is the lesson_1 machine (unchanged)', () => {
    expect(lessonMachine.id).toBe('lesson_1');
  });

  it('builds a machine whose id reflects the lessonId', () => {
    expect(createLessonMachine({ lessonId: 2 }).id).toBe('lesson_2');
    expect(createLessonMachine({ lessonId: 3 }).id).toBe('lesson_3');
  });

  function startL2(masteryReady = false) {
    const actor = createActor(createLessonMachine({ lessonId: 2 }), {
      input: { lessonId: 2, masteryReady },
    });
    actor.start();
    return actor;
  }

  it('L2 starts in introducing with lessonId 2 in context', () => {
    const actor = startL2();
    expect(actor.getSnapshot().value).toBe('introducing');
    expect(actor.getSnapshot().context.lessonId).toBe(2);
  });

  it('L2 phase behavior is IDENTICAL to L1 (introducing → practicing → assessed)', () => {
    const actor = startL2();
    actor.send({ type: 'start_practice' });
    expect(actor.getSnapshot().value).toBe('practicing');
    actor.send({ type: 'submit' });
    expect(actor.getSnapshot().value).toBe('assessed');
  });

  it('L2 REFUSES early transfer (canEnterTransfer keys on context, not the id string)', () => {
    const actor = startL2();
    actor.send({ type: 'start_practice' });
    actor.send({ type: 'enter_transfer' }); // no set_transfer_ready → refused
    expect(actor.getSnapshot().value).toBe('practicing');
    actor.send({ type: 'set_transfer_ready', ready: true });
    actor.send({ type: 'enter_transfer' });
    expect(actor.getSnapshot().value).toBe('transferring');
  });

  it('L2 REFUSES mastery while the gate is unsatisfied, reaches mastered when satisfied', () => {
    const refused = startL2(false);
    refused.send({ type: 'start_practice' });
    refused.send({ type: 'submit' });
    refused.send({ type: 'mastery_ok' });
    expect(refused.getSnapshot().value).toBe('assessed');

    const ok = startL2(true);
    ok.send({ type: 'start_practice' });
    ok.send({ type: 'submit' });
    ok.send({ type: 'mastery_ok' });
    expect(ok.getSnapshot().value).toBe('mastered');
    expect(ok.getSnapshot().status).toBe('done');
  });

  it('every instantiation has the SAME locked phase set as the contract enum', () => {
    const l2 = createLessonMachine({ lessonId: 2 });
    expect(Object.keys(l2.states).sort()).toEqual([...PhaseName.options].sort());
    expect(l2.states.mastered.type).toBe('final');
  });
});

describe('lesson_2 re-instantiation parity (F-15 L1→L2 advance)', () => {
  // F-15's macro transition is session-level RE-INSTANTIATION, not a parent machine:
  // the client unmounts the L1 `LessonSession` (a `final` mastered state) and re-mounts
  // the SAME `lessonMachine` with `input.lessonId:2`. This asserts the spine behaves
  // identically for L2 — same phases, same guards, same `lessonId` carried in context —
  // so the re-mount needs no new machine (which would break the locked PhaseName spine).
  function startL2(masteryReady = false) {
    const actor = createActor(lessonMachine, { input: { lessonId: 2, masteryReady } });
    actor.start();
    return actor;
  }

  it('starts a lessonId:2 actor in introducing with lessonId 2 in context', () => {
    const actor = startL2();
    expect(actor.getSnapshot().value).toBe('introducing');
    expect(actor.getSnapshot().context.lessonId).toBe(2);
  });

  it('drives the same introducing → practicing → assessed → mastered arc for L2', () => {
    const actor = startL2(true);
    actor.send({ type: 'start_practice' });
    expect(actor.getSnapshot().value).toBe('practicing');
    actor.send({ type: 'submit' });
    expect(actor.getSnapshot().value).toBe('assessed');
    actor.send({ type: 'mastery_ok' });
    expect(actor.getSnapshot().value).toBe('mastered');
    expect(actor.getSnapshot().status).toBe('done');
  });

  it('REFUSES L2 mastery when canDeclareMastery is false (same guard wiring as L1)', () => {
    const actor = startL2(false);
    actor.send({ type: 'start_practice' });
    actor.send({ type: 'submit' });
    actor.send({ type: 'mastery_ok' });
    expect(actor.getSnapshot().value).not.toBe('mastered');
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
