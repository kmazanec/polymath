import { describe, expect, it, vi } from 'vitest';
import * as booleans from './index.js';
import { playgroundEquivalence } from './playgroundEquivalence.js';
import { MAX_EQUIVALENCE_VARS } from './scoreEquivalence.js';

/**
 * Playground equivalence scorer (ADR-012 free-build playground). Both the target
 * and every learner submission are learner-influenced, so the distinct-variable
 * cap + parse-error → false rule must apply to BOTH sides — over-cap / unparseable
 * input on either side is "not equivalent", never an enumeration and never a throw.
 */
describe('playgroundEquivalence', () => {
  it('scores each submission independently against the target', () => {
    const res = playgroundEquivalence('NOT (A AND B)', {
      truth_table: '(NOT A) OR (NOT B)', // De Morgan equivalent
      circuit: 'A NAND B', // also equivalent
      pseudocode: '(NOT A) AND (NOT B)', // the halfway error — NOT equivalent
    });
    expect(res.byKey.truth_table).toBe(true);
    expect(res.byKey.circuit).toBe(true);
    expect(res.byKey.pseudocode).toBe(false);
    expect(res.allEquivalent).toBe(false);
  });

  it('marks an equivalent submission true and a non-equivalent one false', () => {
    const r = playgroundEquivalence('A NAND B', {
      circuit: 'NOT (A AND B)',
      truth_table: 'A AND B',
    });
    expect(r.byKey).toEqual({ circuit: true, truth_table: false });
    expect(r.allEquivalent).toBe(false);
  });

  it('allEquivalent is true only when every supplied submission passes', () => {
    const res = playgroundEquivalence('A OR B', {
      truth_table: 'B OR A',
      circuit: 'NOT (NOT A AND NOT B)',
    });
    expect(res.byKey.truth_table).toBe(true);
    expect(res.byKey.circuit).toBe(true);
    expect(res.allEquivalent).toBe(true);
  });

  it('allEquivalent is true (NAND target variant) only when every submission passes', () => {
    const r = playgroundEquivalence('A NAND B', {
      circuit: 'NOT (A AND B)',
      pseudocode: 'A NAND B',
    });
    expect(r.allEquivalent).toBe(true);
  });

  it('allEquivalent is false when no submissions are supplied', () => {
    const res = playgroundEquivalence('A AND B', {});
    expect(res.byKey).toEqual({});
    expect(res.allEquivalent).toBe(false);
  });

  it('an unparseable submission scores false, never throws', () => {
    const res = playgroundEquivalence('A AND B', { truth_table: 'A AND AND' });
    expect(res.byKey.truth_table).toBe(false);
    expect(res.allEquivalent).toBe(false);
  });

  it('an unparseable TARGET makes every key false (cap/parse guard on both sides)', () => {
    const res = playgroundEquivalence('))(( garbage', {
      truth_table: 'A',
      circuit: 'B',
    });
    expect(res.byKey.truth_table).toBe(false);
    expect(res.byKey.circuit).toBe(false);
    expect(res.allEquivalent).toBe(false);
  });

  it('an over-cap target is "not equivalent" — never enumerates 2^N', () => {
    const overCap = Array.from({ length: MAX_EQUIVALENCE_VARS + 5 }, (_, i) =>
      String.fromCharCode(65 + i),
    ).join(' AND ');
    const res = playgroundEquivalence(overCap, { truth_table: overCap });
    expect(res.byKey.truth_table).toBe(false);
    expect(res.allEquivalent).toBe(false);
  });

  it('an over-cap submission (target ok) scores false for that key', () => {
    const overCap = Array.from({ length: MAX_EQUIVALENCE_VARS + 5 }, (_, i) =>
      String.fromCharCode(65 + i),
    ).join(' OR ');
    const res = playgroundEquivalence('A AND B', {
      truth_table: 'A AND B',
      circuit: overCap,
    });
    expect(res.byKey.truth_table).toBe(true);
    expect(res.byKey.circuit).toBe(false);
    expect(res.allEquivalent).toBe(false);
  });

  it('an explicitly-undefined submission value coerces to "" and scores false', () => {
    // noUncheckedIndexedAccess defensive `?? ''` branch: a present key whose value
    // is undefined must not throw — it coerces to an unparseable empty string.
    const res = playgroundEquivalence('A AND B', {
      truth_table: undefined as unknown as string,
    });
    expect(res.byKey.truth_table).toBe(false);
    expect(res.allEquivalent).toBe(false);
  });

  it('a submission exactly at the variable cap is still scored (boundary)', () => {
    const atCap = Array.from({ length: MAX_EQUIVALENCE_VARS }, (_, i) =>
      String.fromCharCode(65 + i),
    ).join(' AND ');
    const res = playgroundEquivalence(atCap, { truth_table: atCap });
    expect(res.byKey.truth_table).toBe(true);
    expect(res.allEquivalent).toBe(true);
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
