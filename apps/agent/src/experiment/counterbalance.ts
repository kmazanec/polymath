/**
 * F-17 counterbalanced order assignment (T-17f).
 *
 * Subject ids are UUIDs (no odd/even), so the condition order is computed from the
 * subject's creation ORDINAL (`count + 1` at insert time): odd ordinal → Polymath
 * first, even → baseline first. Stored explicitly in `experiment_subjects
 * .condition_order` so a later re-numbering can't silently re-balance an existing
 * subject.
 */

export type ConditionOrder = 'polymath_first' | 'baseline_first';

/** Map a 1-based ordinal to a condition order. Ordinal 1 → polymath_first. */
export function conditionOrderForOrdinal(ordinal: number): ConditionOrder {
  return ordinal % 2 === 1 ? 'polymath_first' : 'baseline_first';
}
