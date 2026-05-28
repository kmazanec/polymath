import { describe, expect, it } from 'vitest';
import { runExplainBack, type ExplainBackInput } from './subgraph.js';
import type { ExplainBackJudge } from './judge.js';

/**
 * T-11c — the explain-back subgraph (LangGraph StateGraph): preconditions →
 * conditional edge → fail-emit (NO LLM) | judge → emit. Deterministic, no key.
 *
 * The single most important property here is FAIL-CLOSED: a missing/undefined
 * judge, a judge that throws, or a no-key judge ALL produce
 * `{ passed: false, reasons: ['judge_unavailable'] }`. A precondition fail short-
 * circuits with the precondition reason and NEVER calls the judge.
 */

const KC = ['AND', 'OR', 'NOT', 'true', 'false', 'output', 'input', 'gate'];

function input(overrides: Partial<ExplainBackInput> = {}): ExplainBackInput {
  return {
    transcript:
      'For this AND gate the output is true only when both A and B are true, the bottom row.',
    durationMs: 11_000,
    maxDurationSec: 15,
    kcVocabulary: KC,
    itemTokens: ['A', 'B', 'AND'],
    ...overrides,
  };
}

/** A judge double that always passes — proves preconditions short-circuit it. */
const passingJudge: ExplainBackJudge = {
  judge: () => Promise.resolve({ passed: true, subScores: { itemSpecificReasoning: true, overall: 0.9 } }),
};
const failingJudge: ExplainBackJudge = {
  judge: () => Promise.resolve({ passed: false, subScores: { itemSpecificReasoning: false, overall: 0.2 } }),
};
const throwingJudge: ExplainBackJudge = {
  judge: () => Promise.reject(new Error('judge boom / rate limited')),
};

describe('runExplainBack — fail-closed StateGraph', () => {
  it('preconditions pass + judge passes → verdict passed, no reasons, sub-scores attached', async () => {
    const v = await runExplainBack(input(), { judge: passingJudge });
    expect(v.passed).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.llmJudgmentDetail).toMatchObject({ overall: 0.9 });
  });

  it('a PRECONDITION fail short-circuits — judge is NEVER called, reason is the precondition', async () => {
    let called = false;
    const spyJudge: ExplainBackJudge = {
      judge: () => {
        called = true;
        return Promise.resolve({ passed: true, subScores: {} });
      },
    };
    // sub-3s → duration_too_short.
    const v = await runExplainBack(input({ durationMs: 1_000 }), { judge: spyJudge });
    expect(v.passed).toBe(false);
    expect(v.reasons).toEqual(['duration_too_short']);
    expect(called).toBe(false); // NO LLM on a precondition fail
  });

  it('the AC#4 gamer (no item reference) fails at preconditions, no judge call', async () => {
    const v = await runExplainBack(
      input({
        transcript: 'yeah I just used the AND and OR gates like the input and output stuff here',
        itemTokens: ['A', 'B'],
      }),
      { judge: passingJudge },
    );
    expect(v.passed).toBe(false);
    expect(v.reasons).toEqual(['no_item_reference']);
  });

  it('preconditions pass + judge FAILS → verdict failed (judge_failed reason), sub-scores attached', async () => {
    const v = await runExplainBack(input(), { judge: failingJudge });
    expect(v.passed).toBe(false);
    expect(v.reasons).toContain('judge_failed');
    expect(v.llmJudgmentDetail).toMatchObject({ overall: 0.2 });
  });

  it('FAIL-CLOSED: NO judge injected (no key) → judge_unavailable, never a pass', async () => {
    const v = await runExplainBack(input(), {});
    expect(v).toEqual({ passed: false, reasons: ['judge_unavailable'] });
  });

  it('FAIL-CLOSED: undefined deps → judge_unavailable', async () => {
    const v = await runExplainBack(input());
    expect(v).toEqual({ passed: false, reasons: ['judge_unavailable'] });
  });

  it('FAIL-CLOSED: a judge that THROWS → judge_unavailable, never a pass', async () => {
    const v = await runExplainBack(input(), { judge: throwingJudge });
    expect(v).toEqual({ passed: false, reasons: ['judge_unavailable'] });
  });

  it('FAIL-CLOSED: empty kcVocabulary (missing file) blocks at preconditions, no judge', async () => {
    const v = await runExplainBack(input({ kcVocabulary: [] }), { judge: passingJudge });
    expect(v.passed).toBe(false);
    expect(v.reasons).toEqual(['no_kc_vocab']);
  });
});
