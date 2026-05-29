import type { Action, ComponentSpec, Gate, Rep } from '@polymath/contract';

/**
 * The inner agent's **internal** tactical menu (ADR-003). This is the agent's
 * decision vocabulary — *not* the wire `Action` union. The wire union is the four
 * locked variants in `@polymath/contract` (`mount`/`transition`/`answer_question`/
 * `no_action`, append-only); every tactical move here *compiles down* to exactly
 * one of them via `compileMove`. Keeping the menu internal is what lets the agent
 * have a rich decision space without ever growing the wire contract.
 *
 * Extensible by discriminator literal: F-06 adds `propose_hint`, F-07 adds
 * `propose_transfer_probe`. A new move = a new union member + a new `compileMove`
 * arm; the wire contract is untouched.
 */

/** A practice/worked item the agent commits to. ADR-010 Layer 2 recomputes the
 *  claimed table server-side before the resulting Action ships. */
export interface ProposedItem {
  /** Which workspace to mount the item in. */
  rep: Rep;
  targetExpression: string;
  /** The agent's committed answer key — Layer 2 verifies this. */
  claimedTruthTable: (0 | 1)[];
  /** Reps visible alongside the target (the practice scaffolds). */
  visibleReps: Rep[];
  /** Gates the circuit builder may use (consumed only by the circuit rep). */
  allowedGates?: Gate[];
}

export type TacticalMove =
  | { move: 'next_practice_item'; item: ProposedItem; tier: number; rationale: string }
  | { move: 'simpler_item'; item: ProposedItem; rationale: string }
  | { move: 'rephrase'; item: ProposedItem; rationale: string }
  | {
      move: 'worked_example';
      expression: string;
      steps: { label: string; detail: string }[];
      visibleReps: Rep[];
      rationale: string;
    }
  | { move: 'alt_representation'; item: ProposedItem; rep: Rep; rationale: string }
  | {
      move: 'answer_question';
      question: string;
      answer: string;
      topicClassification: 'on_topic' | 'off_topic';
      rationale: string;
    }
  | { move: 'propose_mastery_transition'; rationale: string }
  | {
      move: 'propose_transfer_probe';
      /** The held-out transfer item the learner must reproduce in `targetRep`. */
      expression: string;
      targetRep: Rep;
      hiddenReps: Rep[];
      itemId: string;
      rationale: string;
    }
  | { move: 'propose_hint'; level: 1 | 2 | 3; body: string; rationale: string }
  // ADR-012 stretch — the free-build playground. A SCAFFOLD-ONLY move: it offers
  // optional help while the learner free-builds. It is NEVER a mastery/lesson
  // transition (the playground is ungraded) — it compiles to an on-topic answer
  // carrying the scaffold, or to `no_action` when there is nothing to add.
  | { move: 'verify_playground_equivalence'; scaffold?: string; rationale: string }
  | {
      move: 'no_action';
      reason: 'wait_for_learner' | 'thinking' | 'agent_unsure';
      rationale: string;
    };

/** The set of tactical moves the agent may pick from in F-05's L1-active menu.
 *  Enumerated in the system prompt; F-06/F-07 extend it. */
export const F05_MENU = [
  'next_practice_item',
  'simpler_item',
  'rephrase',
  'worked_example',
  'alt_representation',
  'answer_question',
  'propose_mastery_transition',
  'propose_transfer_probe',
  'no_action',
] as const;

/** Extended menu including the F-06 hint ladder. */
export const F06_MENU = [...F05_MENU, 'propose_hint'] as const;

/** ADR-012 stretch menu: the then-current menu plus the scaffold-only playground
 *  move. The `[...PREV_MENU, 'new_move']` pattern keeps the LLM provider's enum in
 *  lockstep with the `TacticalMove` union. */
export const F26_MENU = [...F06_MENU, 'verify_playground_equivalence'] as const;

const DEFAULT_GATES: Gate[] = ['AND', 'OR', 'NOT'];

/** Build the item-generating `ComponentSpec` for a proposed item. The three
 *  item-generating variants differ in their expression field name and (circuit
 *  only) `allowedGates`. */
function itemSpec(item: ProposedItem): ComponentSpec {
  switch (item.rep) {
    case 'truth_table':
      return {
        kind: 'TruthTablePractice',
        expression: item.targetExpression,
        claimedTruthTable: item.claimedTruthTable,
        visibleReps: item.visibleReps,
      };
    case 'circuit':
      return {
        kind: 'CircuitBuilder',
        targetExpression: item.targetExpression,
        claimedTruthTable: item.claimedTruthTable,
        allowedGates: item.allowedGates ?? DEFAULT_GATES,
        visibleReps: item.visibleReps,
      };
    case 'pseudocode':
      return {
        kind: 'PseudocodeChallenge',
        targetExpression: item.targetExpression,
        claimedTruthTable: item.claimedTruthTable,
        visibleReps: item.visibleReps,
      };
  }
}

/**
 * Compile a tactical move into the wire `Action` it resolves to. Pure and total:
 * every move maps to exactly one of the four wire variants. This is the single
 * place the internal menu meets the locked contract.
 */
export function compileMove(move: TacticalMove): Action {
  switch (move.move) {
    case 'next_practice_item':
    case 'simpler_item':
    case 'rephrase':
      return { type: 'mount', component: itemSpec(move.item), rationale: move.rationale };
    case 'alt_representation':
      return {
        type: 'mount',
        component: itemSpec({ ...move.item, rep: move.rep }),
        rationale: move.rationale,
      };
    case 'worked_example':
      return {
        type: 'mount',
        component: {
          kind: 'WorkedExample',
          expression: move.expression,
          steps: move.steps,
          visibleReps: move.visibleReps,
        },
        rationale: move.rationale,
      };
    case 'answer_question':
      return {
        type: 'answer_question',
        question: move.question,
        answer: move.answer,
        topicClassification: move.topicClassification,
        rationale: move.rationale,
      };
    case 'propose_mastery_transition':
      return { type: 'transition', to: 'mastered', rationale: move.rationale };
    case 'propose_transfer_probe':
      return {
        type: 'mount',
        component: {
          kind: 'TransferProbe',
          expression: move.expression,
          targetRep: move.targetRep,
          hiddenReps: move.hiddenReps,
          itemId: move.itemId,
        },
        rationale: move.rationale,
      };
    case 'propose_hint':
      return {
        type: 'mount',
        component: { kind: 'HintCard', level: move.level, body: move.body },
        rationale: move.rationale,
      };
    case 'verify_playground_equivalence':
      // Scaffold-only: surface the optional scaffold as an on-topic answer; with no
      // scaffold there is nothing to mount, so wait for the learner. Never a
      // transition (the playground is ungraded).
      return move.scaffold
        ? {
            type: 'answer_question',
            question: '',
            answer: move.scaffold,
            topicClassification: 'on_topic',
            rationale: move.rationale,
          }
        : { type: 'no_action', reason: 'wait_for_learner', rationale: move.rationale };
    case 'no_action':
      return { type: 'no_action', reason: move.reason, rationale: move.rationale };
  }
}
