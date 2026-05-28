import { describe, expect, it } from 'vitest';
import { loadLesson } from '../lessons/loader.js';
import { evaluateMasteryGate, evaluateRuleGate, isMastered, type LearnerState } from './gate.js';

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

/** A state that satisfies EVERY mastery condition (rule-gate clears, transfer +
 *  explain-back passed, topic-guardrail clean). The individual blocker tests below
 *  flip exactly one field off this all-clear baseline. */
function masteredState(): LearnerState {
  return { ...cleanState(), transferPassed: true, explainBackPassed: true, topicGuardrailClean: true };
}

describe('evaluateMasteryGate (F-12 — the 4-condition gate with named blockers)', () => {
  it('passes with NO blockers when all four conditions hold', () => {
    const r = evaluateMasteryGate(masteredState(), masteryConfig);
    expect(r.passed).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("folds rule-gate sub-blockers under 'rule_gate_failed'", () => {
    const r = evaluateMasteryGate({ ...masteredState(), bktByKc: { AND: 0.1 } }, masteryConfig);
    expect(r.passed).toBe(false);
    expect(r.blockers).toContain('rule_gate_failed');
    // The rule-gate's own sub-blocker literals (e.g. 'bkt_below_threshold') do NOT
    // leak into the mastery blocker union — they fold under one bucket.
    expect(r.blockers).not.toContain('bkt_below_threshold');
  });

  it("blocks with 'transfer_not_passed' when the transfer probe has not passed (config requires it)", () => {
    const r = evaluateMasteryGate({ ...masteredState(), transferPassed: false }, masteryConfig);
    expect(r.passed).toBe(false);
    expect(r.blockers).toContain('transfer_not_passed');
  });

  it("blocks with 'explain_back_not_passed' when explain-back has not passed (config requires it)", () => {
    const r = evaluateMasteryGate({ ...masteredState(), explainBackPassed: false }, masteryConfig);
    expect(r.passed).toBe(false);
    expect(r.blockers).toContain('explain_back_not_passed');
  });

  it("blocks with 'topic_guardrail_exceeded' when the guardrail is dirty", () => {
    const r = evaluateMasteryGate({ ...masteredState(), topicGuardrailClean: false }, masteryConfig);
    expect(r.passed).toBe(false);
    expect(r.blockers).toContain('topic_guardrail_exceeded');
  });

  it('FAIL-CLOSED: a missing explain-back input (false) is a blocker, NEVER a pass', () => {
    // The default for an unbuilt/absent verdict is `explainBackPassed:false`. The
    // gate must BLOCK, not silently pass — the I1 fail-closed invariant.
    const r = evaluateMasteryGate({ ...masteredState(), explainBackPassed: false }, masteryConfig);
    expect(r.passed).toBe(false);
  });

  it('reports MULTIPLE blockers at once when several conditions fail', () => {
    const r = evaluateMasteryGate(
      { ...masteredState(), bktByKc: {}, transferPassed: false, explainBackPassed: false, topicGuardrailClean: false },
      masteryConfig,
    );
    expect(r.blockers).toEqual(
      expect.arrayContaining([
        'rule_gate_failed',
        'transfer_not_passed',
        'explain_back_not_passed',
        'topic_guardrail_exceeded',
      ]),
    );
  });

  it('honors requireHandCuratedTransfer=false (transfer not required → no transfer blocker)', () => {
    const cfg = { ...masteryConfig, requireHandCuratedTransfer: false };
    const r = evaluateMasteryGate({ ...masteredState(), transferPassed: false }, cfg);
    expect(r.blockers).not.toContain('transfer_not_passed');
    expect(r.passed).toBe(true);
  });

  it('honors requireExplainBackPass=false (explain-back not required → no explain-back blocker)', () => {
    const cfg = { ...masteryConfig, requireExplainBackPass: false };
    const r = evaluateMasteryGate({ ...masteredState(), explainBackPassed: false }, cfg);
    expect(r.blockers).not.toContain('explain_back_not_passed');
    expect(r.passed).toBe(true);
  });

  it('isMastered delegates to evaluateMasteryGate (same verdict for the same inputs)', () => {
    const s = masteredState();
    expect(isMastered(s, masteryConfig)).toBe(evaluateMasteryGate(s, masteryConfig).passed);
    const blocked = { ...s, transferPassed: false };
    expect(isMastered(blocked, masteryConfig)).toBe(evaluateMasteryGate(blocked, masteryConfig).passed);
  });

  it('is DETERMINISTIC: repeated calls on the same (state,config) return an identical result', () => {
    const s = { ...masteredState(), bktByKc: {}, explainBackPassed: false };
    const a = evaluateMasteryGate(s, masteryConfig);
    const b = evaluateMasteryGate(s, masteryConfig);
    expect(a).toEqual(b);
    // Property-style: many randomized states each give a stable (idempotent) result.
    for (let i = 0; i < 50; i++) {
      const rnd: LearnerState = {
        ...masteredState(),
        transferPassed: i % 2 === 0,
        explainBackPassed: i % 3 === 0,
        topicGuardrailClean: i % 5 !== 0,
        bktByKc: { AND: (i % 100) / 100 },
      };
      expect(evaluateMasteryGate(rnd, masteryConfig)).toEqual(evaluateMasteryGate(rnd, masteryConfig));
    }
  });
});
