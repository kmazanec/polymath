/**
 * SHARED PERSISTENCE-SLOT FIXTURE — freezes the F-11 → F-12 convention.
 *
 * F-11 WRITES `payload.explainBackVerdict` into the explain-back turn's `events`
 * row (mirroring `payload.transferVerdict`); F-12 READS
 * `payload.explainBackVerdict.passed`. This fixture is the single synthetic
 * explain-back turn payload both sides agree on BEFORE either wires the slot, so
 * the persistence shape is frozen jointly (BUILD-PLAN.md §"Frozen shared contracts"
 * #1 + #2).
 *
 * Both `apps/agent` (the writer/reader of the row) and `packages/graph` (the
 * producer of the verdict) import this from `@polymath/contract`.
 *
 * Keep this in lockstep with the live persist shape in
 * `apps/agent/src/server.ts` (`payload: { event, action, learnerSnapshot,
 * ...(explainBackVerdict ? { explainBackVerdict } : {}), validation }`).
 */

import type { ExplainBackVerdict } from './explainBack.js';

/**
 * The minimal shape F-12's `toLoggedEvent` projects out of an explain-back turn's
 * `events.payload` JSONB. Only `explainBackVerdict` is load-bearing here; the
 * other keys are present to mirror the real persisted payload so a consumer reading
 * `payload.explainBackVerdict.passed` is tested against a realistic row.
 */
export interface ExplainBackTurnPayload {
  event: {
    kind: 'explain_back_recording_ended';
    sessionId: string;
    targetItemId: string;
    transcript: string;
    durationMs: number;
  };
  /** The verdict slot — the F-11 → F-12 seam. Absent when F-11 produced none. */
  explainBackVerdict?: ExplainBackVerdict;
}

const SESSION_ID = '00000000-0000-4000-8000-000000000000';

/** A passing explain-back turn: preconditions + judge all clear → `passed: true`, no reasons. */
export const explainBackTurnPassed: ExplainBackTurnPayload = {
  event: {
    kind: 'explain_back_recording_ended',
    sessionId: SESSION_ID,
    targetItemId: 'l1-and',
    transcript:
      'For the AND gate the output is true only when both inputs A and B are true, '
      + 'which is why item l1-and lights up just in the bottom row of its truth table.',
    durationMs: 12_000,
  },
  explainBackVerdict: {
    passed: true,
    reasons: [],
    llmJudgmentDetail: { coverage: 0.9, itemReference: true },
  },
};

/** A failing explain-back turn: a precondition tripped → `passed: false`, reasons populated. */
export const explainBackTurnFailed: ExplainBackTurnPayload = {
  event: {
    kind: 'explain_back_recording_ended',
    sessionId: SESSION_ID,
    targetItemId: 'l1-and',
    transcript: 'um, true I guess',
    durationMs: 1_500,
  },
  explainBackVerdict: {
    passed: false,
    reasons: ['duration_too_short', 'too_few_words'],
  },
};

/**
 * FAIL-CLOSED turn: F-11 could not run the judge (no key / judge threw / undefined).
 * The verdict is present and explicitly `passed: false` — NOT an absent slot.
 */
export const explainBackTurnJudgeUnavailable: ExplainBackTurnPayload = {
  event: {
    kind: 'explain_back_recording_ended',
    sessionId: SESSION_ID,
    targetItemId: 'l1-and',
    transcript:
      'The AND gate for item l1-and outputs true only when both A and B are true.',
    durationMs: 11_000,
  },
  explainBackVerdict: {
    passed: false,
    reasons: ['judge_unavailable'],
  },
};

/**
 * FAIL-CLOSED turn with NO persisted verdict at all (the slot is absent). F-12 must
 * treat this as `explainBackPassed: false` — a missing input is BLOCK, never a pass.
 */
export const explainBackTurnNoVerdict: ExplainBackTurnPayload = {
  event: {
    kind: 'explain_back_recording_ended',
    sessionId: SESSION_ID,
    targetItemId: 'l1-and',
    transcript: 'The AND gate outputs true only when both inputs are true.',
    durationMs: 11_000,
  },
};
