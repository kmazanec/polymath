import { setup } from 'xstate';

/**
 * The playground micro-statechart (ADR-013, ADR-012 stretch capstone).
 *
 * This is a SIBLING machine to the lesson spine, NOT a substate of it. The locked
 * lesson phase shape (`introducing → practicing → {hint, transferring} → assessed →
 * {mastered, remediating}`) is a directed-practice grammar — every transition
 * presumes a server-picked item plus the BKT/streak/transfer/mastery folds that
 * grade it. The playground has none of those: the learner authors an arbitrary
 * target and builds it across the reps, the agent only verifies/scaffolds, and
 * nothing is ever marked "mastered". So per the project invariant ("fill guard
 * bodies, never re-shape the spine; a new phase needs a new ADR") the playground
 * gets its OWN small machine with its OWN vocabulary — it deliberately imports
 * neither `PhaseName` nor `lesson.ts`, and adds no phase to `LESSON_PHASES`.
 *
 *   proposing → building → checking → {satisfied, mismatch}
 *   mismatch → building          (keep iterating)
 *   satisfied → building         (keep playing after a pass)
 *   any → ended (final)          (Finish → session-end celebration)
 *
 * The verdict (`verdict_satisfied` / `verdict_mismatch`) is delivered by the
 * client-side `playgroundEquivalence` call — correctness stays off the network
 * (the locked "the learner sees their answer marked before the agent decides"
 * invariant). The machine has no `mastered`/`assessed` state and no mastery guard,
 * so the playground structurally cannot grant mastery.
 */

export type PlaygroundEvent =
  | { type: 'propose_target' }
  | { type: 'submit' }
  | { type: 'verdict_satisfied' }
  | { type: 'verdict_mismatch' }
  | { type: 'keep_building' }
  | { type: 'exit' };

/** Factory (mirrors `createLessonMachine`'s factory shape) so a host can spin up a
 *  fresh playground actor per session without sharing actor identity. */
export function createPlaygroundMachine() {
  return setup({
    types: {
      events: {} as PlaygroundEvent,
    },
  }).createMachine({
    id: 'playground',
    initial: 'proposing',
    states: {
      proposing: {
        on: {
          propose_target: { target: 'building' },
          exit: { target: 'ended' },
        },
      },
      building: {
        on: {
          submit: { target: 'checking' },
          exit: { target: 'ended' },
        },
      },
      checking: {
        on: {
          verdict_satisfied: { target: 'satisfied' },
          verdict_mismatch: { target: 'mismatch' },
          exit: { target: 'ended' },
        },
      },
      satisfied: {
        on: {
          keep_building: { target: 'building' },
          exit: { target: 'ended' },
        },
      },
      mismatch: {
        on: {
          keep_building: { target: 'building' },
          exit: { target: 'ended' },
        },
      },
      ended: {
        type: 'final',
      },
    },
  });
}

/** The default playground machine instance. */
export const playgroundMachine = createPlaygroundMachine();

export type PlaygroundMachine = typeof playgroundMachine;

/** The playground machine's state names — a SEPARATE vocabulary from the lesson
 *  spine's `PhaseName`/`LESSON_PHASES` (ADR-013). */
export const PLAYGROUND_PHASES = Object.keys(playgroundMachine.states);
