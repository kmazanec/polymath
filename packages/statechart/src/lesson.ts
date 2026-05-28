import { assign, setup } from 'xstate';
import type { PhaseName } from '@polymath/contract';

/**
 * The lesson statechart spine (ADR-003 / ADR-007). XState owns "when the UI
 * changes"; its guards are the three explicit refusals (ADR-005). F-01 locks the
 * *phase shape* — the named states and the legal transitions between them — so
 * every lesson reuses it by parameterisation and downstream features only fill in
 * guard *bodies* (F-09 rule-gate, F-12 mastery gate), never re-shape the spine.
 *
 *   introducing → practicing → {hint, transferring} → assessed → {mastered, remediating}
 *
 * Guards here are deliberately constant (trivially-true / -false) — the real
 * predicates are F-09/F-12 work. They are named so the diagram and the downstream
 * features have a stable seam.
 */

/** Per-lesson context. Expands in F-09 (BKT params, behavioral signals) — the
 *  shape is intentionally minimal at F-01. */
export interface LessonContext {
  lessonId: number;
  /** Set by F-09; F-01 leaves it false so `canDeclareMastery` is a no-op. */
  masteryReady: boolean;
  /** Set by F-09's rule gate (via `set_transfer_ready`): the learner has cleared
   *  the behavioral + BKT bar, so `practicing → transferring` is legal. False
   *  until the gate passes — the spine refuses to enter a transfer probe early. */
  transferReady: boolean;
}

export type LessonEvent =
  | { type: 'start_practice' }
  | { type: 'submit' }
  | { type: 'request_hint' }
  | { type: 'resume_practice' }
  | { type: 'set_transfer_ready'; ready: boolean }
  | { type: 'enter_transfer' }
  | { type: 'assess' }
  | { type: 'mastery_ok' }
  | { type: 'remediate' };

export const lessonMachine = setup({
  types: {
    context: {} as LessonContext,
    events: {} as LessonEvent,
    input: {} as { lessonId: number; masteryReady?: boolean; transferReady?: boolean },
  },
  guards: {
    /** ADR-005 refusal #3 source: a transition into `mastered` is only legal
     *  when the gate is satisfied. F-01 stub returns the context flag (false). */
    canDeclareMastery: ({ context }) => context.masteryReady,
    /** ADR-005 refusal #1 source: an item only ends on an explicit learner act.
     *  F-01 stub is trivially true (no mid-item auto-advance path exists yet). */
    canEndItem: () => true,
    /** F-09 rule-gate seam: `practicing → transferring` only when the learner has
     *  cleared the behavioral + BKT bar (the server-computed rule gate, mirrored
     *  into `transferReady`). The spine refuses an early transfer probe. */
    canEnterTransfer: ({ context }) => context.transferReady,
  },
  actions: {
    setTransferReady: assign({
      transferReady: ({ event }) =>
        event.type === 'set_transfer_ready' ? event.ready : false,
    }),
  },
}).createMachine({
  id: 'lesson_1',
  initial: 'introducing',
  context: ({ input }) => ({
    lessonId: input.lessonId,
    masteryReady: input.masteryReady ?? false,
    transferReady: input.transferReady ?? false,
  }),
  states: {
    introducing: {
      on: { start_practice: { target: 'practicing' } },
    },
    practicing: {
      on: {
        request_hint: { target: 'hint' },
        set_transfer_ready: { actions: 'setTransferReady' },
        enter_transfer: { target: 'transferring', guard: 'canEnterTransfer' },
        submit: { target: 'assessed', guard: 'canEndItem' },
      },
    },
    hint: {
      on: { resume_practice: { target: 'practicing' } },
    },
    transferring: {
      on: { assess: { target: 'assessed', guard: 'canEndItem' } },
    },
    assessed: {
      on: {
        mastery_ok: { target: 'mastered', guard: 'canDeclareMastery' },
        remediate: { target: 'remediating' },
      },
    },
    remediating: {
      on: { resume_practice: { target: 'practicing' } },
    },
    mastered: {
      type: 'final',
    },
  },
});

export type LessonMachine = typeof lessonMachine;

/** The machine's phase state names. Cross-checked against the `PhaseName`
 *  contract enum at runtime in the test suite (state nodes ↔ contract phases). */
export const LESSON_PHASES = Object.keys(lessonMachine.states) as PhaseName[];

/**
 * ADR-005 refusal #2 (the transfer-probe hidden-rep refusal), as a pure guard.
 * During the `transferring` phase, mounting (or revealing) a representation listed
 * in the probe's `hiddenReps` is refused — even if the learner explicitly asks.
 * Outside `transferring` nothing is hidden. Kept in the statechart package (the
 * owner of *when* the UI may change) and pure so both the web mount path and the
 * tests consult the same predicate.
 *
 * `rep` is the representation a candidate mount would reveal; `hiddenReps` is the
 * active probe's held-out set (empty when not probing).
 */
export function isHiddenRepMountRefused(
  phase: string,
  rep: string | undefined,
  hiddenReps: readonly string[],
): boolean {
  if (phase !== 'transferring') return false;
  if (rep === undefined) return false;
  return hiddenReps.includes(rep);
}
