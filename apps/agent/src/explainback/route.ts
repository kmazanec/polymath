import { desc, eq } from 'drizzle-orm';
import type { Action, ClientEvent } from '@polymath/contract';
import { runExplainBack, retryPromptForFirst, type ExplainBackJudge, type ProsodyFeatures } from '@polymath/graph';
import type { PreconditionReason } from '@polymath/contract';
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
  /** Transfer-bank rows for resolving a probed item's tokens (read-only). */
  transferItems?: TransferBankItemRef[];
}

/** The mounted `ExplainBackPrompt` this event answers + its window cap, or null when
 *  no unresolved prompt for this item exists (unsolicited event → fail closed). */
async function linkToMount(
  db: Db,
  sessionId: string,
  targetItemId: string,
): Promise<{ maxDurationSec: number } | null> {
  const rows = await db
    .select({ kind: events.kind, payload: events.payload })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(desc(events.ts))
    .limit(MAX_SESSION_EVENTS);
  // Newest-first: the first ExplainBackPrompt mount for this item is the one being
  // answered. (A later `explain_back_recording_ended` for the same item already
  // resolved an older mount; the count-attempts logic caps retries.)
  for (const row of rows) {
    const action = (row.payload as { action?: { type?: string; component?: { kind?: string; targetItemId?: string; maxDurationSec?: number } } })?.action;
    const c = action?.component;
    if (action?.type === 'mount' && c?.kind === 'ExplainBackPrompt' && c.targetItemId === targetItemId) {
      const cap = typeof c.maxDurationSec === 'number' && c.maxDurationSec > 0 ? c.maxDurationSec : 15;
      return { maxDurationSec: cap };
    }
  }
  return null;
}

/** How many prior `explain_back_recording_ended` events this session already logged
 *  for this item (the attempt count; the current event is attempt N+1). */
async function priorAttempts(db: Db, sessionId: string, targetItemId: string): Promise<number> {
  const rows = await db
    .select({ kind: events.kind, payload: events.payload })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(desc(events.ts))
    .limit(MAX_SESSION_EVENTS);
  let count = 0;
  for (const row of rows) {
    if (row.kind !== 'explain_back_recording_ended') continue;
    const ev = (row.payload as { event?: { targetItemId?: string } })?.event;
    if (ev?.targetItemId === targetItemId) count++;
  }
  return count;
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

  // (1) Link to the prompt mount + clamp the window server-side (AC#9). An
  // unsolicited event (no matching unresolved prompt) is fail-closed: treat the
  // window as 0 so precondition #1 (duration ≥3s) trips — a client cannot fabricate
  // a verdict without a real prompt.
  const mount = await linkToMount(db, event.sessionId, event.targetItemId);
  const maxDurationSec = mount?.maxDurationSec ?? 15;
  const clampCeiling = maxDurationSec * 1000;
  // A non-finite/negative client value is treated as 0 (fail closed at #1). The
  // clamp means a manipulated client CANNOT extend the window by lying.
  const clientMs = Number.isFinite(event.durationMs) && event.durationMs > 0 ? event.durationMs : 0;
  const effectiveDurationMs = mount ? Math.min(clientMs, clampCeiling) : 0;

  // (2) Derive the precondition inputs server-side. kcVocabulary empty → #4 fails
  // closed; itemTokens empty (unknown/forged/over-cap) → #5 fails closed.
  const kcVocabulary = lesson.kcVocabulary;
  const itemTokens = deriveItemTokens(event.targetItemId, lesson, deps.transferItems ?? []);
  const prosody = deps.prosodyFor?.(event.sessionId, event.targetItemId);

  // (3) Run the rubric — preconditions → judge, fail closed throughout.
  const verdict = await runExplainBack(
    {
      transcript: event.transcript,
      durationMs: effectiveDurationMs,
      maxDurationSec,
      kcVocabulary,
      itemTokens,
      ...(prosody ? { prosody } : {}),
    },
    { ...(deps.judge ? { judge: deps.judge } : {}) },
  );

  // Attempt count BEFORE persisting this event (this is attempt #prior+1).
  const prior = await priorAttempts(db, event.sessionId, event.targetItemId);
  const attemptNumber = prior + 1;

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
    // (5) Escalate: ≤2 total attempts, then return to practice (a hint/simpler item).
    action = {
      type: 'no_action',
      reason: 'wait_for_learner',
      rationale: `explain-back failed ${attemptNumber.toString()} times for ${event.targetItemId} (reasons: ${verdict.reasons.join(',')}); escalating to practice`,
    };
  } else {
    // Re-mount ExplainBackPrompt with stock retry copy keyed to the first reason.
    const retryBody = retryPromptForFirst(verdict.reasons as PreconditionReason[]);
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

  // (4) Persist the verdict row (AC#7: full precondition statuses + judge sub-scores
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
