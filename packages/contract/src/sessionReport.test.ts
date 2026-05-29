import { describe, expect, it } from 'vitest';
import { SessionSummarySchema } from './sessionReport.js';

const valid = {
  preTestScore: 0.2,
  postTestScore: 0.8,
  growthMultiplier: 2.4,
  timeOnTaskMs: 120_000,
  transferSuccessRate: 0.5,
  masteryStatus: 'mastered' as const,
  explainBackVerdict: { passed: true, reasons: [] },
  kcsMastered: ['kc-and'],
  kcsStuck: [],
  source: 'experiment' as const,
};

describe('SessionSummarySchema (frozen contract)', () => {
  it('accepts a complete summary', () => {
    expect(SessionSummarySchema.parse(valid)).toEqual(valid);
  });

  it('accepts null score fields (unmeasured, not zero)', () => {
    const parsed = SessionSummarySchema.parse({
      ...valid,
      preTestScore: null,
      postTestScore: null,
      growthMultiplier: null,
      source: 'in_session',
      masteryStatus: 'not_started',
    });
    expect(parsed.growthMultiplier).toBeNull();
  });

  it('is strict: rejects an unexpected extra key (drift caught at the boundary)', () => {
    expect(SessionSummarySchema.safeParse({ ...valid, surprise: 1 }).success).toBe(false);
  });

  it('rejects an out-of-enum mastery status / source', () => {
    expect(SessionSummarySchema.safeParse({ ...valid, masteryStatus: 'done' }).success).toBe(false);
    expect(SessionSummarySchema.safeParse({ ...valid, source: 'other' }).success).toBe(false);
  });
});
