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
  const med = median(state.responseTimesMs);
  if (state.responseTimesMs.length > 0 && (med < config.responseTimeFloorMs || med > config.responseTimeCeilingMs)) {
    blockers.push('response_time_out_of_band');
  }
  if (state.hintRatio > config.hintRatioMax) blockers.push('hint_ratio_exceeded');
  if (state.retryRatio > config.retryRatioMax) blockers.push('retry_ratio_exceeded');

  const bestBkt = Math.max(0, ...Object.values(state.bktByKc));
  if (bestBkt < config.bktMasteryThreshold) blockers.push('bkt_below_threshold');

  return { passed: blockers.length === 0, blockers };
}

/**
 * The full mastery gate (ADR-011): rule-gate AND the transfer pass AND (F-12) the
 * explain-back + topic-guardrail conditions. F-09 implements rule-gate + transfer;
 * F-12 extends the implementation (the signature is locked here).
 */
export function isMastered(state: LearnerState, config: MasteryConfig): boolean {
  const rule = evaluateRuleGate(state, config);
  if (!rule.passed) return false;
  if (config.requireHandCuratedTransfer && !state.transferPassed) return false;
  if (config.requireExplainBackPass && !state.explainBackPassed) return false;
  if (!state.topicGuardrailClean) return false;
  return true;
}
