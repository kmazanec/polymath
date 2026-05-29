import { describe, expect, it } from 'vitest';
import { SessionSummarySchema } from '@polymath/contract';
import { buildSessionSummary, type SummaryInput } from './subgraph.js';
import { computeGrowthMultiplier } from './growth.js';

/** A minimal in-session base — no experiment arm. */
const inSessionBase: SummaryInput = {
  preTestScore: null,
  postTestScore: 0.75,
  hasExperimentArm: false,
  timeOnTaskMs: 90_000,
  transferProbes: { passed: 1, total: 2 },
  masteryStatus: 'practicing',
  explainBackVerdict: { passed: false, reasons: ['no_item_reference'] },
  kcsMastered: [],
  kcsStuck: ['kc-and'],
};

describe('buildSessionSummary (pure pipeline)', () => {
  it('produces a contract-valid SessionSummary', async () => {
    const summary = await buildSessionSummary(inSessionBase);
    expect(SessionSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('experiment path: source=experiment, scores from inputs, growth computed', async () => {
    const summary = await buildSessionSummary({
      ...inSessionBase,
      hasExperimentArm: true,
      preTestScore: 0.25,
      postTestScore: 0.75,
    });
    expect(summary.source).toBe('experiment');
    expect(summary.preTestScore).toBe(0.25);
    expect(summary.postTestScore).toBe(0.75);
    expect(summary.growthMultiplier).toBeCloseTo(computeGrowthMultiplier(0.25, 0.75)!);
    expect(summary.growthMultiplier).not.toBeNull();
  });

  it('no experiment arm: source=in_session, preTestScore null, growth null', async () => {
    const summary = await buildSessionSummary(inSessionBase);
    expect(summary.source).toBe('in_session');
    expect(summary.preTestScore).toBeNull();
    expect(summary.postTestScore).toBe(0.75); // in-session post from the fold
    expect(summary.growthMultiplier).toBeNull(); // no pre ⇒ no baseline
  });

  it('transferSuccessRate is passed/total, 0 when no probes (never NaN)', async () => {
    const half = await buildSessionSummary(inSessionBase);
    expect(half.transferSuccessRate).toBeCloseTo(0.5);

    const none = await buildSessionSummary({
      ...inSessionBase,
      transferProbes: { passed: 0, total: 0 },
    });
    expect(none.transferSuccessRate).toBe(0);
    expect(Number.isFinite(none.transferSuccessRate)).toBe(true);
  });

  it('passes the latched mastery status and explain-back verdict through verbatim', async () => {
    const mastered = await buildSessionSummary({
      ...inSessionBase,
      masteryStatus: 'mastered',
      explainBackVerdict: { passed: true, reasons: [] },
      kcsMastered: ['kc-and', 'kc-or'],
      kcsStuck: [],
    });
    expect(mastered.masteryStatus).toBe('mastered');
    expect(mastered.explainBackVerdict).toEqual({ passed: true, reasons: [] });
    expect(mastered.kcsMastered).toEqual(['kc-and', 'kc-or']);
  });

  it('fails closed: an experiment arm with a null pre still yields null growth, source experiment', async () => {
    const summary = await buildSessionSummary({
      ...inSessionBase,
      hasExperimentArm: true,
      preTestScore: null,
      postTestScore: 0.9,
    });
    expect(summary.source).toBe('experiment');
    expect(summary.preTestScore).toBeNull();
    expect(summary.growthMultiplier).toBeNull();
  });

  it('clamps/guards timeOnTaskMs to a finite non-negative number', async () => {
    const summary = await buildSessionSummary({ ...inSessionBase, timeOnTaskMs: -5 });
    expect(summary.timeOnTaskMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(summary.timeOnTaskMs)).toBe(true);
  });
});
