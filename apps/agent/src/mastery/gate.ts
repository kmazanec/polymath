import type { MasteryConfig } from '@polymath/contract';

/**
 * The mastery gate predicate (ADR-011). Its *inputs* (`LearnerState`,
 * `MasteryConfig`) are the locked contract; F-09 implements the rule-gate + BKT
 * body and F-12 adds the transfer + explain-back conditions. F-01 ships the
 * signature with a stub that always returns `false` (no learner can be mastered
 * by the walking skeleton).
 */
export interface LearnerState {
  /** BKT P(mastered) per knowledge component. */
  bktByKc: Record<string, number>;
  consecutiveCorrectAtHardestTier: number;
  hintsUsedInLastN: number;
  responseTimesMs: number[];
  /** Overall behavioral aggregates (the "poison flags"): hints/items and retries/items. */
  hintRatio: number;
  retryRatio: number;
  transferPassed: boolean;
  explainBackPassed: boolean;
  topicGuardrailClean: boolean;
}

/** The rule-gate decision: did the learner clear the behavioral + BKT bar that
 *  makes them eligible for a transfer probe? `blockers` names each failed
 *  condition so the agent's emission rationale (and the demo) can show *why*. */
export interface RuleGateResult {
  passed: boolean;
  blockers: RuleGateBlocker[];
}

export type RuleGateBlocker =
  | 'insufficient_consecutive_correct'
  | 'hints_used'
  | 'response_time_out_of_band'
  | 'hint_ratio_exceeded'
  | 'retry_ratio_exceeded'
  | 'bkt_below_threshold';

/** Median of a numeric list (0 for empty). */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * The rule-gate (ADR-011): the deterministic, behavioral half of mastery. It is
 * the predicate the agent reads to decide *when* to fire a transfer probe — it is
 * NOT mastery itself (that also requires the transfer pass + explain-back, F-12).
 *
 * All conditions must hold:
 *   - ≥ `consecutiveCorrectAtHardestTier` consecutive correct at the hardest tier
 *   - ≤ `hintsUsedInLastN_items` hints used in the recent window
 *   - median response time within `[responseTimeFloorMs, responseTimeCeilingMs]`
 *   - hint ratio ≤ `hintRatioMax`, retry ratio ≤ `retryRatioMax`
 *   - BKT for the highest-confidence KC ≥ `bktMasteryThreshold`
 */
export function evaluateRuleGate(state: LearnerState, config: MasteryConfig): RuleGateResult {
  const blockers: RuleGateBlocker[] = [];

  if (state.consecutiveCorrectAtHardestTier < config.consecutiveCorrectAtHardestTier) {
    blockers.push('insufficient_consecutive_correct');
  }
  if (state.hintsUsedInLastN > config.hintsUsedInLastN_items) {
    blockers.push('hints_used');
  }
  // Response-time band (ADR-011 anti-gaming): the gate requires at least
  // `consecutiveCorrectAtHardestTier` timed submissions whose median is in-band.
  // Missing timings do NOT pass by default — a client that omits `responseTimeMs`
  // (or hasn't submitted enough timed items yet) is blocked, closing the bypass
  // where a scripted client skips timings to dodge the floor.
  if (state.responseTimesMs.length < config.consecutiveCorrectAtHardestTier) {
    blockers.push('response_time_out_of_band');
  } else {
    const med = median(state.responseTimesMs);
    if (med < config.responseTimeFloorMs || med > config.responseTimeCeilingMs) {
      blockers.push('response_time_out_of_band');
    }
  }
  if (state.hintRatio > config.hintRatioMax) blockers.push('hint_ratio_exceeded');
  if (state.retryRatio > config.retryRatioMax) blockers.push('retry_ratio_exceeded');

  const bestBkt = Math.max(0, ...Object.values(state.bktByKc));
  if (bestBkt < config.bktMasteryThreshold) blockers.push('bkt_below_threshold');

  return { passed: blockers.length === 0, blockers };
}

/** The four top-level mastery conditions (ADR-011). Rule-gate sub-blockers
 *  (`RuleGateBlocker`) fold under the single `'rule_gate_failed'` bucket so the
 *  mastery union stays the coarse demo-facing set AC#3 logs (greppable). */
export type MasteryBlocker =
  | 'rule_gate_failed'
  | 'transfer_not_passed'
  | 'explain_back_not_passed'
  | 'topic_guardrail_exceeded';

export interface MasteryGateResult {
  passed: boolean;
  blockers: MasteryBlocker[];
}

/**
 * The full mastery gate (ADR-011, F-12): the conjunction of all four conditions,
 * with a NAMED blocker for each unmet one so the agent's emission rationale, the
 * server's earned-it rejection log (AC#3), and the demo can show *why* mastery was
 * refused. The conditions are exactly what `isMastered` enforced before — this
 * surfaces the blockers without changing the verdict:
 *   - rule-gate (the behavioral + BKT half) → `rule_gate_failed`
 *   - the held-out transfer pass (when `requireHandCuratedTransfer`) → `transfer_not_passed`
 *   - the voice explain-back pass (when `requireExplainBackPass`) → `explain_back_not_passed`
 *   - a clean topic-guardrail → `topic_guardrail_exceeded`
 *
 * FAIL-CLOSED: a missing/false input (e.g. an unpersisted explain-back verdict →
 * `explainBackPassed:false`, or a dirty guardrail) is a BLOCKER, never a pass.
 * Deterministic: a pure function of `(state, config)`.
 */
export function evaluateMasteryGate(state: LearnerState, config: MasteryConfig): MasteryGateResult {
  const blockers: MasteryBlocker[] = [];

  if (!evaluateRuleGate(state, config).passed) blockers.push('rule_gate_failed');
  if (config.requireHandCuratedTransfer && !state.transferPassed) blockers.push('transfer_not_passed');
  if (config.requireExplainBackPass && !state.explainBackPassed) blockers.push('explain_back_not_passed');
  if (!state.topicGuardrailClean) blockers.push('topic_guardrail_exceeded');

  return { passed: blockers.length === 0, blockers };
}

/**
 * The boolean mastery predicate. Kept as a one-line delegate over
 * `evaluateMasteryGate` so the boolean signature `server.ts` + `gate.test.ts`
 * depend on is preserved while the named blockers live in one place (BUILD-PLAN
 * decision #5: sibling + delegate, do NOT replace).
 */
export function isMastered(state: LearnerState, config: MasteryConfig): boolean {
  return evaluateMasteryGate(state, config).passed;
}
