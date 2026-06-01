import { Action, noAction } from '@polymath/contract';

/**
 * REPAIR an item-bearing practice mount whose `visibleReps` is empty or omits the
 * component's OWN rep, so the learner-facing workspace is always renderable (B12).
 *
 * The contract's `visibleReps: z.array(Rep)` permits `[]` (no `.min(1)`), so a
 * Zod-valid LLM proposal can ship an item-bearing mount that excludes its OWN rep —
 * and every rep component renders `null` when its rep isn't in `visibleReps` (the
 * probe-integrity rule). The result is a BLANK workspace (no inputs, no Submit) that
 * dead-ends the learner (B12, same class as B7). "The server never trusts the agent":
 * such a proposal must not cross the wire.
 *
 * We PREFER repair over rejection (inject the own rep, preserving any other reps the
 * agent intended to show) so the learner keeps moving rather than dead-ending. Only
 * the three plain practice kinds are repaired:
 *   TruthTablePractice → must include 'truth_table'
 *   CircuitBuilder     → must include 'circuit'
 *   PseudocodeChallenge→ must include 'pseudocode'
 * TransferProbe is deliberately EXCLUDED: its `visibleReps` is an intentional
 * held-out subset (the probed rep may be hidden by design), so forcing its own rep
 * in would break the transfer measurement — its renderability is governed by its own
 * bank semantics. Non-item-bearing actions pass through unchanged.
 */
export function repairVisibleReps(action: Action): Action {
  if (action.type !== 'mount') return action;
  const component = action.component;
  // Switch (not a spread on the union) so TypeScript keeps each kind's discriminant
  // narrowed — a `{...component, visibleReps}` spread widens back to the bare union.
  switch (component.kind) {
    case 'TruthTablePractice':
      return component.visibleReps.includes('truth_table')
        ? action
        : { ...action, component: { ...component, visibleReps: [...component.visibleReps, 'truth_table'] } };
    case 'CircuitBuilder':
      return component.visibleReps.includes('circuit')
        ? action
        : { ...action, component: { ...component, visibleReps: [...component.visibleReps, 'circuit'] } };
    case 'PseudocodeChallenge':
      return component.visibleReps.includes('pseudocode')
        ? action
        : { ...action, component: { ...component, visibleReps: [...component.visibleReps, 'pseudocode'] } };
    default:
      // Non-item-bearing kinds (and TransferProbe, intentionally) pass through.
      return action;
  }
}

/**
 * The server-side Action validation gate (ADR-005 / acceptance criterion 5).
 * Every action the inner agent proposes is validated against the locked Zod
 * schema *before it crosses the wire*. A malformed action is downgraded to a
 * safe `no_action` rather than sent — the validator does not trust the agent.
 *
 * (ADR-005's "retry once, then no_action" lives at the LLM-call layer in F-05;
 *  F-01's stub never produces malformed output, so this is the final guard.)
 *
 * B12: after Zod shaping, an item-bearing practice mount is repaired so its
 * `visibleReps` always includes its own rep — a Zod-valid `visibleReps: []` (or one
 * missing the own rep) would otherwise render a blank, dead-end workspace. This runs
 * at the universal outbound chokepoint, so EVERY arm (LLM / deterministic / reflex)
 * is covered.
 */
export function validateOutboundAction(candidate: unknown): {
  action: Action;
  downgraded: boolean;
} {
  const parsed = Action.safeParse(candidate);
  if (parsed.success) {
    return { action: repairVisibleReps(parsed.data), downgraded: false };
  }
  return {
    action: noAction(
      'agent_unsure',
      `agent emitted a malformed action; downgraded to no_action (${parsed.error.issues.length} schema issue(s))`,
    ),
    downgraded: true,
  };
}
