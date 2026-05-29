import { describe, expect, it } from 'vitest';
import { BASELINE_NORMALISATION, computeGrowthMultiplier } from './growth.js';

describe('computeGrowthMultiplier (frozen contract)', () => {
  it('returns null when there is no pre-test baseline', () => {
    expect(computeGrowthMultiplier(null, 0.8)).toBeNull();
    expect(computeGrowthMultiplier(null, null)).toBeNull();
  });

  it('uses max(pre, BASELINE_NORMALISATION) as the denominator', () => {
    // pre below the floor → normalise against the floor (0.25), not pre.
    expect(computeGrowthMultiplier(0, 0.5)).toBeCloseTo(0.5 / BASELINE_NORMALISATION);
    expect(computeGrowthMultiplier(0.1, 0.6)).toBeCloseTo((0.6 - 0.1) / BASELINE_NORMALISATION);
    // pre above the floor → normalise against pre.
    expect(computeGrowthMultiplier(0.5, 1)).toBeCloseTo((1 - 0.5) / 0.5);
  });

  it('treats a null/absent post as no post-progress (multiplier 0)', () => {
    expect(computeGrowthMultiplier(0.5, null)).toBe(0);
    expect(computeGrowthMultiplier(0.3, null)).toBe(0);
  });

  it('never emits NaN or Infinity even on degenerate inputs', () => {
    for (const pre of [0, 0.25, 0.5, 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const post of [0, 0.5, 1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const r = computeGrowthMultiplier(pre, post);
        if (r !== null) expect(Number.isFinite(r)).toBe(true);
      }
    }
  });
});
