import { type BKTConfig, type BKTParams, initBKT, updateBKT } from '@polymath/bkt';
import type { LessonContent, MasteryConfig } from '@polymath/contract';
import type { LearnerState } from './gate.js';

/**
 * The single writer of derived learner state (ADR-009/011). It folds a session's
 * raw event log into the per-KC BKT + behavioral aggregates the rule-gate reads.
 * No other feature writes these — F-06's hint count, F-07's transfer pass, and
 * F-05's submits all flow through here. Kept as a pure reducer (compute the next
 * state from the events) so it is unit-testable; the DB read/write is a thin shell
 * around it (`persistLearnerState`).
 */

/** A minimal projection of the relevant fields from a logged event's payload. */
export interface LoggedEvent {
  kind: string;
  /** The item the event concerns (canonical expression or itemId). */
  itemId?: string;
  /** Client-computed correctness on a `submit`. */
  correct?: boolean;
  /** Server-computed transfer verdict on a `transfer_submitted`. */
  transferCorrect?: boolean;
  /** Milliseconds the learner took (when available). */
  responseTimeMs?: number;
}

/** The derived per-session state: one BKT per KC + the session-level aggregates
 *  the rule-gate consumes. `kcOf` maps an item to its knowledge component. */
export interface DerivedState {
  bktByKc: Record<string, BKTParams>;
  consecutiveCorrect: number;
  hintsUsed: number;
  submits: number;
  retries: number;
  responseTimesMs: number[];
  transferPassed: boolean;
}

function bktConfig(config: MasteryConfig): BKTConfig {
  return {
    prior: config.bktPrior_L0,
    transition: config.bktTransition_T,
    guess: config.bktGuess_G,
    slip: config.bktSlip_S,
  };
}

/** Fold the session's events into the derived state. `lesson` maps items → KCs. */
export function deriveState(
  events: LoggedEvent[],
  lesson: LessonContent,
  config: MasteryConfig,
): DerivedState {
  const cfg = bktConfig(config);
  const kcByItem = new Map<string, string>();
  for (const item of lesson.items) {
    kcByItem.set(item.itemId, item.kc);
    kcByItem.set(item.targetExpression, item.kc); // the web names items by expression
  }

  const state: DerivedState = {
    bktByKc: {},
    consecutiveCorrect: 0,
    hintsUsed: 0,
    submits: 0,
    retries: 0,
    responseTimesMs: [],
    transferPassed: false,
  };
  /** Items the learner has previously gotten WRONG — a later submit on one of
   *  these is a retry. (Re-seeing an already-correct item is spaced practice, not
   *  a retry; only a repeat after a miss counts against the retry ratio.) */
  const missed = new Set<string>();

  for (const ev of events) {
    if (ev.kind === 'submit') {
      state.submits++;
      const kc = ev.itemId ? kcByItem.get(ev.itemId) : undefined;
      if (kc) {
        const prior = state.bktByKc[kc] ?? initBKT(cfg);
        state.bktByKc[kc] = updateBKT(prior, ev.correct === true, cfg);
      }
      if (ev.itemId && missed.has(ev.itemId)) state.retries++;
      if (ev.itemId) {
        if (ev.correct === false) missed.add(ev.itemId);
        else missed.delete(ev.itemId); // a correct attempt clears the miss
      }
      if (typeof ev.responseTimeMs === 'number') state.responseTimesMs.push(ev.responseTimeMs);
      state.consecutiveCorrect = ev.correct === true ? state.consecutiveCorrect + 1 : 0;
    } else if (ev.kind === 'request_hint') {
      state.hintsUsed++;
      state.consecutiveCorrect = 0; // a hinted item doesn't count toward the streak
    } else if (ev.kind === 'transfer_submitted') {
      if (ev.transferCorrect === true) state.transferPassed = true;
    }
  }

  return state;
}

/** Project the derived state into the rule-gate's `LearnerState` input. `hintsUsedInLastN`
 *  uses the total hint count as a conservative proxy (the window is N items; at L1
 *  scale the session is short, so total ≈ window). */
export function toLearnerState(derived: DerivedState): LearnerState {
  const bktByKc: Record<string, number> = {};
  for (const [kc, params] of Object.entries(derived.bktByKc)) bktByKc[kc] = params.pMastered;
  const items = Math.max(1, derived.submits);
  return {
    bktByKc,
    consecutiveCorrectAtHardestTier: derived.consecutiveCorrect,
    hintsUsedInLastN: derived.hintsUsed,
    responseTimesMs: derived.responseTimesMs,
    hintRatio: derived.hintsUsed / items,
    retryRatio: derived.retries / items,
    transferPassed: derived.transferPassed,
    explainBackPassed: false, // F-11/F-12
    topicGuardrailClean: true, // F-12 will compute from the session
  };
}
