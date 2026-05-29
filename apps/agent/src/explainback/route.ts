import { desc, eq } from 'drizzle-orm';
import type { Action, ClientEvent, ExplainBackVerdict } from '@polymath/contract';
import {
  runExplainBack,
  retryPromptForFirst,
  checkPreconditions,
  type ExplainBackJudge,
  type ProsodyFeatures,
} from '@polymath/graph';
import type { Db } from '../db/client.js';
import { events } from '../db/schema.js';
import type { Lesson } from '../lessons/loader.js';
import { deriveItemTokens, type TransferBankItemRef } from './itemTokens.js';

/**
 * F-11 server route for `explain_back_recording_ended` (ADR-010 Layer 4). This runs
 * the explain-back rubric and is the load-bearing integrity boundary. It does NOT
 * go through `proposeMove` — it's a deterministic server reflex.
 *
 * It:
 *   1. links the event to its most-recent unresolved `ExplainBackPrompt` mount for
 *      this `targetItemId` and reads `maxDurationSec`; CLAMPS the window server-side
 *      (`effectiveDurationMs = min(client.durationMs, maxDurationSec*1000)`, AC#9).
 *      No matching mount → the event is unsolicited → fail closed.
 *   2. derives kcVocabulary (#4, from the lesson — empty fails closed) + item tokens
 *      (#5, var-capped server-side — unknown/forged fails closed) + captured prosody.
 *   3. runs `runExplainBack` (preconditions → judge; fail closed throughout).
 *   4. decides the FAIL-path outbound action (retry `ExplainBackPrompt` with stock
 *      retry copy, escalation, or the attempt-cap no_action), counting prior attempts
 *      for this item from the bounded log and capping at MAX_ATTEMPTS (AC#8).
 *
 * F-11/F-12 SERIAL JOIN (Option A — same-turn mastery celebration): this function no
 * longer persists its own row, and no longer decides the PASS-path action. It returns
 * the verdict + the FAIL-path action + the validation detail to the caller
 * (`handleClientFrame`), which — on a PASS — folds the verdict into the learner state
 * the SAME turn, evaluates the full mastery gate, and (when the gate clears) mints the
 * MasteryCelebration on this very turn instead of returning `no_action`. The caller
 * persists exactly one row carrying `{ explainBackVerdict, gateEvaluation, statechart…,
 * validation }`. `passAction` below is the placeholder PASS action the caller replaces
 * when it continues into the gate; it is only surfaced if the caller chooses not to
 * (e.g. a future code path) — by default the caller always re-derives on a pass.
 */

/** Total explain-back attempts allowed per item before escalation (AC#8: ≤2). */
const MAX_ATTEMPTS = 2;

/** Cap the per-session scan, mirroring server.ts MAX_SESSION_EVENTS. */
const MAX_SESSION_EVENTS = 500;

