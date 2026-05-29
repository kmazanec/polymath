import { describe, expect, it } from 'vitest';
import { MAX_EQUIVALENCE_VARS, scoreEquivalence } from './index.js';

describe('scoreEquivalence (shared var-capped equivalence scorer)', () => {
  it('returns true for logically equivalent expressions', () => {
    // De Morgan: NOT (A AND B) === (NOT A) OR (NOT B)
    expect(scoreEquivalence('NOT (A AND B)', '(NOT A) OR (NOT B)')).toBe(true);
    // XOR-as-composition (the L2 case): (A AND NOT B) OR (NOT A AND B) over [0,1,1,0]
    expect(scoreEquivalence('(A AND NOT B) OR (NOT A AND B)', '(NOT A AND B) OR (A AND NOT B)')).toBe(
      true,
    );
    expect(scoreEquivalence('A AND B', 'B AND A')).toBe(true);
  });

  it('flows the NOR primitive + De Morgan duals through the scorer', () => {
    // NOR is the De Morgan dual of NAND: A NOR B === NOT (A OR B) === (NOT A) AND (NOT B).
    expect(scoreEquivalence('A NOR B', 'NOT (A OR B)')).toBe(true);
    expect(scoreEquivalence('A NOR B', '(NOT A) AND (NOT B)')).toBe(true);
    expect(scoreEquivalence('A NAND B', '(NOT A) OR (NOT B)')).toBe(true);
    // The halfway misconception column does NOT score equivalent to the target.
    expect(scoreEquivalence('NOT (A AND B)', '(NOT A) AND (NOT B)')).toBe(false);
  });

  it('returns false for non-equivalent expressions', () => {
    expect(scoreEquivalence('A AND B', 'A OR B')).toBe(false);
    expect(scoreEquivalence('A', 'NOT A')).toBe(false);
  });

  it('returns false (never throws) for an unparseable submission', () => {
    // A baseline chat learner types prose / partial syntax — wrong, not a crash.
    expect(scoreEquivalence('I think it is A and also B', 'A AND B')).toBe(false);
    expect(scoreEquivalence('A AND', 'A AND B')).toBe(false);
    expect(scoreEquivalence('', 'A AND B')).toBe(false);
    expect(scoreEquivalence('A XOR B', '(A AND NOT B) OR (NOT A AND B)')).toBe(false); // XOR not in grammar
  });

  it('returns false (never enumerates) for an over-cap submission', () => {
    // 11 distinct vars > MAX_EQUIVALENCE_VARS=10 → incorrect, never a 2^11 enumeration.
    const wide = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J AND K';
    expect(scoreEquivalence(wide, 'A AND B')).toBe(false);
  });

  it('scores exactly at the cap boundary (10 vars is allowed)', () => {
    const tenVars = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J';
    // Equivalent to itself within the cap → true (proves 10 is allowed, not rejected).
    expect(scoreEquivalence(tenVars, tenVars)).toBe(true);
    expect(MAX_EQUIVALENCE_VARS).toBe(10);
  });

  it('returns false when the canonical side is unparseable (fails closed, no throw)', () => {
    expect(scoreEquivalence('A AND B', 'not a valid !! expression')).toBe(false);
  });
});
