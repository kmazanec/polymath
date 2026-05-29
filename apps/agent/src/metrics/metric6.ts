import type { MetricResult } from './types.js';
import { MIN_N, type MetricSubjectRow } from './inputs.js';

/**
 * Metric 6 — FALSE-POSITIVE RATE (ADR-011, the headline counter-metric). Of the
 * learners the gate DECLARED mastered, what fraction FAIL a 3rd-representation 24h
 * follow-up? A gate that admits pattern-matchers reads as a high false-positive rate.
 *
 * Denominator = declared-mastered subjects who ALSO have a follow-up result (the
 * experiment `followupResults` table). `value` = (failed follow-up) / denominator.
 * Fails closed:
 *  - denominator < MIN_N (=5) ⇒ `insufficient_data` (value/pass null).
 * `pass` = rate ≤ threshold (0.1).
 *
 * AC#5: the note ALWAYS reads literally `designed-for; measured on N=<actual>` —
 * present in every state (incl. insufficient, with the real N) so the demo deck shows
 * the honest small-N caveat the brief requires.
 */
const FALSE_POSITIVE_THRESHOLD = 0.1;

export function computeFalsePositiveRate(subjects: MetricSubjectRow[]): MetricResult {
  const declared = subjects.filter(
    (s) => s.declaredMastered && typeof s.followupCorrect === 'boolean',
  );
  const sampleN = declared.length;
  const note = `designed-for; measured on N=${sampleN}`;
  const base = {
    id: 'false_positive_rate',
    label: 'False-positive mastery rate (declared-mastered failing 24h follow-up)',
    threshold: FALSE_POSITIVE_THRESHOLD,
    unit: '%',
    sampleN,
    source: 'experiment followupResults: declared-mastered who fail a 3rd-rep follow-up',
    note,
  } as const;

  if (sampleN < MIN_N) {
    return { ...base, value: null, pass: null, state: 'insufficient_data' };
  }

  const failed = declared.filter((s) => s.followupCorrect === false).length;
  const rate = failed / sampleN;
  const pass = rate <= FALSE_POSITIVE_THRESHOLD;
  return { ...base, value: rate, pass, state: pass ? 'pass' : 'fail' };
}
