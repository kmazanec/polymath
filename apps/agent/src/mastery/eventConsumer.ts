import { type BKTConfig, type BKTParams, initBKT, updateBKT } from '@polymath/bkt';
import { equivalent, parse, variables } from '@polymath/booleans';
import type { LessonContent, MasteryConfig } from '@polymath/contract';
import type { LearnerState } from './gate.js';

/** Distinct-variable cap before the 2^n enumeration inside `equivalent` — the same
 *  guard `computeTransferVerdict` uses. Every server-side `equivalent` call on a
 *  client-controlled submission must apply it, or a wide expression blocks the
 *  event loop. */
const MAX_SUBMIT_VARS = 10;

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
  /** The learner's submitted canonical expression — the server recomputes
   *  correctness from this (it does NOT trust a client `correct` flag for the
   *  integrity-critical BKT/streak; ADR-010 the validator is the truth-maker). */
  submission?: string;
  /** Server-computed transfer verdict on a `transfer_submitted`. */
  transferCorrect?: boolean;
  /** Server-computed explain-back verdict on an `explain_back_recording_ended`
   *  (`payload.explainBackVerdict.passed`). Undefined on every other event kind;
   *  a turn with no verdict leaves `explainBackPassed` false (fail closed). */
  explainBackPassed?: boolean;
  /** Milliseconds the learner took (when available). */
  responseTimeMs?: number;
  /** For a `request_hint`: whether the agent actually mounted a HintCard (vs.
   *  refusing with no_action, e.g. during a transfer probe). Only a served hint
   *  counts toward `hintsUsed`/`hintsByItem`. */
  hintMounted?: boolean;
}

/** The derived per-session state: one BKT per KC + the session-level aggregates
 *  the rule-gate consumes. `kcOf` maps an item to its knowledge component. */
export interface DerivedState {
  bktByKc: Record<string, BKTParams>;
  consecutiveCorrect: number;
  hintsUsed: number;
  /** Hints requested per item this session — the authoritative hint-level source
   *  (a capped recent-history window can mis-count and reset the ladder). */
  hintsByItem: Record<string, number>;
  /** Server-recomputed wrong submissions per item this session (the heuristic's
   *  repeated-miss escalation reads this, not the client flag). */
  missesByItem: Record<string, number>;
  submits: number;
  retries: number;
  responseTimesMs: number[];
  transferPassed: boolean;
  /** Whether THIS session has a persisted PASSING explain-back verdict (F-11 → F-12
   *  seam). Init false; flipped true only by a logged `explain_back_recording_ended`
   *  whose server-computed verdict passed. A missing verdict is BLOCK, never a pass. */
  explainBackPassed: boolean;
}

function bktConfig(config: MasteryConfig): BKTConfig {
  return {
    prior: config.bktPrior_L0,
    transition: config.bktTransition_T,
    guess: config.bktGuess_G,
    slip: config.bktSlip_S,
  };
}

/** Server-side correctness of a submission against the item's canonical target
 *  (`booleans.equivalent`, var-capped). Identifies the item by `itemId` matched
 *  against the lesson's itemId OR targetExpression. Unknown item / unparseable /
 *  over-cap → false. The single source of truth for correctness — never the
 *  client's `submit.correct` flag. */
export function recomputeCorrect(
  lesson: LessonContent,
  itemId: string | undefined,
  submission: string | undefined,
): boolean {
  if (!itemId || submission === undefined) return false;
  const item = lesson.items.find((i) => i.itemId === itemId || i.targetExpression === itemId);
  if (!item) return false;
  try {
    if (variables(parse(submission)).length > MAX_SUBMIT_VARS) return false;
    return equivalent(submission, item.targetExpression);
  } catch {
    return false;
  }
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

  // Correctness is the server-side recompute (never the client flag), shared with
  // the per-turn `recomputeCorrect` used by the server.
  const isCorrect = (itemId: string | undefined, submission: string | undefined): boolean =>
    recomputeCorrect(lesson, itemId, submission);

  const state: DerivedState = {
    bktByKc: {},
    consecutiveCorrect: 0,
    hintsUsed: 0,
    hintsByItem: {},
    missesByItem: {},
    submits: 0,
    retries: 0,
    responseTimesMs: [],
    transferPassed: false,
    explainBackPassed: false,
  };
  /** Items the learner has previously gotten WRONG — a later submit on one of
   *  these is a retry. (Re-seeing an already-correct item is spaced practice, not
   *  a retry; only a repeat after a miss counts against the retry ratio.) */
  const missed = new Set<string>();

  for (const ev of events) {
    if (ev.kind === 'submit') {
      state.submits++;
      const correct = isCorrect(ev.itemId, ev.submission);
      const kc = ev.itemId ? kcByItem.get(ev.itemId) : undefined;
      if (kc) {
        const prior = state.bktByKc[kc] ?? initBKT(cfg);
        state.bktByKc[kc] = updateBKT(prior, correct, cfg);
      }
      if (ev.itemId && missed.has(ev.itemId)) state.retries++;
      if (ev.itemId) {
        if (!correct) {
          missed.add(ev.itemId);
          state.missesByItem[ev.itemId] = (state.missesByItem[ev.itemId] ?? 0) + 1;
        } else {
          missed.delete(ev.itemId); // a correct attempt clears the miss
        }
      }
      if (typeof ev.responseTimeMs === 'number') state.responseTimesMs.push(ev.responseTimeMs);
      state.consecutiveCorrect = correct ? state.consecutiveCorrect + 1 : 0;
    } else if (ev.kind === 'request_hint') {
      // Only count a hint the agent actually SERVED (mounted a HintCard). A
      // request refused during a transfer probe (no_action) must not poison the
      // gate — it neither increments hintsUsed nor breaks the streak.
      if (ev.hintMounted) {
        state.hintsUsed++;
        if (ev.itemId) state.hintsByItem[ev.itemId] = (state.hintsByItem[ev.itemId] ?? 0) + 1;
        state.consecutiveCorrect = 0; // a hinted item doesn't count toward the streak
      }
    } else if (ev.kind === 'transfer_submitted') {
      if (ev.transferCorrect === true) state.transferPassed = true;
    } else if (ev.kind === 'explain_back_recording_ended') {
      // Server-derived (never a client flag): only a PASSING persisted verdict flips
      // this. A failing/absent verdict leaves it false → the mastery gate blocks.
      if (ev.explainBackPassed === true) state.explainBackPassed = true;
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
    // F-11: derived from a persisted PASSING explain-back verdict (fail closed —
    // false with no verdict). F-12 reads this in the full mastery gate.
    explainBackPassed: derived.explainBackPassed,
    topicGuardrailClean: true, // F-12 will compute from the session
  };
}
