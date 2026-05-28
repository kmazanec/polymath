import type { PreconditionReason } from '@polymath/contract';

/**
 * T-11e — stock retry-prompt copy per precondition/judge-fail reason (ADR-010
 * Layer 4a: "the learner sees a stock retry prompt explaining what was missing; no
 * LLM call"). Pure lookup, no LLM. The route re-mounts `ExplainBackPrompt` with the
 * selected copy as its `promptBody` on a rubric fail (AC#8).
 */
const COPY: Record<PreconditionReason, string> = {
  duration_too_short:
    "I didn't quite hear your explanation — please respond and walk me through how you solved it.",
  duration_too_long:
    'That ran a little long — try giving me a tighter explanation in 15 seconds or less.',
  too_few_words:
    'Your response was too short — try again and say a bit more about how you reasoned through it.',
  no_kc_vocab:
    'Try using the logic terms from the lesson — talk about the gates, inputs, and outputs you used.',
  no_item_reference:
    'Try referring to the specific variables in the problem you just solved.',
  judge_unavailable:
    "I couldn't evaluate that one — let's try the explanation again.",
};

/** A generic fallback when no specific reason is available. */
const GENERIC_RETRY =
  "Let's try that explanation again — walk me through how you solved this specific problem.";

/** The stock retry copy for a single precondition/judge reason. */
export function retryPromptFor(reason: PreconditionReason): string {
  return COPY[reason] ?? GENERIC_RETRY;
}

/** The retry copy for the FIRST reason in a verdict's `reasons` list (deterministic),
 *  or the generic fallback when the list is empty. */
export function retryPromptForFirst(reasons: readonly PreconditionReason[]): string {
  const first = reasons[0];
  return first ? retryPromptFor(first) : GENERIC_RETRY;
}
