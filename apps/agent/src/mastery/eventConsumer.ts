import { type BKTConfig, type BKTParams, initBKT, updateBKT } from '@polymath/bkt';
import { MAX_EQUIVALENCE_VARS, parse, scoreEquivalence, truthTable, variables } from '@polymath/booleans';
import type { LessonContent, MasteryConfig, Rep, RepSubmission } from '@polymath/contract';
import type { LearnerState } from './gate.js';

/**
 * The MSB-first output column of `expression`'s truth table, var-capped and
 * parse-safe (BUG-05). Returns null when the expression is unparseable or exceeds
 * the variable cap — the caller then treats the submission as incorrect, never a
 * thrown crash or an event-loop-blocking 2^n enumeration (same triad guard as
 * `scoreEquivalence`). `@polymath/booleans.truthTable` is MSB-first (first variable
 * = most significant bit), matching the client's row order (00, 01, 10, 11).
 */
function expectedOutputColumn(expression: string): number[] | null {
  try {
    if (variables(parse(expression)).length > MAX_EQUIVALENCE_VARS) return null;
    return truthTable(expression).out.map((b) => (b ? 1 : 0));
  } catch {
    return null;
  }
}

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
  /** The learner's representation-native answer, when the client supplied one.
   *  WARNING: `repSubmission.rep` is a CLIENT-declared label and is NOT trusted for
   *  the rep-gating integrity signal — see `mountedRep` below. It is still used for
   *  truth-table cell scoring (the cells are the answer key, not an integrity claim). */
  repSubmission?: RepSubmission;
  /** INTEGRITY (rep-gating): the rep of the practice component the SERVER mounted on
   *  THIS turn (TruthTablePractice → truth_table, CircuitBuilder → circuit,
   *  PseudocodeChallenge → pseudocode); undefined for any non-practice-mount turn.
   *  This is the server's own record of what it presented — the fold binds it to the
   *  item and credits cross-rep evidence from it, never from the client `repSubmission.rep`. */
  mountedRep?: 'truth_table' | 'circuit' | 'pseudocode';
  /** INTEGRITY (rep-gating): the target expression of the mounted practice item, so
   *  the fold can bind the server-trusted `mountedRep` to the item the learner later
   *  submits against (matched on canonical itemId / targetExpression). */
  mountedItemExpression?: string;
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
  /**
   * #1 (requireDifferentRepresentation): the DISTINCT representations the learner
   * has demonstrated CORRECT, UNASSISTED, hardest-tier work in WITHIN the current
   * consecutive-correct ladder run. This is the cross-rep evidence the rule-gate
   * reads when `requireDifferentRepresentation` is true — clearing the streak in
   * one rep alone (e.g. truth_table) is no longer mastery-eligible.
   *
   * It tracks exactly the submissions that are CREDITED to
   * `consecutiveCorrectAtHardestTier`, so it is reset by the SAME events that reset
   * the ladder (a served hint, a wrong hardest-tier submit), and is NOT inflated by
   * a massed identical (item,rep) repeat that #2 declines to credit. It is an
   * INTERNAL agent/server field — it never crosses the wire.
   */
  repsCorrectAtHardestTier: Set<Rep>;
  hintsUsed: number;
  /** Hints requested per item this session — the authoritative hint-level source
   *  (a capped recent-history window can mis-count and reset the ladder). */
  hintsByItem: Record<string, number>;
  /** Server-recomputed wrong submissions per item this session (the heuristic's
   *  repeated-miss escalation reads this, not the client flag). */
  missesByItem: Record<string, number>;
  /** Server-recomputed set of authored itemIds the learner has submitted CORRECTLY
   *  at least once this session (keyed by the lesson's canonical `itemId`). The
   *  deterministic forward-progress fallback (B7) reads this to find the next
   *  not-yet-passed authored item — it is the single source of truth for "which
   *  items are done", never a client flag or a capped history window. */
  passedItemIds: Set<string>;
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
  // BUG-05: the web client names the item by the expression the agent DISPLAYED
  // (`spec.expression`, e.g. "A AND B"), which is logically equivalent to but NOT
  // string-equal to the authored item's `targetExpression` (e.g. "B AND A"). The
  // old code required the item lookup to succeed and returned false otherwise — so
  // EVERY correct answer was scored wrong and no learner could ever progress. The
  // correctness key is the expression the learner was actually shown: prefer the
  // matched item's authored target (when found), else fall back to `itemId` itself
  // (the displayed expression). The two are equivalent by construction; either
  // produces the same truth table / equivalence verdict.
  const canonical = item?.targetExpression ?? itemId;
  if (repSubmission?.rep === 'truth_table') {
    // Score against the truth table of the canonical expression (var-capped,
    // parse-safe). When the item is found we could read `item.truthTable`, but
    // computing from the expression handles the lookup-miss case uniformly and
    // stays correct because the displayed expression is equivalent to the authored
    // one. An unparseable/over-cap expression → null → incorrect (never a crash).
    const expected = item?.truthTable ?? expectedOutputColumn(canonical);
    if (!expected) return false;
    return (
      repSubmission.cells.length === expected.length &&
      repSubmission.cells.every((cell, index) => cell === expected[index])
    );
  }
  if (submission === undefined) return false;
  return scoreEquivalence(submission, canonical);
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
  // Canonicalize either an itemId OR a targetExpression (the web names items by
  // expression) back to the lesson's canonical `itemId` — so `passedItemIds` is
  // keyed consistently regardless of how the client referenced the item.
  const canonicalItemId = new Map<string, string>();
  for (const item of lesson.items) {
    kcByItem.set(item.itemId, item.kc);
    kcByItem.set(item.targetExpression, item.kc); // the web names items by expression
    tierByItem.set(item.itemId, item.difficultyTier);
    tierByItem.set(item.targetExpression, item.difficultyTier);
    canonicalItemId.set(item.itemId, item.itemId);
    canonicalItemId.set(item.targetExpression, item.itemId);
  }

  // BUG-05: the web client names an item by the expression the agent DISPLAYED
  // (`spec.expression`, e.g. "A AND B"), which is logically equivalent to — but not
  // string-equal to — the authored `targetExpression` (e.g. "B AND A"). An exact
  // string lookup then misses, so the KC/tier/canonical-id resolution silently
  // failed: BKT never updated for the right KC and the item was never marked passed,
  // so mastery was unreachable even once correctness scored right. `resolveItemId`
  // first tries the exact maps, then falls back to matching the displayed expression
  // to a lesson item by LOGICAL EQUIVALENCE (var-capped, parse-safe). The result is
  // memoized so we never re-enumerate truth tables for a repeated submit. Returns the
  // raw id unchanged when nothing matches (a genuinely unknown item degrades exactly
  // as before — no KC credit). Cheap: lesson items are ≤ a handful.
  const resolvedIdCache = new Map<string, string>();
  const resolveItemId = (rawItemId: string): string => {
    if (canonicalItemId.has(rawItemId)) return canonicalItemId.get(rawItemId)!;
    const cached = resolvedIdCache.get(rawItemId);
    if (cached !== undefined) return cached;
    const match = lesson.items.find((i) => scoreEquivalence(rawItemId, i.targetExpression));
    const resolved = match?.itemId ?? rawItemId;
    resolvedIdCache.set(rawItemId, resolved);
    return resolved;
  };

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
    repsCorrectAtHardestTier: new Set<Rep>(),
    hintsUsed: 0,
    hintsByItem: {},
    missesByItem: {},
    passedItemIds: new Set<string>(),
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

  // #2 (spacing / anti-massing): the (canonicalItemId, rep) of the immediately
  // preceding submit at the HARDEST tier. A correct hardest-tier submit on the
  // SAME (item, rep) as the one just before it — with no intervening different
  // work — is a massed identical repeat (a memorized answer, not spaced retrieval)
  // and is NOT credited to `consecutiveCorrectAtHardestTier` / the rep set. The
  // ladder must be built from INTERLEAVED items/reps. Reset to undefined whenever
  // the streak resets (a wrong hardest-tier submit or a served hint) so the next
  // correct repeat after a break is once again creditable.
  let lastHardestSubmitKey: string | undefined;

  // INTEGRITY HARDENING (rep-gating): the SERVER-TRUSTED rep most recently mounted for
  // each canonical item, derived from the action the server actually emitted
  // (`mountedRep`/`mountedItemExpression` on the logged turn) — NEVER the client's
  // `repSubmission.rep`. A scripted client can cycle the `repSubmission.rep` label on
  // the same server-mounted item to fake interleaving; the rep-gating evidence (#1) and
  // the #2 massed-repeat key are both credited from THIS map instead, so only the rep
  // the server presented counts. FAIL-CLOSED: a submit whose item has no known mounted
  // rep is treated as the safe single-rep default (truth_table) and is NOT credited a
  // "different" rep — we never credit more reps than the server can prove it mounted.
  const trustedRepByItem = new Map<string, Rep>();

  for (const ev of events) {
    // Bind any practice mount's server-trusted rep to its canonical item BEFORE the
    // submit that answers it (mounts are emitted on the turn preceding the submit, so
    // by the time we process the submit the binding is already recorded).
    if (ev.mountedRep && ev.mountedItemExpression) {
      // BUG-05: resolve the displayed mount expression to the canonical item id
      // (equivalence-tolerant), so the trusted rep binds to the SAME key the submit
      // later resolves to — otherwise cross-rep evidence is credited under the
      // displayed-string key and the submit (keyed canonical) never finds it.
      const canonicalMounted = resolveItemId(ev.mountedItemExpression);
      trustedRepByItem.set(canonicalMounted, ev.mountedRep);
    }

    if (ev.kind === 'submit') {
      state.submits++;
      const correct = isCorrect(ev.itemId, ev.submission, ev.repSubmission);
      // BUG-05: canonicalize the (possibly displayed-expression) itemId to the
      // lesson's item BEFORE every map lookup, so KC/tier/passed/streak all resolve
      // even when the client named the item by an equivalent expression.
      const canonicalId = ev.itemId !== undefined ? resolveItemId(ev.itemId) : undefined;
      const kc = canonicalId ? kcByItem.get(canonicalId) : undefined;
      if (kc) {
        // bktByKc is pre-seeded for all lesson KCs; for an item whose KC appears in
        // the lesson we always have an existing entry — `?? initBKT(cfg)` is a
        // belt-and-suspenders fallback for an item whose kc is NOT in knowledgeComponents
        // (a content authoring mistake; the validator should catch it, but we degrade
        // gracefully rather than crashing).
        const prior = state.bktByKc[kc] ?? initBKT(cfg);
        state.bktByKc[kc] = updateBKT(prior, correct, cfg);
      }
      if (canonicalId && missed.has(canonicalId)) state.retries++;
      if (canonicalId) {
        if (!correct) {
          missed.add(canonicalId);
          state.missesByItem[canonicalId] = (state.missesByItem[canonicalId] ?? 0) + 1;
        } else {
          missed.delete(canonicalId); // a correct attempt clears the miss
          // Record the canonical itemId as passed (B7 forward-progress source).
          state.passedItemIds.add(canonicalId);
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
      const itemTier = canonicalId !== undefined ? (tierByItem.get(canonicalId) ?? 0) : 0;
      if (itemTier === maxTier) {
        if (!correct) {
          // A wrong hardest-tier submit breaks the ladder AND the cross-rep evidence.
          state.consecutiveCorrectAtHardestTier = 0;
          state.repsCorrectAtHardestTier = new Set<Rep>();
          lastHardestSubmitKey = undefined;
        } else {
          // #2 SPACING + INTEGRITY: identify this hardest-tier submit by its canonical
          // item + the SERVER-TRUSTED rep (the rep the server last mounted for this
          // item), NOT the client-declared `repSubmission.rep`. A scripted client that
          // cycles the rep label on the same server-mounted item produces the SAME
          // trusted rep every time → the same (item, rep) key → declined as a massed
          // repeat, and adds no new distinct rep. FAIL-CLOSED: no known mounted rep →
          // truth_table default (the safe single-rep assumption), never a "different"
          // rep we can't prove. A correct submit on the IDENTICAL (item, trusted-rep)
          // as the immediately preceding one is not credited; genuinely interleaved
          // work (a different item, or a rep the server actually mounted) is.
          const canonical = canonicalId ?? '';
          const rep: Rep = trustedRepByItem.get(canonical) ?? 'truth_table';
          const key = `${canonical}::${rep}`;
          if (key !== lastHardestSubmitKey) {
            state.consecutiveCorrectAtHardestTier += 1;
            state.repsCorrectAtHardestTier.add(rep);
            lastHardestSubmitKey = key;
          }
          // else: massed identical repeat — neither increments the ladder nor adds
          // a rep; lastHardestSubmitKey stays the same so a third identical repeat
          // is also declined.
        }
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
        // A served hint also wipes the cross-rep evidence (the demonstrations in
        // the current ladder run were hint-assisted) and the spacing tracker.
        state.repsCorrectAtHardestTier = new Set<Rep>();
        lastHardestSubmitKey = undefined;
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
    // #1: the number of DISTINCT reps demonstrated correct+unassisted at the
    // hardest tier within the current ladder run. The gate reads this when
    // `requireDifferentRepresentation` is true.
    distinctRepsAtHardestTier: derived.repsCorrectAtHardestTier.size,
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
