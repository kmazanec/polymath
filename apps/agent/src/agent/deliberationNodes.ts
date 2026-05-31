/**
 * Pure deliberation-node implementations for the 5-node graph (F-28 / ADR-014).
 *
 * `assess` and `decide` are pure and deterministic — they never call a provider
 * and never read client flags. `realize` delegates to the provider (graph.ts).
 *
 * The heuristic provider (stubClient.ts) IGNORES the deliberation context when
 * choosing its move — this is intentional so the keyless path is byte-identical
 * to the pre-F-28 behaviour. The LLM provider may read it for context.
 */

import type { LearnerSnapshot } from './client.js';
import {
  type DeliberationMemory,
  type LearnerProgress,
  type PedagogicalIntent,
} from './deliberation.js';

/**
 * Classify the learner's current progress from the server-derived snapshot only.
 * Reads only fields on LearnerSnapshot — never any client flag (the TypeScript
 * type itself enforces this; LearnerSnapshot has no `correct` field).
 *
 * Classification precedence (highest to lowest):
 *  1. ready        — rule-gate passed, learner has satisfied the BKT condition
 *  2. over_hinting — hints-to-turns ratio exceeds threshold (hints >= turnCount/2 + 1)
 *  3. stuck        — low consecutive-correct + no meaningful BKT gain
 *  4. guessing     — some consecutive-correct but BKT still low (erratic)
 *  5. progressing  — default: moving forward with at least one consecutive correct
 */
export function assess(snap: LearnerSnapshot, memory: DeliberationMemory): LearnerProgress {
  if (snap.ruleGatePassed) return 'ready';

  // Over-hinting: hints-to-turns ratio too high. Threshold: hints >= (turnCount/2 + 1).
  // On turn 0 this only fires if hintsUsed >= 1 which is impossible without a turn,
  // so this is effectively turnCount >= 2 before it can fire meaningfully.
  const turnCount = memory.turnCount;
  const overHintThreshold = Math.floor(turnCount / 2) + 1;
  if (snap.hintsUsed >= overHintThreshold && snap.hintsUsed > 0) {
    return 'over_hinting';
  }

  // Compute average BKT across all KCs (or 0 if no data yet).
  const bktValues = Object.values(snap.bktByKc);
  const avgBkt = bktValues.length > 0
    ? bktValues.reduce((sum, v) => sum + v, 0) / bktValues.length
    : 0;

  // Stuck: no consecutive correct AND low BKT
  if (snap.consecutiveCorrect === 0 && avgBkt < 0.4) {
    return 'stuck';
  }

  // Guessing: has some consecutive correct but BKT is still low
  // (erratic — sometimes correct but not demonstrating mastery)
  if (snap.consecutiveCorrect >= 1 && avgBkt < 0.4) {
    return 'guessing';
  }

  // Default: progressing
  return 'progressing';
}

/**
 * Decide the advisory pedagogical intent given the learner classification.
 * The heuristic provider ignores this return value; the LLM provider uses it
 * as context. Pure and total.
 */
export function decide(
  classification: LearnerProgress,
  _memory: DeliberationMemory,
): PedagogicalIntent {
  switch (classification) {
    case 'ready':        return 'probe_transfer';
    case 'stuck':        return 'simplify';
    case 'progressing':  return 'practice';
    case 'guessing':     return 'hint';
    case 'over_hinting': return 'rephrase';
  }
}
