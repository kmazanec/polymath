import { describe, expect, it } from 'vitest';
import { type BKTConfig, initBKT, updateBKT, updateBKTSequence, isMastered } from './index.js';

// ADR-011 Lesson-1 parameters.
const CFG: BKTConfig = { prior: 0.3, transition: 0.2, guess: 0.15, slip: 0.1 };

describe('updateBKT (Corbett-Anderson)', () => {
  it('matches a hand-computed posterior for one correct attempt', () => {
    // posterior = 0.3*0.9 / (0.3*0.9 + 0.7*0.15) = 0.27/0.375 = 0.72
    // pNext = 0.72 + 0.28*0.2 = 0.776
    const r = updateBKT(initBKT(CFG), true, CFG);
    expect(r.pMastered).toBeCloseTo(0.776, 5);
  });

  it('matches a hand-computed posterior for one incorrect attempt', () => {
    // posterior = 0.3*0.1 / (0.3*0.1 + 0.7*0.85) = 0.03/0.625 = 0.048
    // pNext = 0.048 + 0.952*0.2 = 0.2384
    const r = updateBKT(initBKT(CFG), false, CFG);
    expect(r.pMastered).toBeCloseTo(0.2384, 5);
  });

  it('a correct streak monotonically increases P(mastered) toward 1', () => {
    let p = initBKT(CFG);
    const seq: number[] = [];
    for (let i = 0; i < 8; i++) {
      p = updateBKT(p, true, CFG);
      seq.push(p.pMastered);
    }
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeGreaterThan(seq[i - 1]!);
    expect(seq.at(-1)!).toBeGreaterThan(0.95);
  });

  it('updateBKTSequence folds observations oldest-first', () => {
    const folded = updateBKTSequence(CFG, [true, true, true]);
    let p = initBKT(CFG);
    p = updateBKT(p, true, CFG);
    p = updateBKT(p, true, CFG);
    p = updateBKT(p, true, CFG);
    expect(folded.pMastered).toBeCloseTo(p.pMastered, 10);
  });

  it('isMastered respects the threshold', () => {
    expect(isMastered({ pMastered: 0.95 }, 0.95)).toBe(true);
    expect(isMastered({ pMastered: 0.9499 }, 0.95)).toBe(false);
  });

  it('PROPERTY: P(mastered) stays in [0,1] across arbitrary observation sequences + params', () => {
    const configs: BKTConfig[] = [
      CFG,
      { prior: 0, transition: 0, guess: 0, slip: 0 },
      { prior: 1, transition: 1, guess: 1, slip: 1 },
      { prior: 0.5, transition: 0.9, guess: 0.4, slip: 0.4 },
    ];
    for (const cfg of configs) {
      let p = initBKT(cfg);
      // a long pseudo-random-but-deterministic obs stream
      for (let i = 0; i < 200; i++) {
        p = updateBKT(p, (i * 7 + 3) % 5 < 3, cfg);
        expect(p.pMastered).toBeGreaterThanOrEqual(0);
        expect(p.pMastered).toBeLessThanOrEqual(1);
      }
    }
  });
});
