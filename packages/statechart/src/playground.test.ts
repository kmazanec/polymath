import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { PhaseName } from '@polymath/contract';
import { LESSON_PHASES } from './lesson.js';
import {
  createPlaygroundMachine,
  PLAYGROUND_PHASES,
} from './playground.js';

// ADR-013: the playground is its OWN micro-statechart (a sibling machine), NOT a
// substate of the locked lesson spine. Phase set:
//   proposing → building → checking → {satisfied, mismatch} → ended
//   mismatch → building   ·   any → ended (final)
function start() {
  const actor = createActor(createPlaygroundMachine());
  actor.start();
  return actor;
}

describe('playground micro-statechart (ADR-013)', () => {
  it('starts in proposing', () => {
    expect(start().getSnapshot().value).toBe('proposing');
  });

  it('proposing → building on propose_target', () => {
    const actor = start();
    actor.send({ type: 'propose_target' });
    expect(actor.getSnapshot().value).toBe('building');
  });

  it('building → checking on submit', () => {
    const actor = start();
    actor.send({ type: 'propose_target' });
    actor.send({ type: 'submit' });
    expect(actor.getSnapshot().value).toBe('checking');
  });

  it('checking → satisfied when allEquivalent (verdict_satisfied)', () => {
    const actor = start();
    actor.send({ type: 'propose_target' });
    actor.send({ type: 'submit' });
    actor.send({ type: 'verdict_satisfied' });
    expect(actor.getSnapshot().value).toBe('satisfied');
  });

  it('checking → mismatch when a rep disagrees (verdict_mismatch)', () => {
    const actor = start();
    actor.send({ type: 'propose_target' });
    actor.send({ type: 'submit' });
    actor.send({ type: 'verdict_mismatch' });
    expect(actor.getSnapshot().value).toBe('mismatch');
  });

  it('mismatch → building on keep_building (iterate without leaving the playground)', () => {
    const actor = start();
    actor.send({ type: 'propose_target' });
    actor.send({ type: 'submit' });
    actor.send({ type: 'verdict_mismatch' });
    actor.send({ type: 'keep_building' });
    expect(actor.getSnapshot().value).toBe('building');
  });

  it('satisfied → building on keep_building (the learner can keep playing after a pass)', () => {
    const actor = start();
    actor.send({ type: 'propose_target' });
    actor.send({ type: 'submit' });
    actor.send({ type: 'verdict_satisfied' });
    actor.send({ type: 'keep_building' });
    expect(actor.getSnapshot().value).toBe('building');
  });

  it.each(['proposing', 'building', 'checking', 'satisfied', 'mismatch'] as const)(
    'every non-final state can exit to ended (from %s)',
    (from) => {
      const actor = start();
      // drive to `from`
      if (from === 'building' || from === 'checking' || from === 'satisfied' || from === 'mismatch') {
        actor.send({ type: 'propose_target' });
      }
      if (from === 'checking' || from === 'satisfied' || from === 'mismatch') {
        actor.send({ type: 'submit' });
      }
      if (from === 'satisfied') actor.send({ type: 'verdict_satisfied' });
      if (from === 'mismatch') actor.send({ type: 'verdict_mismatch' });
      expect(actor.getSnapshot().value).toBe(from);
      actor.send({ type: 'exit' });
      expect(actor.getSnapshot().value).toBe('ended');
      expect(actor.getSnapshot().status).toBe('done');
    },
  );

  it('ended is a final state', () => {
    const machine = createPlaygroundMachine();
    expect(machine.states.ended.type).toBe('final');
  });

  it('PLAYGROUND_PHASES lists exactly the machine states', () => {
    const machine = createPlaygroundMachine();
    expect([...PLAYGROUND_PHASES].sort()).toEqual(Object.keys(machine.states).sort());
  });
});

// The whole point of ADR-013: the sibling machine adds NO phase to the locked
// lesson spine. A future edit that couples them (e.g. importing PhaseName into
// playground.ts and reusing the enum) trips these assertions in CI.
describe('the playground machine does not touch the locked lesson spine', () => {
  it('LESSON_PHASES still equals the locked PhaseName contract enum (untouched)', () => {
    expect([...LESSON_PHASES].sort()).toEqual([...PhaseName.options].sort());
  });

  it('PLAYGROUND_PHASES is a DISJOINT vocabulary from the lesson PhaseName enum', () => {
    const lessonPhases = new Set<string>(PhaseName.options);
    for (const phase of PLAYGROUND_PHASES) {
      expect(lessonPhases.has(phase)).toBe(false);
    }
  });
});
