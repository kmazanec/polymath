import { noAction } from '@polymath/contract';
import type { Action } from '@polymath/contract';
import { F26_MENU } from '../agent/menu.js';
import { MoveSchema, toTacticalMove } from '../agent/openaiClient.js';
import type { TacticalMove } from '../agent/menu.js';

/**
 * The OpenAI Realtime function-calling tool set for the conversational voice loop.
 *
 * One tool — `propose_tactical_move` — whose parameter schema is the SAME flat shape
 * as `MoveSchema` in openaiClient.ts. Using the identical schema means `toTacticalMove`
 * from openaiClient.ts can be called verbatim: one definition handles both the
 * chat-completion path and the realtime tool-call path. A menu addition that updates
 * `F26_MENU` and `MoveSchema` automatically reaches the realtime path.
 *
 * The JSON schema is hand-written (no zod-to-json-schema dep) and tested with a
 * lockstep assertion that every `F26_MENU` value appears in the enum. A menu addition
 * that isn't mirrored here fails the test before reaching production.
 */

/** JSON schema for the `propose_tactical_move` tool parameters.
 *  Must stay in lockstep with `MoveSchema` in openaiClient.ts. The test in
 *  realtimeTools.test.ts asserts every F26_MENU value is present in the `move` enum. */
const proposeTacticalMoveParameters = {
  type: 'object',
  properties: {
    move: {
      type: 'string',
      enum: [...F26_MENU],
      description:
        'The tactical move to propose. Must be one of the menu values. ' +
        'Use no_action when waiting for the learner or unsure.',
    },
    rationale: {
      type: 'string',
      description: 'Brief reasoning for the chosen move.',
    },
    // item fields (next_practice_item, simpler_item, rephrase, alt_representation)
    item: {
      type: 'object',
      nullable: true,
      properties: {
        rep: {
          type: 'string',
          enum: ['truth_table', 'circuit', 'pseudocode'],
          description: 'Which representation to mount the item in.',
        },
        targetExpression: {
          type: 'string',
          description: 'The Boolean expression for the item.',
        },
        claimedTruthTable: {
          type: 'array',
          items: { type: 'number', enum: [0, 1] },
          description: 'MSB-first truth table matching the expression. Layer 2 recomputes and verifies this.',
        },
        visibleReps: {
          type: 'array',
          items: { type: 'string', enum: ['truth_table', 'circuit', 'pseudocode'] },
          description: 'Representations visible alongside the target workspace.',
        },
        prompt: {
          type: 'string',
          nullable: true,
          description: 'Grounding question/instruction shown with the item.',
        },
      },
      required: ['rep', 'targetExpression', 'claimedTruthTable', 'visibleReps'],
      description: 'Practice item payload. Required for next_practice_item, simpler_item, rephrase, alt_representation.',
    },
    tier: {
      type: 'number',
      nullable: true,
      description: 'Difficulty tier for next_practice_item.',
    },
    altRep: {
      type: 'string',
      nullable: true,
      enum: ['truth_table', 'circuit', 'pseudocode'],
      description: 'Target representation for alt_representation.',
    },
    // worked_example fields
    workedExpression: {
      type: 'string',
      nullable: true,
      description: 'Expression to use for worked_example.',
    },
    workedSteps: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['label', 'detail'],
      },
      description: 'Step-by-step breakdown for worked_example.',
    },
    workedVisibleReps: {
      type: 'array',
      nullable: true,
      items: { type: 'string', enum: ['truth_table', 'circuit', 'pseudocode'] },
      description: 'Reps visible in the worked example.',
    },
    // answer_question fields
    question: {
      type: 'string',
      nullable: true,
      description: "The learner's question being answered.",
    },
    answer: {
      type: 'string',
      nullable: true,
      description: 'Answer text for answer_question.',
    },
    topicClassification: {
      type: 'string',
      nullable: true,
      enum: ['on_topic', 'off_topic'],
      description: 'Whether the question is on-topic for the lesson.',
    },
    // no_action fields
    noActionReason: {
      type: 'string',
      nullable: true,
      enum: ['wait_for_learner', 'thinking', 'agent_unsure'],
      description: 'Reason for no_action.',
    },
    // propose_hint fields
    hintLevel: {
      type: 'number',
      nullable: true,
      enum: [1, 2, 3],
      description: 'Hint ladder level (1=lightest, 3=heaviest) for propose_hint.',
    },
    hintBody: {
      type: 'string',
      nullable: true,
      description: 'Hint text for propose_hint.',
    },
    // propose_transfer_probe fields
    probeExpression: {
      type: 'string',
      nullable: true,
      description: 'Boolean expression for the transfer probe.',
    },
    probeTargetRep: {
      type: 'string',
      nullable: true,
      enum: ['truth_table', 'circuit', 'pseudocode'],
      description: 'Which rep the learner must demonstrate for the probe.',
    },
    probeHiddenReps: {
      type: 'array',
      nullable: true,
      items: { type: 'string', enum: ['truth_table', 'circuit', 'pseudocode'] },
      description: 'Reps hidden during the probe (held-out for transfer measurement).',
    },
    probeItemId: {
      type: 'string',
      nullable: true,
      description: 'transfer_bank row id for the probe item.',
    },
    // verify_playground_equivalence fields
    scaffold: {
      type: 'string',
      nullable: true,
      description: 'Optional scaffold text for verify_playground_equivalence.',
    },
  },
  required: ['move', 'rationale'],
  additionalProperties: false,
} as const;

/** The OpenAI Realtime tools array to pass when creating/updating a realtime session.
 *  One function — `propose_tactical_move` — mirrors the `MoveSchema` flat shape so the
 *  model emits arguments that `toolCallToTacticalMove` can parse without translation. */
export const REALTIME_TOOLS: ReadonlyArray<{
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> = [
  {
    type: 'function',
    name: 'propose_tactical_move',
    description:
      'Propose the next pedagogical action for the learner. ' +
      'Call this to suggest a practice item, hint, answer, transfer probe, or mastery transition. ' +
      'The server validates and gates the proposal; a refused proposal degrades to no_action.',
    parameters: proposeTacticalMoveParameters as Record<string, unknown>,
  },
];

/**
 * Parse a realtime tool-call arguments object into a `TacticalMove`.
 *
 * Uses the SAME `MoveSchema` Zod schema that the chat-completion path uses, then calls
 * the SAME `toTacticalMove` switch — so both paths produce identical `TacticalMove`
 * values for identical inputs. A parse failure (malformed tool-call args from the
 * model) degrades safely to `no_action` with reason `'agent_unsure'` rather than
 * throwing across an async boundary — the caller always gets a valid `TacticalMove`.
 */
export function toolCallToTacticalMove(args: unknown): TacticalMove {
  const parsed = MoveSchema.safeParse(args);
  if (!parsed.success) {
    return {
      move: 'no_action',
      reason: 'agent_unsure',
      rationale: `realtime tool-call args failed schema validation: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    };
  }
  try {
    return toTacticalMove(parsed.data);
  } catch (err) {
    // toTacticalMove throws for moves with missing required fields (e.g. next_practice_item
    // with no item). Degrade rather than propagate — a bad model emission should never crash
    // the voice loop.
    const message = err instanceof Error ? err.message : String(err);
    return {
      move: 'no_action',
      reason: 'agent_unsure',
      rationale: `realtime tool-call move mapping failed: ${message}`,
    };
  }
}

// Re-export the Action type so callers of this module don't need a separate import.
export type { Action };
