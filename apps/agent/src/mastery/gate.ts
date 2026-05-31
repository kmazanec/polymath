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
 *   - BKT for EVERY lesson KC ≥ `bktMasteryThreshold`
 *
 * BKT check is FAIL-CLOSED on empty: an empty `bktByKc` map (no KCs practiced, or
 * a lesson with no KCs declared) is treated as a failure — a learner with no
 * evidence cannot be declared mastery-ready. This is the mirror of the
 * pre-seeding in `deriveState`: every KC starts at prior (< threshold), so an
 * untouched KC always blocks.
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

  // BUG 1 FIX: require EVERY KC in the lesson to have cleared the mastery threshold,
  // not just the single highest-confidence KC. The old `Math.max` check let a learner
  // who practiced only AND (which hits 0.96 after 2 corrects from a 0.3 prior) pass
  // the gate while OR and NOT sat at their untouched prior (~0.3). The new check is
  // an ALL-quantifier: every entry in `bktByKc` must reach threshold.
  //
  // Fail-closed on empty: if `bktByKc` is empty (no KCs at all), block. In the
  // normal path `deriveState` pre-seeds every KC at prior, so an empty map only
  // occurs if a caller constructs a hand-built `LearnerState` with no KCs — which
  // is also a gate-failure, not a pass.
  const kcValues = Object.values(state.bktByKc);
  const allKcsMastered =
    kcValues.length > 0 && kcValues.every((p) => p >= config.bktMasteryThreshold);
  if (!allKcsMastered) blockers.push('bkt_below_threshold');

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
