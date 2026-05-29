import { describe, expect, it } from 'vitest';
import { circuitSuppressionArm, MATCHED_SPLIT_ITEMS } from './splitTest.js';

/**
 * The circuit-suppression split-test arm decision (metric 3, D6: designed-for +
 * DORMANT). It is OFF by default and, even when enabled, applies ONLY to a small
 * matched item set — and is DETERMINISTIC per item (so a re-run / reconnect keeps the
 * same learner in the same arm; a flapping arm would void the comparison). It never
 * touches `spec.visibleReps` — the marker is a metrics annotation, orthogonal to the
 * probe-integrity boundary.
 */

describe('circuitSuppressionArm', () => {
  it('returns undefined (no arm) when disabled, regardless of item', () => {
    for (const item of MATCHED_SPLIT_ITEMS) {
      expect(circuitSuppressionArm(item, false)).toBeUndefined();
    }
  });

  it('returns undefined for an UNMATCHED item even when enabled', () => {
    expect(circuitSuppressionArm('not-a-matched-item', true)).toBeUndefined();
  });

  it('returns a deterministic boolean arm for a matched item when enabled', () => {
    const first = MATCHED_SPLIT_ITEMS[0]!;
    const a = circuitSuppressionArm(first, true);
    const b = circuitSuppressionArm(first, true);
    expect(typeof a).toBe('boolean');
    expect(a).toBe(b); // deterministic per item
  });

  it('splits the matched set across both arms (not all one arm)', () => {
    const arms = MATCHED_SPLIT_ITEMS.map((i) => circuitSuppressionArm(i, true));
    expect(arms.some((x) => x === true)).toBe(true);
    expect(arms.some((x) => x === false)).toBe(true);
  });
});
