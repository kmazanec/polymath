import { describe, expect, it } from 'vitest';
import { computeRubricTransferKappa } from './metric5.js';
import type { MetricSubjectRow } from './inputs.js';

/**
 * Metric 5 — Cohen's κ between the explain-back rubric verdict and the held-out
 * transfer verdict. Are the two integrity signals AGREEING (both flag the same
 * learners as mastered / not)? Low κ would mean one of the two gates is noise.
 *
 * - rows with BOTH verdicts present form the 2×2 agreement table.
 * - sampleN = the count of complete pairs; N < MIN_N (=5) ⇒ insufficient_data.
 * - The degenerate single-class table (everyone agrees pass, or everyone agrees
 *   fail) makes κ's denominator (1 - p_e) zero → guard it ⇒ insufficient_data, never
 *   NaN or a false 1.0.
 */

function subj(id: string, explainBackPassed?: boolean, transferPassed?: boolean): MetricSubjectRow {
  return {
    subjectId: id,
    declaredMastered: false,
    ...(explainBackPassed !== undefined ? { explainBackPassed } : {}),
    ...(transferPassed !== undefined ? { transferPassed } : {}),
  };
}

describe('metric5 — rubric ↔ transfer Cohen κ', () => {
  it('computes κ=1 when the two verdicts perfectly agree on a mixed table', () => {
    const rows: MetricSubjectRow[] = [
      subj('a', true, true),
      subj('b', true, true),
      subj('c', false, false),
      subj('d', false, false),
      subj('e', true, true),
      subj('f', false, false),
    ];
    const r = computeRubricTransferKappa(rows);
    expect(r.state).toBe('pass');
    expect(r.value!).toBeCloseTo(1.0, 5);
    expect(r.sampleN).toBe(6);
  });

  it('computes κ=0 when agreement equals chance', () => {
    // 2×2 with observed agreement == expected agreement → κ = 0.
    const rows: MetricSubjectRow[] = [
      subj('a', true, true),
      subj('b', true, false),
      subj('c', false, true),
      subj('d', false, false),
      subj('e', true, true),
      subj('f', false, false),
      subj('g', true, false),
      subj('h', false, true),
    ];
    const r = computeRubricTransferKappa(rows);
    expect(r.value).not.toBeNull();
    expect(r.value!).toBeCloseTo(0, 5);
  });

  it('GUARDS the degenerate single-class table (all agree pass) → insufficient_data, not NaN/1.0', () => {
    const rows: MetricSubjectRow[] = [
      subj('a', true, true),
      subj('b', true, true),
      subj('c', true, true),
      subj('d', true, true),
      subj('e', true, true),
      subj('f', true, true),
    ];
    const r = computeRubricTransferKappa(rows);
    expect(r.state).toBe('insufficient_data');
    expect(r.value).toBeNull();
    expect(r.pass).toBeNull();
  });

  it('reports insufficient_data when complete pairs < MIN_N (=5)', () => {
    const rows: MetricSubjectRow[] = [
      subj('a', true, true),
      subj('b', false, false),
      subj('c', true, false),
      subj('d', false, true), // only 4 complete pairs
      subj('e', true), // incomplete (no transfer) → excluded
    ];
    const r = computeRubricTransferKappa(rows);
    expect(r.state).toBe('insufficient_data');
    expect(r.sampleN).toBe(4);
  });

  it('excludes subjects missing either verdict from the table', () => {
    const rows: MetricSubjectRow[] = [
      subj('a', true, true),
      subj('b', false, false),
      subj('c', true, true),
      subj('d', false, false),
      subj('e', undefined, true), // no explain-back → excluded
      subj('f', true, undefined), // no transfer → excluded
      subj('g', false, false),
    ];
    const r = computeRubricTransferKappa(rows);
    expect(r.sampleN).toBe(5);
    expect(r.value!).toBeCloseTo(1.0, 5);
  });

  it('always reports the κ id/label/source', () => {
    const r = computeRubricTransferKappa([]);
    expect(r.id).toBe('rubric_transfer_kappa');
    expect(r.state).toBe('insufficient_data');
    expect(r.value).toBeNull();
  });
});
