import { describe, expect, it } from 'vitest';
import type { LearnerSnapshot } from './client.js';
import { type LearnerProgress, type PedagogicalIntent, emptyMemory } from './deliberation.js';
import { assess, decide } from './deliberationNodes.js';

// Helpers to build minimal LearnerSnapshot instances for testing
function snapshot(overrides: Partial<LearnerSnapshot> = {}): LearnerSnapshot {
  return {
    bktByKc: {},
    hintsUsed: 0,
    consecutiveCorrect: 0,
    ruleGatePassed: false,
    explainBackPassed: false,
    topicGuardrailClean: true,
    ...overrides,
  };
}

// =============================================================================
// assess tests (checklist #2 / #3)
// =============================================================================

describe('assess(input, memoryIn): LearnerProgress', () => {
  it('classifies a learner with rule-gate passed as "ready"', () => {
    const result = assess(
      snapshot({ ruleGatePassed: true, consecutiveCorrect: 3, hintsUsed: 0 }),
      emptyMemory(),
    );
    expect(result).toBe<LearnerProgress>('ready');
  });

  it('classifies a learner with many hints relative to turns as "over_hinting"', () => {
    const mem = { ...emptyMemory(), turnCount: 5, lastIntent: 'practice' as PedagogicalIntent };
    const result = assess(
      snapshot({ hintsUsed: 4, consecutiveCorrect: 0, ruleGatePassed: false }),
      mem,
    );
    expect(result).toBe<LearnerProgress>('over_hinting');
  });

  it('classifies a learner with 0 consecutive correct and 0 BKT as "stuck"', () => {
    const result = assess(
      snapshot({ consecutiveCorrect: 0, hintsUsed: 0, bktByKc: { 'kc-and': 0.1 } }),
      emptyMemory(),
    );
    expect(result).toBe<LearnerProgress>('stuck');
  });

  it('classifies a learner with moderate consecutive-correct as "progressing"', () => {
    // turnCount=10, hintsUsed=1 → threshold = floor(10/2)+1 = 6, so not over_hinting
    const mem = { ...emptyMemory(), turnCount: 10 };
    const result = assess(
      snapshot({ consecutiveCorrect: 2, hintsUsed: 1, bktByKc: { 'kc-and': 0.6 } }),
      mem,
    );
    expect(result).toBe<LearnerProgress>('progressing');
  });

  it('classifies a learner with low BKT but some correct as "guessing"', () => {
    const mem = { ...emptyMemory(), turnCount: 6, lastClassification: 'stuck' as LearnerProgress };
    const result = assess(
      snapshot({ consecutiveCorrect: 1, hintsUsed: 0, bktByKc: { 'kc-and': 0.25 } }),
      mem,
    );
    expect(result).toBe<LearnerProgress>('guessing');
  });

  it('reads ONLY server-derived snapshot fields (never accepts a "correct" client flag)', () => {
    // The snapshot fields are all server-derived (BKT, hints, consecutive correct).
    // There is no "correct" property on LearnerSnapshot — this test confirms
    // the assess function's parameter type enforces server-derived inputs only.
    // TypeScript compile: if LearnerSnapshot had a `correct` field this would pass it.
    const s = snapshot({ consecutiveCorrect: 0 });
    // @ts-expect-error — correct is NOT on LearnerSnapshot (confirming server-derive invariant)
    const _nope: typeof s & { correct: boolean } = s;
    void _nope;

    // Calling assess should work fine with a valid snapshot
    const result = assess(s, emptyMemory());
    expect(['stuck', 'progressing', 'guessing', 'over_hinting', 'ready']).toContain(result);
  });
});

// =============================================================================
// decide tests (checklist #4 / #5)
// =============================================================================

describe('decide(classification, memory): PedagogicalIntent', () => {
  it('ready → probe_transfer', () => {
    expect(decide('ready', emptyMemory())).toBe<PedagogicalIntent>('probe_transfer');
  });

  it('stuck → simplify', () => {
    expect(decide('stuck', emptyMemory())).toBe<PedagogicalIntent>('simplify');
  });

  it('progressing → practice', () => {
    expect(decide('progressing', emptyMemory())).toBe<PedagogicalIntent>('practice');
  });

  it('guessing → hint', () => {
    expect(decide('guessing', emptyMemory())).toBe<PedagogicalIntent>('hint');
  });

  it('over_hinting → rephrase (discourage further hints)', () => {
    expect(decide('over_hinting', emptyMemory())).toBe<PedagogicalIntent>('rephrase');
  });
});
