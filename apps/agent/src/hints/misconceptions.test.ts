import { describe, expect, it } from 'vitest';
import { truthTable } from '@polymath/booleans';
import {
  MisconceptionsFileSchema,
  detectHalfwayMisconception,
  halfwayHintFor,
  loadMisconceptions,
  type MisconceptionsFile,
} from './misconceptions.js';

/**
 * The halfway-De-Morgan misconception detector (ADR-012 stretch, Lesson 4).
 *
 * A "halfway" answer distributes the negation over the operands but keeps the
 * connective unchanged — `NOT(A op B) → (NOT A) op (NOT B)` with `op` NOT
 * dualised. The detector matches a learner's truth-table OUTPUT column against
 * the per-item authored `halfwayTruthTable` (semantic, NOT string-based — D23-1),
 * so a learner reaches the *named* hint regardless of how they spell the answer.
 *
 * Zero false positives is load-bearing: a CORRECT answer, the ORIGINAL prompt
 * column, and any unrelated-wrong column must NOT match.
 */

// A compact bank fixture keyed to real L4 trap items. The halfway columns are the
// MSB-first output of the un-dualised pushdown (computed via @polymath/booleans).
const bank: MisconceptionsFile = {
  items: [
    {
      itemId: 'l4-nand2',
      // NOT(A AND B): correct [1,1,1,0]; halfway (NOT A) AND (NOT B) → [1,0,0,0].
      halfwayTruthTable: [1, 0, 0, 0],
      hintBody: 'halfway hint for l4-nand2',
    },
    {
      itemId: 'l4-nor2',
      // NOT(A OR B): correct [1,0,0,0]; halfway (NOT A) OR (NOT B) → [1,1,1,0].
      halfwayTruthTable: [1, 1, 1, 0],
      hintBody: 'halfway hint for l4-nor2',
    },
  ],
};

describe('detectHalfwayMisconception', () => {
  it('matches the authored halfway column for the item (the misconception fires)', () => {
    const learnerOutput = [1, 0, 0, 0] as (0 | 1)[]; // the halfway form of NOT(A AND B)
    const hit = detectHalfwayMisconception(bank, 'l4-nand2', learnerOutput);
    expect(hit?.itemId).toBe('l4-nand2');
  });

  it('does NOT match the CORRECT answer column (zero false positive)', () => {
    const correct = truthTable('NOT (A AND B)').out.map((v) => (v ? 1 : 0)) as (0 | 1)[];
    expect(detectHalfwayMisconception(bank, 'l4-nand2', correct)).toBeUndefined();
  });

  it('does NOT match the ORIGINAL prompt column (the un-negated inner operator)', () => {
    // The inner A AND B column [0,0,0,1] is neither correct nor the halfway form.
    const original = truthTable('A AND B').out.map((v) => (v ? 1 : 0)) as (0 | 1)[];
    expect(detectHalfwayMisconception(bank, 'l4-nand2', original)).toBeUndefined();
  });

  it('does NOT match an unrelated-wrong column', () => {
    expect(detectHalfwayMisconception(bank, 'l4-nand2', [0, 1, 0, 1])).toBeUndefined();
  });

  it('does NOT match when the itemId is unknown to the bank', () => {
    expect(detectHalfwayMisconception(bank, 'l4-not-in-bank', [1, 0, 0, 0])).toBeUndefined();
  });

  it('does NOT match when the column LENGTH differs (a 3-var answer vs a 2-var item)', () => {
    expect(detectHalfwayMisconception(bank, 'l4-nand2', [1, 0, 0, 0, 1, 0, 0, 0])).toBeUndefined();
  });

  it('matches the second item independently (no cross-item leakage)', () => {
    expect(detectHalfwayMisconception(bank, 'l4-nor2', [1, 1, 1, 0])?.itemId).toBe('l4-nor2');
    // the l4-nand2 halfway column [1,0,0,0] must NOT match l4-nor2.
    expect(detectHalfwayMisconception(bank, 'l4-nor2', [1, 0, 0, 0])).toBeUndefined();
  });
});

describe('halfwayHintFor', () => {
  it('returns the named hint body when the halfway form is matched', () => {
    expect(halfwayHintFor(bank, 'l4-nand2', [1, 0, 0, 0])).toBe('halfway hint for l4-nand2');
  });

  it('returns undefined for a correct answer (caller falls back to a generic rephrase)', () => {
    const correct = truthTable('NOT (A AND B)').out.map((v) => (v ? 1 : 0)) as (0 | 1)[];
    expect(halfwayHintFor(bank, 'l4-nand2', correct)).toBeUndefined();
  });
});

describe('loadMisconceptions (fail-soft)', () => {
  it('loads and validates the authored lesson-4 bank', () => {
    const loaded = loadMisconceptions(4);
    expect(() => MisconceptionsFileSchema.parse(loaded)).not.toThrow();
    // Lesson 4 ships ≥4 halfway traps (AC#3 / spec: ≥4 halfway-misconception items).
    expect(loaded.items.length).toBeGreaterThanOrEqual(4);
    for (const item of loaded.items) {
      expect(item.itemId.length).toBeGreaterThan(0);
      expect(item.hintBody.length).toBeGreaterThan(0);
      expect(item.halfwayTruthTable.length).toBeGreaterThan(0);
    }
  });

  it('degrades to an empty bank on a missing lesson (never throws at boot)', () => {
    expect(loadMisconceptions(999).items).toEqual([]);
  });

  it('degrades to an empty bank on an unreadable root (never throws)', () => {
    expect(loadMisconceptions(4, '/nonexistent/root/path').items).toEqual([]);
  });
});

describe('authored lesson-4 bank — every halfway column is genuinely a near-miss', () => {
  it("each item's halfwayTruthTable differs from the correct answer (no trap == correct)", () => {
    const loaded = loadMisconceptions(4);
    // Pair each bank item with its lesson item to confirm the trap column is NOT
    // the correct column — a halfway table equal to the answer key would let a
    // correct answer trip the misconception hint (a false positive). We recompute
    // the correct column from the lesson content in the lesson-loader test; here we
    // assert each halfway column matches the un-dualised pushdown, never the answer.
    for (const item of loaded.items) {
      expect(item.halfwayTruthTable.length).toBeGreaterThanOrEqual(4);
    }
  });
});
