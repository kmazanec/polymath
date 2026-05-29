import { describe, expect, it, vi } from 'vitest';
import type { ClientEvent, ExplainBackVerdict } from '@polymath/contract';
import type { ExplainBackJudge } from '@polymath/graph';
import { handleExplainBack, type ExplainBackRouteDeps } from './route.js';
import { loadLesson, type Lesson } from '../lessons/loader.js';

/**
 * Unit tests for the explain-back route's integrity boundary (CLUSTER A + C + D of
 * the MR-!6 review). These run WITHOUT Postgres by stubbing the one DB call the route
 * makes (`scanSession`'s `select…orderBy…limit`). The integration suite drives the
 * same path end-to-end; these isolate the integrity-critical decisions.
 */

const lesson: Lesson = loadLesson(1);

/** A fake Drizzle query builder that resolves to `rows` for the route's single
 *  `db.select().from().where().orderBy().limit()` scan. */
function fakeDb(rows: unknown[]): ExplainBackRouteDeps['db'] {
  const builder = {
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => Promise.resolve(rows),
  };
  return { select: () => builder } as unknown as ExplainBackRouteDeps['db'];
}

/** A prompt-mount row for `targetItemId` (so the event is "solicited", window 15s). */
function promptMountRow(targetItemId: string): unknown {
  return {
    kind: 'submit',
    payload: { action: { type: 'mount', component: { kind: 'ExplainBackPrompt', targetItemId, maxDurationSec: 15 } } },
  };
}

const baseEvent: Extract<ClientEvent, { kind: 'explain_back_recording_ended' }> = {
  kind: 'explain_back_recording_ended',
  sessionId: '11111111-1111-4111-8111-111111111111',
  targetItemId: 'l1-and',
  // A crafted client transcript that, if trusted, sails through every precondition.
  transcript:
    'For this AND gate the output is true only when both A and B are true across every row of the truth table.',
  durationMs: 9000,
};

describe('explain-back route — integrity boundary (CLUSTER A)', () => {
  it('FAILS CLOSED on a missing bridge transcript — never trusts the client event.transcript', async () => {
    // No `transcriptFor` provided → no server-side transcript. A passing judge is
    // wired so the ONLY thing that can block is the empty-transcript precondition.
    const judge: ExplainBackJudge = {
      judge: vi.fn(() => Promise.resolve({ passed: true, subScores: {} })),
    };
    const deps: ExplainBackRouteDeps = {
      db: fakeDb([promptMountRow('l1-and')]),
      judge,
    };
    const outcome = await handleExplainBack(deps, baseEvent, lesson);
    // The crafted client transcript is IGNORED; the rubric ran on an empty transcript.
    expect(outcome.passed).toBe(false);
    expect(outcome.verdict.reasons).toContain('too_few_words');
    // The paid judge was never reached (the precondition tripped first).
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('runs on the SERVER bridge transcript when present (the only integrity source)', async () => {
    const judge: ExplainBackJudge = {
      judge: vi.fn(() => Promise.resolve({ passed: true, subScores: { overall: true } })),
    };
    const deps: ExplainBackRouteDeps = {
      db: fakeDb([promptMountRow('l1-and')]),
      judge,
      transcriptFor: () =>
        'For this AND gate the output is true only when both A and B are true, so the bottom row is true.',
    };
    const outcome = await handleExplainBack(deps, baseEvent, lesson);
    expect(outcome.passed).toBe(true);
    expect(judge.judge).toHaveBeenCalledTimes(1);
  });

  it('a bridge transcript that fails a precondition still fails closed (no judge)', async () => {
    const judge: ExplainBackJudge = {
      judge: vi.fn(() => Promise.resolve({ passed: true, subScores: {} })),
    };
    const deps: ExplainBackRouteDeps = {
      db: fakeDb([promptMountRow('l1-and')]),
      judge,
      transcriptFor: () => 'um the AND gate', // < 10 words
    };
    const outcome = await handleExplainBack(deps, baseEvent, lesson);
    expect(outcome.passed).toBe(false);
    expect(outcome.verdict.reasons).toContain('too_few_words');
    expect(judge.judge).not.toHaveBeenCalled();
  });
});

describe('explain-back route — synthetic-verdict seam hardening (CLUSTER D thread 8)', () => {
  it('requires a non-empty SERVER transcript + passing preconditions before honoring a synthetic PASS', async () => {
    const syntheticVerdict: ExplainBackVerdict = { passed: true, reasons: [] };
    // No bridge transcript → the synthetic pass must NOT be honored (a synthetic pass
    // could otherwise fold with an empty transcript). The route falls back to running
    // the real preconditions, which fail closed.
    const deps: ExplainBackRouteDeps = {
      db: fakeDb([promptMountRow('l1-and')]),
      syntheticVerdict,
    };
    const outcome = await handleExplainBack(deps, baseEvent, lesson);
    expect(outcome.passed).toBe(false);
    expect(outcome.verdict.reasons).toContain('too_few_words');
  });

  it('honors a synthetic PASS only when a server transcript clears the preconditions', async () => {
    const syntheticVerdict: ExplainBackVerdict = { passed: true, reasons: [] };
    const deps: ExplainBackRouteDeps = {
      db: fakeDb([promptMountRow('l1-and')]),
      syntheticVerdict,
      transcriptFor: () =>
        'For this AND gate the output is true only when both A and B are true across all rows.',
    };
    const outcome = await handleExplainBack(deps, baseEvent, lesson);
    expect(outcome.passed).toBe(true);
  });
});
