import { type BKTConfig, type BKTParams, initBKT, updateBKT } from '@polymath/bkt';
import { scoreEquivalence } from '@polymath/booleans';
import type { LessonContent, MasteryConfig, RepSubmission } from '@polymath/contract';
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
  /** The learner's submitted canonical expression. For truth tables this echoes
   *  the target expression; the output column lives in `repSubmission.cells`. */
  submission?: string;
  /** The learner's representation-native answer, when the client supplied one. */
  repSubmission?: RepSubmission;
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
  /** F-12: for a `learner_question` turn, whether the AGENT's `answer_question`
   *  Action was tagged `off_topic`. Counts the agent's off-topic ANSWERS (not the
   *  learner's questions) toward the topic-guardrail budget — a correctly-refused
   *  off-topic question still produces an `off_topic` answer and so is counted. */
  offTopic?: boolean;
}

/** The derived per-session state: one BKT per KC + the session-level aggregates
 *  the rule-gate consumes. `kcOf` maps an item to its knowledge component. */
export interface DerivedState {
  bktByKc: Record<string, BKTParams>;
  consecutiveCorrect: number;
  /** Consecutive correct submissions at the lesson's hardest difficulty tier ONLY.
   *  This is the value `toLearnerState` maps to `LearnerState.consecutiveCorrectAtHardestTier`;
   *  `consecutiveCorrect` (the tier-blind count) is preserved because `server.ts`
   *  reads it directly for the diagnostic snapshot. */
  consecutiveCorrectAtHardestTier: number;
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
  /** F-12: count of off-topic ANSWERS the agent gave this session (the topic-guardrail
   *  counter). Computed from the bounded full-event fold, never `recentHistory`. */
  offTopicCount: number;
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
 *  (the shared `scoreEquivalence` — var-capped, parse-safe). Identifies the item
 *  by `itemId` matched against the lesson's itemId OR targetExpression. Unknown
 *  item / unparseable / over-cap → false. The single source of truth for
 *  correctness — never the client's `submit.correct` flag. */
export function recomputeCorrect(
  lesson: LessonContent,
  itemId: string | undefined,
  submission: string | undefined,
  repSubmission?: RepSubmission,
): boolean {
  if (!itemId) return false;
  const item = lesson.items.find((i) => i.itemId === itemId || i.targetExpression === itemId);
  if (!item) return false;
  if (repSubmission?.rep === 'truth_table') {
    const expected = item.truthTable;
    return (
      repSubmission.cells.length === expected.length &&
      repSubmission.cells.every((cell, index) => cell === expected[index])
    );
  }
  if (submission === undefined) return false;
  return scoreEquivalence(submission, item.targetExpression);
}

/** Fold the session's events into the derived state. `lesson` maps items → KCs. */
export function deriveState(
  events: LoggedEvent[],
  lesson: LessonContent,
  config: MasteryConfig,
): DerivedState {
  const cfg = bktConfig(config);
  const kcByItem = new Map<string, string>();
  const tierByItem = new Map<string, number>();
  for (const item of lesson.items) {
    kcByItem.set(item.itemId, item.kc);
    kcByItem.set(item.targetExpression, item.kc); // the web names items by expression
    tierByItem.set(item.itemId, item.difficultyTier);
    tierByItem.set(item.targetExpression, item.difficultyTier);
  }

  // The hardest difficulty tier in the lesson. Used to gate `consecutiveCorrectAtHardestTier`.
  // Guard the empty-items edge case (fail closed: 0 keeps every submit below maxTier = 0
  // so no submit can satisfy the tier check — the gate blocks, which is correct for a
  // misconfigured/empty lesson).
  const maxTier = lesson.items.length > 0
    ? Math.max(...lesson.items.map((i) => i.difficultyTier))
    : 0;

  // Correctness is the server-side recompute (never the client flag), shared with
  // the per-turn `recomputeCorrect` used by the server.
  const isCorrect = (
    itemId: string | undefined,
    submission: string | undefined,
    repSubmission?: RepSubmission,
  ): boolean => recomputeCorrect(lesson, itemId, submission, repSubmission);

  // BUG 1 FIX (half here): pre-seed bktByKc with the BKT prior for EVERY KC declared
  // in the lesson. Without this, a KC the learner never attempts is absent from the
  // map, and evaluateRuleGate's all-KC check would only see the practiced subset —
  // silently ignoring unpracticed KCs. A KC at prior (≈ 0.3) is well below the 0.95
  // threshold and BLOCKS the gate, which is correct: the learner has not demonstrated
  // mastery of a KC they've never practiced.
  const bktByKc: Record<string, BKTParams> = {};
  for (const kc of lesson.knowledgeComponents) {
    bktByKc[kc] = initBKT(cfg);
  }

  const state: DerivedState = {
    bktByKc,
    consecutiveCorrect: 0,
    consecutiveCorrectAtHardestTier: 0,
    hintsUsed: 0,
    hintsByItem: {},
    missesByItem: {},
    submits: 0,
    retries: 0,
    responseTimesMs: [],
    transferPassed: false,
    offTopicCount: 0,
    explainBackPassed: false,
  };
  /** Items the learner has previously gotten WRONG — a later submit on one of
   *  these is a retry. (Re-seeing an already-correct item is spaced practice, not
   *  a retry; only a repeat after a miss counts against the retry ratio.) */
  const missed = new Set<string>();

  for (const ev of events) {
    if (ev.kind === 'submit') {
      state.submits++;
      const correct = isCorrect(ev.itemId, ev.submission, ev.repSubmission);
      const kc = ev.itemId ? kcByItem.get(ev.itemId) : undefined;
      if (kc) {
        // bktByKc is pre-seeded for all lesson KCs; for an item whose KC appears in
        // the lesson we always have an existing entry — `?? initBKT(cfg)` is a
        // belt-and-suspenders fallback for an item whose kc is NOT in knowledgeComponents
        // (a content authoring mistake; the validator should catch it, but we degrade
        // gracefully rather than crashing).
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

      // BUG 2 FIX: track hardest-tier consecutive correct separately from the
      // tier-blind `consecutiveCorrect`. The rules:
      //   - Correct at hardest tier   → increment.
      //   - Incorrect at hardest tier → reset to 0.
      //   - Any result at a LOWER tier → NEUTRAL (no increment, no reset).
      //     Rationale: easier practice between hard items is a normal spacing pattern;
      //     it should not penalise the learner by erasing hard-tier evidence. We only
      //     credit and debit this counter at the tier that actually matters for the gate.
      //   - A served hint resets it (see the request_hint branch below, mirroring the
      //     tier-blind streak's hint-reset).
      // For a single-tier lesson (L1: maxTier === 1 === every item's tier) this
      // counter behaves identically to `consecutiveCorrect` — no regression for L1.
      const itemTier = ev.itemId !== undefined ? (tierByItem.get(ev.itemId) ?? 0) : 0;
      if (itemTier === maxTier) {
        state.consecutiveCorrectAtHardestTier = correct
          ? state.consecutiveCorrectAtHardestTier + 1
          : 0;
      }
      // Lower-tier submits: leave consecutiveCorrectAtHardestTier unchanged.
    } else if (ev.kind === 'request_hint') {
      // Only count a hint the agent actually SERVED (mounted a HintCard). A
      // request refused during a transfer probe (no_action) must not poison the
      // gate — it neither increments hintsUsed nor breaks the streak.
      if (ev.hintMounted) {
        state.hintsUsed++;
        if (ev.itemId) state.hintsByItem[ev.itemId] = (state.hintsByItem[ev.itemId] ?? 0) + 1;
        state.consecutiveCorrect = 0; // a hinted item doesn't count toward the streak
        // A served hint resets the hardest-tier streak too — a learner who needed a
        // hint has NOT demonstrated fluent unassisted retrieval at that item, regardless
        // of tier. (We do not check the item's tier here: a hint at ANY tier breaks the
        // "no hint" sub-condition of the streak, mirroring ADR-011's hint-reset rule.)
        state.consecutiveCorrectAtHardestTier = 0;
      }
    } else if (ev.kind === 'transfer_submitted') {
      if (ev.transferCorrect === true) state.transferPassed = true;
    } else if (ev.kind === 'learner_question') {
      // F-12 topic-guardrail: count the off-topic ANSWERS the agent gave (the
      // persisted `answer_question` Action tagged `off_topic`), not the learner's
      // questions. A correctly-refused off-topic question still yields an off_topic
      // answer and is counted (budget guards against an agent that keeps engaging
      // off-topic content).
      if (ev.offTopic === true) state.offTopicCount++;
    } else if (ev.kind === 'explain_back_recording_ended') {
      // F-11→F-12 seam. Server-derived (never a client flag): only a PASSING
      // persisted verdict flips this. Latch the pass; never un-set it (a
      // re-recording the judge later fails shouldn't revoke a real pass).
      // Fail-closed: a failing/absent verdict leaves it false → the gate blocks.
      if (ev.explainBackPassed === true) state.explainBackPassed = true;
    }
  }

  return state;
}

/** Project the derived state into the rule-gate's `LearnerState` input. `hintsUsedInLastN`
 *  uses the total hint count as a conservative proxy (the window is N items; at L1
 *  scale the session is short, so total ≈ window). */
export function toLearnerState(derived: DerivedState, config: MasteryConfig): LearnerState {
  const bktByKc: Record<string, number> = {};
  for (const [kc, params] of Object.entries(derived.bktByKc)) bktByKc[kc] = params.pMastered;
  const items = Math.max(1, derived.submits);
  return {
    bktByKc,
    // BUG 2 FIX: map the tier-filtered counter, not the tier-blind `consecutiveCorrect`.
    // `consecutiveCorrect` is preserved on DerivedState for server.ts's diagnostic snapshot;
    // the gate reads only the hardest-tier count.
    consecutiveCorrectAtHardestTier: derived.consecutiveCorrectAtHardestTier,
    hintsUsedInLastN: derived.hintsUsed,
    responseTimesMs: derived.responseTimesMs,
    hintRatio: derived.hintsUsed / items,
    retryRatio: derived.retries / items,
    transferPassed: derived.transferPassed,
    // F-11: derived from a persisted PASSING explain-back verdict (fail closed —
    // false with no verdict). F-12 reads this in the full mastery gate.
    explainBackPassed: derived.explainBackPassed,
    // F-12: the agent's off-topic ANSWERS must stay within the lesson's budget.
    // (Was hardcoded `true` — a fail-OPEN landmine; now computed.)
    topicGuardrailClean: derived.offTopicCount <= config.topicGuardrailBudget,
  };
}
