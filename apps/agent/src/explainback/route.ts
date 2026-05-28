import { desc, eq } from 'drizzle-orm';
import type { Action, ClientEvent } from '@polymath/contract';
import { runExplainBack, retryPromptForFirst, type ExplainBackJudge, type ProsodyFeatures } from '@polymath/graph';
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
 *   4. persists an `events` row with `{ event, explainBackVerdict, validation:{layer:4,…} }` (AC#7).
 *   5. on FAIL re-mounts `ExplainBackPrompt` with stock retry copy, counting prior
 *      attempts for this item from the bounded log and capping at MAX_ATTEMPTS, then
 *      escalating to a hint / back to practice (AC#8). On PASS → no_action (F-11
 *      STOPS at the verdict; F-12 owns the mastery transition).
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
   *  this explain-back utterance. When present it OVERRIDES the client-supplied
   *  `event.transcript` (the server must not trust the client for the central
   *  integrity input — CLAUDE.md "server never trusts the client"). The bare
   *  `explain_back_recording_ended` event is only the completion SIGNAL; the spoken
   *  content arrives server-side via this seam. Absent (bridge capture not wired /
   *  deferred device smoke) → fall back to the client transcript, which the
   *  preconditions + judge still gate (and which fails CLOSED when empty). */
  transcriptFor?: (sessionId: string, targetItemId: string) => string | undefined;
  /** Transfer-bank rows for resolving a probed item's tokens (read-only). */
  transferItems?: TransferBankItemRef[];
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
 * Handle an `explain_back_recording_ended` frame end-to-end. Returns the outbound
 * `Action` (a retry `ExplainBackPrompt` mount, an escalation, or `no_action` on
 * pass). The caller persists nothing extra — this writes the verdict row itself.
 */
export async function handleExplainBack(
  deps: ExplainBackRouteDeps,
  event: Extract<ClientEvent, { kind: 'explain_back_recording_ended' }>,
  lesson: Lesson,
): Promise<Action> {
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
  // no_action WITHOUT a judge call. Persist a row so the replay/attempt log stays
  // honest (the verdict is a fail-closed `attempt_cap_reached`, never a pass).
  if (prior >= MAX_ATTEMPTS) {
    const escalate: Action = {
      type: 'no_action',
      reason: 'wait_for_learner',
      rationale: `explain-back attempt cap (${MAX_ATTEMPTS.toString()}) already reached for ${event.targetItemId}; escalating to practice (judge not run)`,
    };
    await db.insert(events).values({
      sessionId: event.sessionId,
      kind: event.kind,
      payload: {
        event,
        action: escalate,
        explainBackVerdict: { passed: false, reasons: ['attempt_cap_reached'] },
        validation: {
          layer: 4,
          status: 'reject',
          detail: { reasons: ['attempt_cap_reached'], effectiveDurationMs, attemptNumber },
        },
      },
    });
    return escalate;
  }

  // (3) Derive the precondition inputs server-side. kcVocabulary empty → #4 fails
  // closed; itemTokens empty (unknown/forged/over-cap) → #5 fails closed.
  const kcVocabulary = lesson.kcVocabulary;
  const itemTokens = deriveItemTokens(event.targetItemId, lesson, deps.transferItems ?? []);
  const prosody = deps.prosodyFor?.(event.sessionId, event.targetItemId);

  // The server-derived bridge transcript is authoritative when present; the
  // client-supplied `event.transcript` is only a fallback (never trusted over the
  // bridge). An empty/absent transcript fails CLOSED at precondition #3.
  const bridgeTranscript = deps.transcriptFor?.(event.sessionId, event.targetItemId);
  const transcript = bridgeTranscript ?? event.transcript;

  // (4) Run the rubric — preconditions → judge, fail closed throughout.
  const verdict = await runExplainBack(
    {
      transcript,
      durationMs: effectiveDurationMs,
      maxDurationSec,
      kcVocabulary,
      itemTokens,
      ...(prosody ? { prosody } : {}),
    },
    { ...(deps.judge ? { judge: deps.judge } : {}) },
  );

  // Decide the outbound action.
  let action: Action;
  if (verdict.passed) {
    // F-11 STOPS at the verdict — F-12 owns the mastery transition.
    action = {
      type: 'no_action',
      reason: 'wait_for_learner',
      rationale: `explain-back passed for ${event.targetItemId}; awaiting mastery gate (F-12)`,
    };
  } else if (attemptNumber >= MAX_ATTEMPTS) {
    // (6) Escalate: this was the last allowed attempt (judge DID run) and it failed —
    // return to practice (a hint/simpler item). Further frames short-circuit at (2).
    action = {
      type: 'no_action',
      reason: 'wait_for_learner',
      rationale: `explain-back failed ${attemptNumber.toString()} times for ${event.targetItemId} (reasons: ${verdict.reasons.join(',')}); escalating to practice`,
    };
  } else {
    // Re-mount ExplainBackPrompt with stock retry copy keyed to the first reason.
    const retryBody = retryPromptForFirst(verdict.reasons);
    action = {
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

  // (5) Persist the verdict row (AC#7: full precondition statuses + judge sub-scores
  // travel in validation.detail; the verdict slot mirrors payload.transferVerdict).
  await db.insert(events).values({
    sessionId: event.sessionId,
    kind: event.kind,
    payload: {
      event,
      action,
      explainBackVerdict: verdict,
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
    },
  });

  return action;
}
