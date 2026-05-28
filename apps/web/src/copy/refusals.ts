import type { Rep } from '@polymath/contract';

/**
 * The three explicit refusals (ADR-005). Kept in one place so the demo can point
 * at the exact words the interface uses to *refuse*, and so the mastery-without-
 * conditions refusal (F-12) reuses the same source. The copy is warm and
 * explanatory, never adversarial — it tells the learner *why* the interface is
 * holding firm, not just that it is.
 */

const REP_LABEL: Record<Rep, string> = {
  truth_table: 'truth table',
  circuit: 'circuit',
  pseudocode: 'pseudocode',
};

/** Refusal #2 — during a transfer check, the interface keeps the held-out rep
 *  off even if the learner asks for it back. */
export function transferRepRefusal(hiddenRep: Rep): string {
  return (
    `During the transfer check, I'm keeping the ${REP_LABEL[hiddenRep]} view off so you're ` +
    `showing me you can do this yourself. We can review it together right after.`
  );
}

/** Refusal #1 — the interface won't end an item until the learner acts. */
export const MID_ITEM_REFUSAL =
  "Take your time — I won't move on from this item until you submit, skip, or ask for a hint.";

/** Refusal #3 — mastery is not declared until all conditions are met (F-12 uses this). */
export const MASTERY_WITHOUT_CONDITIONS_REFUSAL =
  "You're close, but I can't mark this mastered yet — there's a transfer check and a short " +
  "explain-back to go. That's how we make 'mastered' mean something.";
