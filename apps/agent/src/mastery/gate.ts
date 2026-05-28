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
  transferPassed: boolean;
  explainBackPassed: boolean;
  topicGuardrailClean: boolean;
}

export function isMastered(_state: LearnerState, _config: MasteryConfig): boolean {
  // Stub — F-09/F-12 implement the real predicate against the locked inputs.
  return false;
}