export interface ExplainBackRouteDeps {
  db: Db;
  /** The LLM judge. Absent (no key) → verdict is `judge_unavailable` (fail closed). */
  judge?: ExplainBackJudge;
  /** Per-session captured prosody for this explain-back utterance (from the WebRTC
   *  bridge). Absent → the judge sees no prosody (never a block on its own). */
  prosodyFor?: (sessionId: string, targetItemId: string) => ProsodyFeatures | undefined;
  /** Server-side authoritative transcript captured by the F-10 WebRTC bridge for
   *  this explain-back utterance. This is the ONLY integrity source for the spoken
   *  content: the bare `explain_back_recording_ended` event is merely the completion
   *  SIGNAL, and the client-supplied `event.transcript` is NEVER used as an integrity
   *  input (CLAUDE.md "server never trusts the client" + "the explain-back is the
   *  integrity boundary"). A client could otherwise POST a crafted transcript and
   *  pass the rubric without ever speaking — a forgery / paid-judge-abuse hole.
   *  Absent (bridge capture not wired / deferred device smoke) → the rubric runs on
   *  an EMPTY transcript → fails CLOSED at precondition #3 (`too_few_words`). The
   *  only non-bridge verdict path is the explicit dev/test `syntheticVerdict` seam
   *  below (NODE_ENV-gated, inert in prod). */
  transcriptFor?: (sessionId: string, targetItemId: string) => string | undefined;
  /** Transfer-bank rows for resolving a probed item's tokens (read-only). */
  transferItems?: TransferBankItemRef[];
  /**
   * F-12 DEV/TEST SEAM (`?testExplainBackVerdict=pass|fail`, `NODE_ENV!=='production'`).
   * The integration tests drive the explain-back turn through this synthetic verdict
   * because the real LLM judge needs an `OPENAI_API_KEY` they don't have in CI. When
   * present, the route SKIPS `runExplainBack` (preconditions + judge) entirely and uses
   * this verdict as the explain-back verdict — so the full mastery path is drivable
   * end-to-end without a key. KEPT-AND-WIRED rather than deleted: the tests still rely
   * on it as their verdict source (the real judge would otherwise fail closed with
   * `judge_unavailable`). The connection handler only sets it when `NODE_ENV!=='production'`,
   * so it is inert in prod (a keyed prod deploy runs the real judge; a keyless one fails
   * closed). Even via this seam the attempt-cap short-circuit still runs first (a synthetic
   * pass cannot farm judge calls, and a synthetic fail still counts an attempt). */
  syntheticVerdict?: ExplainBackVerdict;
}

/** What the route resolves for an `explain_back_recording_ended` turn, returned to
 *  `handleClientFrame` so it can fold the verdict the SAME turn (Option A) and persist
 *  ONE row. The route no longer writes the row itself (it has no learner-state fold and
 *  cannot evaluate the full mastery gate). */
export interface ExplainBackOutcome {
  /** The server-computed explain-back verdict (fail-closed on any unmet precondition,
   *  the attempt cap, or an unavailable judge). The caller folds `.passed` into the
   *  learner state and persists it at `payload.explainBackVerdict`. */
  verdict: ExplainBackVerdict;
  /** The FAIL-path / cap / precondition-fail action (retry mount or escalation
   *  no_action). On a PASS this is a placeholder no_action the caller REPLACES with the
   *  same-turn mastery decision (celebration when the gate clears, else no_action). */
  failPathAction: Action;
  /** Whether the verdict passed — the caller branches on this to decide the same-turn
   *  mastery path vs. forwarding `failPathAction`. */
  passed: boolean;
  /** The Layer-4 validation block the caller persists verbatim (AC#7: full precondition
   *  statuses + judge sub-scores travel in `detail`). */
  validation: {
    layer: 4;
    status: 'pass' | 'reject';
    detail: Record<string, unknown>;
  };
}

/** A single bounded, newest-first scan of the session's events that resolves BOTH
 *  things the route needs from the log in ONE round-trip (previously two identical
 *  `SELECT … LIMIT 500` queries ran serially):
 *    - `maxDurationSec`: the window cap from the most-recent `ExplainBackPrompt`
 *      mount for this item (null → unsolicited event → fail closed).
 *    - `priorAttempts`: how many prior `explain_back_recording_ended` rows this
 *      session already logged for this item (the current event is attempt N+1).
 */
async function scanSession(
  db: Db,
  sessionId: string,
  targetItemId: string,
): Promise<{ maxDurationSec: number | null; priorAttempts: number }> {
  const rows = await db
    .select({ kind: events.kind, payload: events.payload })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(desc(events.ts))
    .limit(MAX_SESSION_EVENTS);

  let maxDurationSec: number | null = null;
  let priorAttempts = 0;
  for (const row of rows) {
    if (row.kind === 'explain_back_recording_ended') {
      const ev = (row.payload as { event?: { targetItemId?: string } })?.event;
      if (ev?.targetItemId === targetItemId) priorAttempts++;
      continue;
    }
    // Newest-first: the first ExplainBackPrompt mount for this item is the one being
    // answered. (A later attempt already resolved an older mount; the attempt cap
    // bounds retries.)
    if (maxDurationSec === null) {
      const action = (row.payload as { action?: { type?: string; component?: { kind?: string; targetItemId?: string; maxDurationSec?: number } } })?.action;
      const c = action?.component;
      if (action?.type === 'mount' && c?.kind === 'ExplainBackPrompt' && c.targetItemId === targetItemId) {
        maxDurationSec = typeof c.maxDurationSec === 'number' && c.maxDurationSec > 0 ? c.maxDurationSec : 15;
      }
    }
  }
  return { maxDurationSec, priorAttempts };
}

