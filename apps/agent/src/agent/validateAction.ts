import { Action, noAction } from '@polymath/contract';

/**
 * The server-side Action validation gate (ADR-005 / acceptance criterion 5).
 * Every action the inner agent proposes is validated against the locked Zod
 * schema *before it crosses the wire*. A malformed action is downgraded to a
 * safe `no_action` rather than sent — the validator does not trust the agent.
 *
 * (ADR-005's "retry once, then no_action" lives at the LLM-call layer in F-05;
 *  F-01's stub never produces malformed output, so this is the final guard.)
 */
export function validateOutboundAction(candidate: unknown): {
  action: Action;
  downgraded: boolean;
} {
  const parsed = Action.safeParse(candidate);
  if (parsed.success) {
    return { action: parsed.data, downgraded: false };
  }
  return {
    action: noAction(
      'agent_unsure',
      `agent emitted a malformed action; downgraded to no_action (${parsed.error.issues.length} schema issue(s))`,
    ),
    downgraded: true,
  };
}
