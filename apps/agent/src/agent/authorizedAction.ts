import type { Action } from '@polymath/contract';
import type { LearnerSnapshot, TransferProbeItem } from './client.js';
import type { MasteryGateResult } from '../mastery/gate.js';

/**
 * Reject an outbound privileged action the learner hasn't earned, regardless of
 * what the agent proposed (the server never trusts the agent — defense for a
 * jailbroken/misbehaving LLM provider). Returns a rejection reason (→ downgrade to
 * `no_action`) or null if authorized:
 *   - a `TransferProbe` mount needs `ruleGatePassed` AND an exact match to an
 *     allowed unseen `transfer_bank` row;
 *   - a `transition` → `mastered` OR a direct `mount MasteryCelebration` (the two
 *     equivalent privileged mastery routes) needs the full mastery predicate satisfied
 *     server-side (the threaded `gate` over the derived state). When explain-back is
 *     unmet the gate cannot pass — a forged mastery transition/celebration is downgraded.
 *
 * Extracted here (rather than living only in server.ts) so both the main request
 * path and the realtime-voice tool-call path can call the SAME predicate. Any drift
 * between them would create a privilege-escalation gap on the voice path.
 */
export function rejectUnauthorizedAction(
  action: Action,
  learner: LearnerSnapshot,
  gate: MasteryGateResult,
  candidates: TransferProbeItem[] | undefined,
): string | null {
  // Both privileged mastery routes get the earned-it gate: the `transition→mastered`
  // proposal AND a DIRECT `mount MasteryCelebration` (a forged/jailbroken provider can
  // emit either — MasteryCelebration is a valid mountable ComponentSpec that passes Zod
  // + passes Layer-2 trivially). The server is the truth-maker, so this rejection path
  // IS the statechart guard. The legitimate celebration is server-minted via the
  // accepted-transition reflex (masteryCelebrationAction) with server-sourced
  // conceptsMastered; any agent-proposed celebration is therefore rejected unless the
  // gate is satisfied — and even then the agent's claimed conceptsMastered are never
  // forwarded.
  const isMasteryTransition = action.type === 'transition' && action.to === 'mastered';
  const isDirectCelebration =
    action.type === 'mount' && action.component.kind === 'MasteryCelebration';
  if (isMasteryTransition || isDirectCelebration) {
    // The full-gate evaluation is computed ONCE per turn by the caller and threaded
    // in (no stale recompute). On rejection, name the blockers so the log records why.
    return gate.passed ? null : `mastery_gate_failed: ${gate.blockers.join(',')}`;
  }
  if (action.type !== 'mount' || action.component.kind !== 'TransferProbe') return null;
  if (!learner.ruleGatePassed) return 'transfer probe before the rule gate passed';
  const c = action.component;
  const match = (candidates ?? []).find(
    (b) =>
      b.itemId === c.itemId &&
      b.targetExpression === c.expression &&
      b.targetRep === c.targetRep &&
      JSON.stringify([...b.hiddenReps].sort()) === JSON.stringify([...c.hiddenReps].sort()),
  );
  return match ? null : 'transfer probe does not match an allowed unseen bank item';
}
