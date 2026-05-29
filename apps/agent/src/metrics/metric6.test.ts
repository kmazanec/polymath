import { describe, expect, it } from 'vitest';
import { computeFalsePositiveRate } from './metric6.js';
import type { MetricSubjectRow } from './inputs.js';

/**
 * Metric 6 — FALSE-POSITIVE RATE: of the learners DECLARED mastered, what fraction
 * FAIL a 3rd-representation 24h follow-up? A mastery gate that lets pattern-matchers
 * through shows up as a high false-positive rate. (ADR-011; the headline counter-
 * metric the brief's "mastery means mastery" claim rests on.)
 *
 * Denominator = subjects declared mastered who ALSO have a follow-up result.
 * sampleN < MIN_N (=5) ⇒ insufficient_data (value null).
 * AC#5: the note MUST read literally `designed-for; measured on N=<actual>`.
 */

function mastered(id: string, followupCorrect?: boolean): MetricSubjectRow {
  return {
    subjectId: id,
    declaredMastered: true,
    ...(followupCorrect !== undefined ? { followupCorrect } : {}),
  };
}

describe('metric6 — false-positive rate', () => {
  it('computes the fraction of declared-mastered who FAIL the follow-up', () => {
    const rows: MetricSubjectRow[] = [
      mastered('a', true),
      mastered('b', true),
      mastered('c', true),
      mastered('d', true),
      mastered('e', false), // 1 of 5 failed → 0.2
    ];
    const r = computeFalsePositiveRate(rows);
    expect(r.value!).toBeCloseTo(0.2, 5);
    expect(r.sampleN).toBe(5);
  });

  it('passes when the false-positive rate is at/under threshold', () => {
    const rows: MetricSubjectRow[] = [
      mastered('a', true),
      mastered('b', true),
      mastered('c', true),
      mastered('d', true),
      mastered('e', true), // 0 failed
    ];
    const r = computeFalsePositiveRate(rows);
    expect(r.state).toBe('pass');
    expect(r.pass).toBe(true);
    expect(r.value).toBe(0);
  });

  it('fails when the false-positive rate exceeds threshold', () => {
    const rows: MetricSubjectRow[] = [
      mastered('a', false),
      mastered('b', false),
      mastered('c', false),
      mastered('d', true),
      mastered('e', true),
    ];
    const r = computeFalsePositiveRate(rows);
    expect(r.state).toBe('fail');
    expect(r.pass).toBe(false);
    expect(r.value!).toBeCloseTo(0.6, 5);
  });

  it('excludes declared-mastered subjects with no follow-up result from the denominator', () => {
    const rows: MetricSubjectRow[] = [
      mastered('a', true),
      mastered('b', false),
      mastered('c'), // no follow-up → excluded
      mastered('d', true),
      mastered('e', true),
      mastered('f', true),
    ];
    const r = computeFalsePositiveRate(rows);
    expect(r.sampleN).toBe(5);
    expect(r.value!).toBeCloseTo(0.2, 5);
  });

  it('excludes NON-mastered subjects entirely (only declared-mastered count)', () => {
    const rows: MetricSubjectRow[] = [
      { subjectId: 'n1', declaredMastered: false, followupCorrect: false },
      mastered('a', true),
      mastered('b', true),
      mastered('c', true),
      mastered('d', true),
      mastered('e', true),
    ];
    const r = computeFalsePositiveRate(rows);
    expect(r.sampleN).toBe(5);
    expect(r.value).toBe(0);
  });

  it('reports insufficient_data when the denominator < MIN_N (=5)', () => {
    const rows: MetricSubjectRow[] = [mastered('a', true), mastered('b', false)];
    const r = computeFalsePositiveRate(rows);
    expect(r.state).toBe('insufficient_data');
    expect(r.value).toBeNull();
  });

  it('AC#5: note reads literally "designed-for; measured on N=<actual>"', () => {
    const rows: MetricSubjectRow[] = [
      mastered('a', true),
      mastered('b', true),
      mastered('c', true),
      mastered('d', true),
      mastered('e', false),
    ];
    const r = computeFalsePositiveRate(rows);
    expect(r.note).toBe('designed-for; measured on N=5');
    // The note is present even when insufficient (with N=0).
    const empty = computeFalsePositiveRate([]);
    expect(empty.note).toBe('designed-for; measured on N=0');
  });
});
