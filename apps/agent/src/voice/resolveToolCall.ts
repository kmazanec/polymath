import { noAction, type Action } from '@polymath/contract';
import { compileMove } from '../agent/menu.js';
import { validateOutboundAction } from '../agent/validateAction.js';
import { validateLayer2 } from '../agent/layer2.js';
import { rejectUnauthorizedAction } from '../agent/authorizedAction.js';
import { toolCallToTacticalMove } from './realtimeTools.js';
import type { LearnerSnapshot, TransferProbeItem } from '../agent/client.js';
import type { MasteryGateResult } from '../mastery/gate.js';

/**
 * The context the earned-it gate needs to gate a proposed action. Mirrors the
 * three arguments `rejectUnauthorizedAction` requires beyond the action itself.
 */
export interface ResolveVoiceToolCallContext {
  /** Per-KC behavioral snapshot (ruleGatePassed, explainBackPassed, …). */
  learner: LearnerSnapshot;
  /** Full mastery gate evaluation for this turn. Computed once by the caller. */
  gate: MasteryGateResult;
  /** Unseen transfer-bank candidates the learner is eligible for. */
  transferCandidates: TransferProbeItem[] | undefined;
}

/**
 * Resolve a realtime tool-call's arguments into the final gated `Action`.
 *
 * Runs the IDENTICAL validation sequence as the server's main request path
 * (see server.ts around the `validateOutboundAction` / `validateLayer2` /
 * `rejectUnauthorizedAction` block) so the realtime voice path cannot earn a
 * privilege the text path would refuse. The sequence in order:
 *
 *   1. Parse args → `TacticalMove` (malformed → no_action).
 *   2. `compileMove` → wire `Action`.
 *   3. `validateOutboundAction` — Zod shape gate (malformed → no_action).
 *   4. `validateLayer2` — claimedTruthTable recompute (ADR-010 Layer 2).
 *   5. `rejectUnauthorizedAction` — earned-it gate (mastery / transfer probe).
 *   6. Return the validated action.
 *
 * Note: for an ACCEPTED mastery transition the resolver returns the `transition`
 * action (not a MasteryCelebration mount). The server reflex that mints the
 * celebration (with server-sourced conceptsMastered) is the caller's responsibility —
 * the resolver's job is gating the proposal, not the server-side celebration mint.
 */
export function resolveVoiceToolCall(
  args: unknown,
  ctx: ResolveVoiceToolCallContext,
): Action {
  // Step 1: parse args into a TacticalMove. Never throws — malformed → no_action move.
  const move = toolCallToTacticalMove(args);

  // Step 2: compile the tactical move to the wire Action.
  const proposed = compileMove(move);

  // Step 3: Zod shape gate — the same guard validateOutboundAction runs for all paths.
  const { action: shaped } = validateOutboundAction(proposed);

  // Step 4: ADR-010 Layer 2 — independently recompute the claimedTruthTable for any
  // item-generating mount and reject a mismatch. Over-cap expressions are also rejected
  // here (the variable cap prevents a DoS enumeration).
  const layer2 = validateLayer2(shaped);
  if (!layer2.ok) {
    return noAction('agent_unsure', `outbound Layer-2 rejection: ${layer2.detail}`);
  }

  // Step 5: earned-it gate — the server never trusts the agent. A TransferProbe needs
  // ruleGatePassed + a matching unseen bank row; a mastery transition needs the full
  // gate predicate satisfied server-side.
  const rejection = rejectUnauthorizedAction(
    shaped,
    ctx.learner,
    ctx.gate,
    ctx.transferCandidates,
  );
  if (rejection !== null) {
    return noAction('agent_unsure', rejection);
  }

  return shaped;
}
