import { describe, expect, it } from 'vitest';
import { computeItemKey } from './key.js';

/**
 * Tests for computeItemKey (F-29).
 *
 * The critical safety invariants:
 *  1. Correct MSB-first truth table for valid expressions.
 *  2. Over-cap (>10 distinct vars) → {ok:false}, NEVER enumerates (fast).
 *  3. Unparseable expression → {ok:false}.
 */

describe('computeItemKey', () => {
  // -------------------------------------------------------------------------
  // Checklist item 2: correct MSB-first key
  // -------------------------------------------------------------------------

  it('returns the correct MSB-first truth table for A AND B', () => {
    const result = computeItemKey('A AND B');
    expect(result).toEqual({ ok: true, table: [0, 0, 0, 1] });
  });

  it('returns the correct MSB-first truth table for A OR B', () => {
    const result = computeItemKey('A OR B');
    expect(result).toEqual({ ok: true, table: [0, 1, 1, 1] });
  });

  it('returns the correct MSB-first truth table for NOT A', () => {
    const result = computeItemKey('NOT A');
    expect(result).toEqual({ ok: true, table: [1, 0] });
  });

  it('returns the correct MSB-first truth table for A NAND B', () => {
    const result = computeItemKey('A NAND B');
    expect(result).toEqual({ ok: true, table: [1, 1, 1, 0] });
  });

  it('returns the correct MSB-first truth table for 3-variable expression', () => {
    // A AND B AND C: only true when all three are 1 — row index 7 (MSB-first)
    const result = computeItemKey('A AND B AND C');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.table).toHaveLength(8);
    expect(result.table[7]).toBe(1); // all 1s → true
    expect(result.table[0]).toBe(0); // all 0s → false
  });

  // -------------------------------------------------------------------------
  // Checklist item 2 (adversarial): over-cap → {ok:false}, NEVER enumerates
  // -------------------------------------------------------------------------

  it('ADVERSARIAL: 11 variables (over cap) → {ok:false}, completes instantly without enumeration', () => {
    // 11 distinct vars = 2^11 = 2048 rows — well over the cap
    const expr = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J AND K';
    const start = Date.now();
    const result = computeItemKey(expr);
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.detail).toMatch(/cap/i);
    // Proof of no enumeration: must complete well under 50ms even on a slow machine
    expect(elapsed).toBeLessThan(50);
  });

  it('ADVERSARIAL: exactly 10 variables (at cap) → ok:true (cap is inclusive)', () => {
    // 10 vars = 2^10 = 1024 rows — at the cap boundary, allowed
    const expr = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J';
    const result = computeItemKey(expr);
    expect(result.ok).toBe(true);
  });

  it('ADVERSARIAL: exactly 11 variables (one over cap) → ok:false', () => {
    const expr = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J AND K';
    const result = computeItemKey(expr);
    expect(result.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Checklist item 2: unparseable → {ok:false}
  // -------------------------------------------------------------------------

  it('ADVERSARIAL: unparseable expression → {ok:false}', () => {
    const result = computeItemKey('NOT NOT NOT @@@ ???');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.detail).toMatch(/unparse/i);
  });

  it('ADVERSARIAL: empty string → {ok:false}', () => {
    const result = computeItemKey('');
    expect(result.ok).toBe(false);
  });

  it('ADVERSARIAL: expression with unknown operator → {ok:false}', () => {
    const result = computeItemKey('A XYZ B');
    expect(result.ok).toBe(false);
  });
});