/**
 * Resolve an `explain_back_recording_ended` frame: run the rubric (or honor the
 * dev/test synthetic verdict), decide the FAIL-path action, and RETURN the verdict +
 * validation to the caller. It no longer persists a row or decides the PASS-path
 * action — `handleClientFrame` owns the single persisted row and, on a PASS, the
 * same-turn mastery decision (Option A serial join). See `ExplainBackOutcome`.
 */
export async function handleExplainBack(
  deps: ExplainBackRouteDeps,
  event: Extract<ClientEvent, { kind: 'explain_back_recording_ended' }>,
  lesson: Lesson,
): Promise<ExplainBackOutcome> {
  const { db } = deps;

  // (1) ONE bounded scan resolves both the prompt-mount window cap (AC#9) and the
  // prior-attempt count. An unsolicited event (no matching prompt) is fail-closed:
  // treat the window as 0 so precondition #1 (duration ≥3s) trips — a client cannot
  // fabricate a verdict without a real prompt.
  const { maxDurationSec: mountCap, priorAttempts: prior } = await scanSession(
    db,
    event.sessionId,
    event.targetItemId,
  );
  const mount = mountCap !== null;
  const maxDurationSec = mountCap ?? 15;
  const clampCeiling = maxDurationSec * 1000;
  // A non-finite/negative client value is treated as 0 (fail closed at #1). The
  // clamp means a manipulated client CANNOT extend the window by lying.
  const clientMs = Number.isFinite(event.durationMs) && event.durationMs > 0 ? event.durationMs : 0;
  const effectiveDurationMs = mount ? Math.min(clientMs, clampCeiling) : 0;

  // The attempt count is known BEFORE running the rubric (this is attempt #prior+1).
  const attemptNumber = prior + 1;

  // (2) ATTEMPT-CAP GATE BEFORE THE JUDGE (anti-farming, AC#8 / checklist "a client
  // can't farm judge calls"): once the per-item attempt cap is already spent, do NOT
  // run the rubric at all — the paid LLM judge fires inside runExplainBack whenever
  // the 5 preconditions pass, so a client replaying preconditions-passing frames
  // could amplify into unbounded OpenAI cost. We short-circuit to the escalation
  // no_action WITHOUT a judge call. The verdict is a fail-closed `attempt_cap_reached`
  // (never a pass), so the caller's gate stays blocked. The cap is checked even when a
  // synthetic verdict is supplied — the seam cannot bypass anti-farming.
  if (prior >= MAX_ATTEMPTS) {
    const escalate: Action = {
      type: 'no_action',
      reason: 'wait_for_learner',
      rationale: `explain-back attempt cap (${MAX_ATTEMPTS.toString()}) already reached for ${event.targetItemId}; escalating to practice (judge not run)`,
    };
    return {
      verdict: { passed: false, reasons: ['attempt_cap_reached'] },
      failPathAction: escalate,
      passed: false,
      validation: {
        layer: 4,
        status: 'reject',
        detail: { reasons: ['attempt_cap_reached'], effectiveDurationMs, attemptNumber },
      },
    };
  }

  // (3) Resolve the verdict. The precondition INPUTS are derived server-side either
  // way (the deterministic anti-cheat ALWAYS runs — even on the dev/test seam):
  //   - the bridge transcript is the ONLY integrity source. The client-supplied
  //     `event.transcript` is NEVER trusted (CLAUDE.md "server never trusts the
  //     client" — a client could POST a crafted transcript and pass the rubric
  //     without speaking). Absent bridge transcript → empty → fails CLOSED at #3.
  //   - kcVocabulary empty → #4 fails closed; itemTokens empty (unknown/forged/
  //     over-cap) → #5 fails closed.
  const kcVocabulary = lesson.kcVocabulary;
  const itemTokens = deriveItemTokens(event.targetItemId, lesson, deps.transferItems ?? []);
  const prosody = deps.prosodyFor?.(event.sessionId, event.targetItemId);
  const transcript = deps.transcriptFor?.(event.sessionId, event.targetItemId) ?? '';
  const preconditionInput = {
    transcript,
    durationMs: effectiveDurationMs,
    maxDurationSec,
    kcVocabulary,
    itemTokens,
    ...(prosody ? { prosody } : {}),
  };

  let verdict: ExplainBackVerdict;
  if (deps.syntheticVerdict) {
    // The dev/test seam (`syntheticVerdict`, NODE_ENV-gated by the caller) skips only
    // the paid LLM JUDGE — it does NOT skip the deterministic preconditions, and it
    // requires a non-empty SERVER transcript (CLUSTER D thread 8: a synthetic pass
    // must never fold with an empty/absent transcript). The preconditions run first;
    // a precondition failure FAILS CLOSED with the real reason regardless of what the
    // seam claims. Only when the structural anti-cheat clears is the synthetic verdict
    // honored. (A synthetic FAIL is honored as-is — the seam can always force a fail.)
    const pre = checkPreconditions(preconditionInput);
    if (!deps.syntheticVerdict.passed) {
      verdict = deps.syntheticVerdict;
    } else if (!pre.passed) {
      verdict = { passed: false, reasons: [pre.failedReason ?? 'too_few_words'] };
    } else {
      verdict = deps.syntheticVerdict;
    }
  } else {
    verdict = await runExplainBack(preconditionInput, { ...(deps.judge ? { judge: deps.judge } : {}) });
  }

  // (4) Decide the FAIL-path action (the caller replaces this on a PASS with the
  // same-turn mastery decision). A PASS no longer stops at `no_action` here — the
  // caller folds the verdict and evaluates the full gate this turn (Option A).
  let failPathAction: Action;
  if (verdict.passed) {
    // Placeholder; the caller replaces this when it continues into the gate. Surfaced
    // only if the caller declines to continue (it always does on a pass today).
    failPathAction = {
      type: 'no_action',
      reason: 'wait_for_learner',
      rationale: `explain-back passed for ${event.targetItemId}; evaluating mastery gate (F-12)`,
    };
  } else if (attemptNumber >= MAX_ATTEMPTS) {
    // Escalate: this was the last allowed attempt (judge DID run) and it failed —
    // return to practice (a hint/simpler item). Further frames short-circuit at (2).
    failPathAction = {
      type: 'no_action',
      reason: 'wait_for_learner',
      rationale: `explain-back failed ${attemptNumber.toString()} times for ${event.targetItemId} (reasons: ${verdict.reasons.join(',')}); escalating to practice`,
    };
  } else {
    // Re-mount ExplainBackPrompt with stock retry copy keyed to the first reason.
    const retryBody = retryPromptForFirst(verdict.reasons);
    failPathAction = {
      type: 'mount',
      component: {
        kind: 'ExplainBackPrompt',
        targetItemId: event.targetItemId,
        promptBody: retryBody,
        maxDurationSec,
      },
      rationale: `explain-back attempt ${attemptNumber.toString()} failed (${verdict.reasons.join(',')}); retrying`,
    };
  }

  return {
    verdict,
    failPathAction,
    passed: verdict.passed,
    validation: {
      layer: 4,
      status: verdict.passed ? 'pass' : 'reject',
      detail: {
        reasons: verdict.reasons,
        effectiveDurationMs,
        attemptNumber,
        ...(verdict.llmJudgmentDetail ? { subScores: verdict.llmJudgmentDetail } : {}),
      },
    },
  };
}
