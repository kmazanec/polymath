import { z } from 'zod';
import { ComponentSpec } from './component.js';
import { PhaseName } from './phase.js';

/**
 * `Action` — the agent's structured output (ADR-005). The agent emits exactly
 * one typed Action per turn; the server validates it against this schema before
 * it crosses the wire, and a malformed action is downgraded to `no_action`.
 *
 * Every variant carries `rationale: string` (logged, never shown to the learner).
 * ADR-003's tactical menu (`rephrase`, `simpler_item`, …) is the agent's *internal*
 * decision vocabulary; each such decision resolves into one of these four wire
 * Action types. The wire union is append-only — new variants (e.g. F-14's recall)
 * are added behind an `actionVersion` per the change protocol.
 */
export const Action = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('mount'),
    component: ComponentSpec,
    rationale: z.string(),
  }),
  z.object({
    type: z.literal('transition'),
    to: PhaseName,
    rationale: z.string(),
  }),
  z.object({
    type: z.literal('answer_question'),
    question: z.string(),
    answer: z.string(),
    topicClassification: z.enum(['on_topic', 'off_topic']),
    rationale: z.string(),
    // I7/F-30 (ADR-016, D9): append-only optional flag marking that this question
    // arrived as a SERVER-captured spoken turn (not typed). The web surface renders
    // the learner side as a spoken bubble when set; absent → typed (fail-safe
    // default). No existing sender/payload is reshaped.
    spoken: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('no_action'),
    reason: z.enum(['wait_for_learner', 'thinking', 'agent_unsure']),
    rationale: z.string(),
  }),
]);
export type Action = z.infer<typeof Action>;

/** The canonical safe fallback the server emits when an agent output fails
 *  validation (ADR-005: retry once, then no_action). */
export function noAction(
  reason: 'wait_for_learner' | 'thinking' | 'agent_unsure',
  rationale: string,
): Action {
  return { type: 'no_action', reason, rationale };
}
