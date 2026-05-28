import { describe, expect, it } from 'vitest';
import { loadLesson } from '../lessons/loader.js';
import { evaluateRuleGate, isMastered, type LearnerState } from './gate.js';

const { masteryConfig } = loadLesson(1); // ADR-011 params

/** A learner state that clears every rule-gate condition. */
function cleanState(): LearnerState {
  return {
    bktByKc: { AND: 0.97 },
    consecutiveCorrectAtHardestTier: 3,
    hintsUsedInLastN: 0,
    responseTimesMs: [4000, 5000, 6000],
    hintRatio: 0.0,
    retryRatio: 0.1,
    transferPassed: false,
    explainBackPassed: false,
    topicGuardrailClean: true,
  };
}

describe('evaluateRuleGate', () => {
  it('passes for a clean history (3 consecutive correct, no hints, in-band RT, BKT ≥ 0.95)', () => {
    const r = evaluateRuleGate(cleanState(), masteryConfig);
    expect(r.passed).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('fails with hint_ratio_exceeded when the hint ratio is over the max', () => {
    const r = evaluateRuleGate({ ...cleanState(), hintRatio: 0.5 }, masteryConfig);
    expect(r.passed).toBe(false);
    expect(r.blockers).toContain('hint_ratio_exceeded');
  });

  it('fails with bkt_below_threshold when no KC reaches the mastery threshold', () => {
    const r = evaluateRuleGate({ ...cleanState(), bktByKc: { AND: 0.5 } }, masteryConfig);
    expect(r.passed).toBe(false);
    expect(r.blockers).toContain('bkt_below_threshold');
  });

  it('fails on too few consecutive correct', () => {
    const r = evaluateRuleGate({ ...cleanState(), consecutiveCorrectAtHardestTier: 1 }, masteryConfig);
    expect(r.blockers).toContain('insufficient_consecutive_correct');
  });

  it('fails when any hint was used in the recent window', () => {
    const r = evaluateRuleGate({ ...cleanState(), hintsUsedInLastN: 1 }, masteryConfig);
    expect(r.blockers).toContain('hints_used');
  });

  it('fails when the median response time is below the floor (guessing)', () => {
    const r = evaluateRuleGate({ ...cleanState(), responseTimesMs: [500, 600, 700] }, masteryConfig);
    expect(r.blockers).toContain('response_time_out_of_band');
  });

  it('reports multiple blockers at once', () => {
    const r = evaluateRuleGate(
      { ...cleanState(), hintRatio: 0.9, retryRatio: 0.9, bktByKc: {} },
      masteryConfig,
    );
    expect(r.blockers).toEqual(
      expect.arrayContaining(['hint_ratio_exceeded', 'retry_ratio_exceeded', 'bkt_below_threshold']),
    );
  });
});

describe('isMastered (rule-gate + transfer + explain-back)', () => {
  it('is false when the rule gate fails', () => {
    expect(isMastered({ ...cleanState(), bktByKc: { AND: 0.1 } }, masteryConfig)).toBe(false);
  });

  it('is false when the rule gate passes but transfer has not been passed', () => {
    expect(isMastered(cleanState(), masteryConfig)).toBe(false);
  });

  it('is false with transfer passed but explain-back not passed (config requires it)', () => {
    expect(isMastered({ ...cleanState(), transferPassed: true }, masteryConfig)).toBe(false);
  });

  it('is true only when rule + transfer + explain-back + guardrail all hold', () => {
    expect(
      isMastered(
        { ...cleanState(), transferPassed: true, explainBackPassed: true, topicGuardrailClean: true },
        masteryConfig,
      ),
    ).toBe(true);
  });
});
