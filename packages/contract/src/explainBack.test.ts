import { describe, expect, it } from 'vitest';
import {
  type ExplainBackVerdict,
  type PreconditionReason,
  type ExplainBackTurnPayload,
  explainBackTurnPassed,
  explainBackTurnFailed,
  explainBackTurnJudgeUnavailable,
  explainBackTurnNoVerdict,
} from './index.js';

/**
 * The verdict shape is an internal JSONB persistence convention (decision #2/#4 —
 * NOT a Zod wire change), so this freezes the shape STRUCTURALLY: a runtime guard
 * the writer (F-11) and reader (F-12) both test against, plus the fixtures both
 * sides import from `@polymath/contract` as the shared persistence-slot truth.
 */

const PRECONDITION_REASONS: readonly PreconditionReason[] = [
  'duration_too_short',
  'duration_too_long',
  'too_few_words',
  'no_kc_vocab',
  'no_item_reference',
  'judge_unavailable',
];

/** Structural validator mirroring `ExplainBackVerdict` — no Zod (internal convention). */
function isExplainBackVerdict(v: unknown): v is ExplainBackVerdict {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.passed !== 'boolean') return false;
  if (!Array.isArray(o.reasons) || !o.reasons.every((r) => typeof r === 'string')) return false;
  if ('llmJudgmentDetail' in o && o.llmJudgmentDetail !== undefined) {
    if (typeof o.llmJudgmentDetail !== 'object' || o.llmJudgmentDetail === null) return false;
  }
  return true;
}

describe('ExplainBackVerdict shape (the F-11 → F-12 seam)', () => {
  it('every fixture verdict conforms to the verdict shape', () => {
    const verdicts = [
      explainBackTurnPassed.explainBackVerdict,
      explainBackTurnFailed.explainBackVerdict,
      explainBackTurnJudgeUnavailable.explainBackVerdict,
    ];
    for (const v of verdicts) {
      expect(isExplainBackVerdict(v)).toBe(true);
    }
  });

  it('a passing verdict has passed:true and no reasons (empty on pass)', () => {
    const v = explainBackTurnPassed.explainBackVerdict;
    expect(v?.passed).toBe(true);
    expect(v?.reasons).toEqual([]);
  });

  it('a precondition-fail verdict is passed:false with PreconditionReason members', () => {
    const v = explainBackTurnFailed.explainBackVerdict;
    expect(v?.passed).toBe(false);
    expect(v?.reasons.length).toBeGreaterThan(0);
    for (const r of v!.reasons) {
      expect(PRECONDITION_REASONS).toContain(r);
    }
  });

  it('FAIL CLOSED: judge-unavailable is { passed:false, reasons:["judge_unavailable"] }', () => {
    const v = explainBackTurnJudgeUnavailable.explainBackVerdict;
    expect(v).toEqual({ passed: false, reasons: ['judge_unavailable'] });
  });

  it('llmJudgmentDetail is optional', () => {
    expect('llmJudgmentDetail' in (explainBackTurnPassed.explainBackVerdict ?? {})).toBe(true);
    expect('llmJudgmentDetail' in (explainBackTurnFailed.explainBackVerdict ?? {})).toBe(false);
  });
});

describe('persistence slot — payload.explainBackVerdict (the JSONB convention)', () => {
  it('an explain-back turn payload carries the verdict in payload.explainBackVerdict', () => {
    const payload: ExplainBackTurnPayload = explainBackTurnPassed;
    expect(payload.event.kind).toBe('explain_back_recording_ended');
    // F-12's toLoggedEvent reads exactly this path:
    expect(payload.explainBackVerdict?.passed).toBe(true);
  });

  it('FAIL CLOSED: an absent verdict slot means no pass signal (block, never a degraded pass)', () => {
    // F-11 wrote no verdict → F-12 reads payload.explainBackVerdict.passed as undefined
    // → explainBackPassed stays false → mastery blocker.
    expect(explainBackTurnNoVerdict.explainBackVerdict).toBeUndefined();
    expect(explainBackTurnNoVerdict.explainBackVerdict?.passed ?? false).toBe(false);
  });
});
