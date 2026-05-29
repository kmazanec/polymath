import { describe, expect, it } from 'vitest';
import { detectRegression, REGRESSION_THRESHOLD } from './regression.js';

/**
 * Unit tests for the F-14 cross-lesson regression detector. Pure module — no DB,
 * no LLM. The server reflex feeds it the L1 KC BKT map (server-derived), the
 * set of KCs already recalled this session (from the UNCAPPED throttle query),
 * and the current item id; it returns the first regressed L1 KC not yet recalled,
 * or null.
 */
describe('detectRegression', () => {
  it('returns null for an empty L1 BKT map (no prior-lesson state)', () => {
    expect(
      detectRegression({ l1BktByKc: {}, alreadyRecalledKcs: [], currentItemId: 'L2-03' }),
    ).toBeNull();
  });

  it('returns null when every L1 KC is at or above threshold', () => {
    expect(
      detectRegression({
        l1BktByKc: { AND: 0.95, OR: 0.86, NOT: REGRESSION_THRESHOLD },
        alreadyRecalledKcs: [],
        currentItemId: 'L2-03',
      }),
    ).toBeNull();
  });

  it('does NOT trigger exactly at the threshold (0.85)', () => {
    expect(
      detectRegression({
        l1BktByKc: { NOT: REGRESSION_THRESHOLD },
        alreadyRecalledKcs: [],
        currentItemId: 'L2-03',
      }),
    ).toBeNull();
  });

  it('triggers just below the threshold (0.849)', () => {
    const result = detectRegression({
      l1BktByKc: { NOT: 0.849 },
      alreadyRecalledKcs: [],
      currentItemId: 'L2-03',
    });
    expect(result).not.toBeNull();
    expect(result?.kc).toBe('NOT');
    expect(result?.priorBktAtRegression).toBe(0.849);
    expect(result?.currentItemId).toBe('L2-03');
  });

  it('returns the regressed KC with a non-empty reminder body naming the KC', () => {
    const result = detectRegression({
      l1BktByKc: { AND: 0.72 },
      alreadyRecalledKcs: [],
      currentItemId: 'L2-01',
    });
    expect(result?.kc).toBe('AND');
    expect(result?.reminderBody.length).toBeGreaterThan(0);
    expect(result?.reminderBody).toContain('AND');
  });

  it('skips a KC already recalled this session (the per-KC throttle)', () => {
    expect(
      detectRegression({
        l1BktByKc: { AND: 0.7 },
        alreadyRecalledKcs: ['AND'],
        currentItemId: 'L2-03',
      }),
    ).toBeNull();
  });

  it('returns a DIFFERENT regressed KC when the first is already recalled', () => {
    const result = detectRegression({
      l1BktByKc: { AND: 0.7, NOT: 0.6 },
      alreadyRecalledKcs: ['AND'],
      currentItemId: 'L2-03',
    });
    expect(result?.kc).toBe('NOT');
  });

  it('picks the lowest-BKT regressed KC when several have slipped', () => {
    const result = detectRegression({
      l1BktByKc: { AND: 0.8, OR: 0.5, NOT: 0.7 },
      alreadyRecalledKcs: [],
      currentItemId: 'L2-03',
    });
    expect(result?.kc).toBe('OR');
  });

  it('falls back to a generic reminder for an unknown KC name', () => {
    const result = detectRegression({
      l1BktByKc: { XOR: 0.4 },
      alreadyRecalledKcs: [],
      currentItemId: 'L2-03',
    });
    expect(result?.kc).toBe('XOR');
    expect(result?.reminderBody.length).toBeGreaterThan(0);
  });
});

/**
 * F-14 AC#6: the regression-detector eval. The detector is deterministic, so we
 * label a synthetic scenario set (L1 BKT map + throttle state → expected recalled
 * KC, or `null`) and assert it agrees at ≥90%. This is the offline (no-LLM, no-key)
 * eval the spec calls for — the detector is a pure SERVER reflex, NOT a menu move,
 * so it is evaluated here rather than via the LLM scenario gate.
 */
interface RegressionScenario {
  id: string;
  l1BktByKc: Record<string, number>;
  alreadyRecalledKcs?: string[];
  /** Expected recalled KC, or null for "no recall". */
  expect: string | null;
}

const EVAL_SCENARIOS: RegressionScenario[] = [
  { id: 'not-slipped-during-l2-composition', l1BktByKc: { NOT: 0.72 }, expect: 'NOT' },
  { id: 'and-slipped', l1BktByKc: { AND: 0.5 }, expect: 'AND' },
  { id: 'or-slipped', l1BktByKc: { OR: 0.8 }, expect: 'OR' },
  { id: 'all-held-no-recall', l1BktByKc: { AND: 0.95, OR: 0.9, NOT: 0.88 }, expect: null },
  { id: 'exactly-threshold-no-recall', l1BktByKc: { NOT: 0.85 }, expect: null },
  { id: 'no-prior-state', l1BktByKc: {}, expect: null },
  { id: 'lowest-of-several', l1BktByKc: { AND: 0.84, OR: 0.4, NOT: 0.7 }, expect: 'OR' },
  {
    id: 'first-already-recalled-second-fires',
    l1BktByKc: { AND: 0.7, NOT: 0.6 },
    alreadyRecalledKcs: ['AND'],
    expect: 'NOT',
  },
  {
    id: 'only-slipped-kc-already-recalled',
    l1BktByKc: { AND: 0.7 },
    alreadyRecalledKcs: ['AND'],
    expect: null,
  },
  { id: 'just-below-threshold-fires', l1BktByKc: { OR: 0.849 }, expect: 'OR' },
];

describe('detectRegression eval (AC#6, ≥90% on labelled scenarios)', () => {
  it('agrees with the labelled synthetic scenario set at ≥90%', () => {
    let agree = 0;
    for (const s of EVAL_SCENARIOS) {
      const hit = detectRegression({
        l1BktByKc: s.l1BktByKc,
        alreadyRecalledKcs: s.alreadyRecalledKcs ?? [],
        currentItemId: 'L2-eval',
      });
      const got = hit?.kc ?? null;
      if (got === s.expect) agree += 1;
    }
    const rate = agree / EVAL_SCENARIOS.length;
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });
});
