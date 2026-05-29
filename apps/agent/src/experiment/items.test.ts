import { describe, expect, it } from 'vitest';
import {
  differentSurfaceRep,
  InsufficientItemsError,
  sampleUnusedItems,
  type ExperimentBankItem,
} from './items.js';

/** The real L1 bank shape (8 items) — the test uses the actual size so the
 *  design-(ii) tightness (4 pre + 4 post = 8 exactly) is exercised, not hidden
 *  behind an oversized fixture. */
const L1: ExperimentBankItem[] = Array.from({ length: 8 }, (_, i) => ({
  itemId: `L1-0${i + 1}`,
  targetExpression: 'A AND B',
  targetRep: i % 2 === 0 ? 'circuit' : 'truth_table',
  hiddenReps: i % 2 === 0 ? ['truth_table'] : ['pseudocode'],
}));

describe('sampleUnusedItems', () => {
  it('returns n items excluding the used set, in id order', () => {
    const picked = sampleUnusedItems(L1, new Set(), 4);
    expect(picked.map((p) => p.itemId)).toEqual(['L1-01', 'L1-02', 'L1-03', 'L1-04']);
  });

  it('never returns an item already in the used set (the exclusion gate)', () => {
    const used = new Set(['L1-01', 'L1-02', 'L1-03', 'L1-04']);
    const picked = sampleUnusedItems(L1, used, 4);
    expect(picked.map((p) => p.itemId)).toEqual(['L1-05', 'L1-06', 'L1-07', 'L1-08']);
    for (const p of picked) expect(used.has(p.itemId)).toBe(false);
  });

  it('design (ii): 4 pre + 4 post consumes the whole 8-item bank exactly', () => {
    const pre = sampleUnusedItems(L1, new Set(), 4);
    const used = new Set(pre.map((p) => p.itemId));
    const post = sampleUnusedItems(L1, used, 4);
    expect(new Set([...pre, ...post].map((i) => i.itemId)).size).toBe(8);
  });

  it('throws InsufficientItemsError at the boundary (asking for more than remains)', () => {
    const used = new Set(L1.slice(0, 7).map((i) => i.itemId)); // 1 left
    expect(() => sampleUnusedItems(L1, used, 2)).toThrow(InsufficientItemsError);
  });

  it('requesting exactly the remaining count succeeds', () => {
    const used = new Set(L1.slice(0, 6).map((i) => i.itemId)); // 2 left
    expect(sampleUnusedItems(L1, used, 2)).toHaveLength(2);
  });
});

describe('differentSurfaceRep', () => {
  it('rotates off the original targetRep (the held-out rep is a genuine transfer)', () => {
    const item: ExperimentBankItem = {
      itemId: 'x',
      targetExpression: 'A AND B',
      targetRep: 'circuit',
      hiddenReps: ['truth_table'],
    };
    const rep = differentSurfaceRep(item);
    expect(rep).not.toBe('circuit');
    expect(['truth_table', 'circuit', 'pseudocode']).toContain(rep);
  });
});
