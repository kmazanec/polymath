import { describe, expect, it, vi } from 'vitest';
import * as booleans from './index.js';
import { playgroundEquivalence } from './playgroundEquivalence.js';

/**
 * The playground equivalence scorer caps BOTH sides (target + every submission)
 * and never throws / never enumerates beyond the variable cap. Behaviour pinned
 * here so the frozen contract code is covered.
 */
describe('playgroundEquivalence', () => {
  it('marks an equivalent submission true and a non-equivalent one false', () => {
    const r = playgroundEquivalence('A NAND B', {
      circuit: 'NOT (A AND B)',
      truth_table: 'A AND B',
    });
    expect(r.byKey).toEqual({ circuit: true, truth_table: false });
    expect(r.allEquivalent).toBe(false);
  });

  it('allEquivalent is true only when every supplied submission passes', () => {
    const r = playgroundEquivalence('A NAND B', {
      circuit: 'NOT (A AND B)',
      pseudocode: 'A NAND B',
    });
    expect(r.allEquivalent).toBe(true);
  });

  it('allEquivalent is false when no submissions are supplied', () => {
    const r = playgroundEquivalence('A NAND B', {});
    expect(r.byKey).toEqual({});
    expect(r.allEquivalent).toBe(false);
  });

  it('an unparseable submission scores false (never throws)', () => {
    const r = playgroundEquivalence('A AND B', { circuit: 'A AND AND B' });
    expect(r.byKey.circuit).toBe(false);
    expect(r.allEquivalent).toBe(false);
  });

  it('an unparseable target scores every key false (never throws)', () => {
    const r = playgroundEquivalence('A AND AND B', { circuit: 'A AND B' });
    expect(r.byKey.circuit).toBe(false);
    expect(r.allEquivalent).toBe(false);
  });

  it('an over-cap submission scores false (no enumeration)', () => {
    // 12 distinct variables exceeds MAX_EQUIVALENCE_VARS (10).
    const over = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J AND K AND L';
    const r = playgroundEquivalence('A AND B', { circuit: over });
    expect(r.byKey.circuit).toBe(false);
  });

  it('an over-cap target scores every key false (no enumeration)', () => {
    const over = 'A AND B AND C AND D AND E AND F AND G AND H AND I AND J AND K AND L';
    const r = playgroundEquivalence(over, { circuit: 'A AND B' });
    expect(r.byKey.circuit).toBe(false);
  });

  it('a key whose value is missing scores false (treated as empty)', () => {
    // An explicitly-undefined value still appears in Object.keys; the `?? ''`
    // fallback makes it an unparseable empty string → false.
    const submissions = { circuit: undefined } as unknown as Record<string, string>;
    const r = playgroundEquivalence('A AND B', submissions);
    expect(r.byKey.circuit).toBe(false);
  });

  it('a throw from equivalent() (post cap+parse) is caught and scores false', () => {
    // Both sides pass the cap+parse pre-check, but equivalent itself raises:
    // the defensive catch must downgrade to false, never propagate.
    const spy = vi.spyOn(booleans, 'equivalent').mockImplementation(() => {
      throw new Error('boom');
    });
    try {
      const r = playgroundEquivalence('A AND B', { circuit: 'A AND B' });
      expect(r.byKey.circuit).toBe(false);
      expect(r.allEquivalent).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
