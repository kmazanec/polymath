import { describe, expect, it } from 'vitest';
import { computeIntelligibility } from './metric2.js';
import type { MetricEventRow } from './inputs.js';

/**
 * Metric 2 — INTELLIGIBILITY: of the learners asked "did that change make sense?",
 * what fraction answered YES? Folds the `intelligibility_response` events. SKIP is
 * excluded from both numerator and denominator (a skip is "no opinion", not a no).
 *
 * value = yes / (yes + no); skips excluded; sampleN = yes + no; < MIN_N ⇒ insufficient.
 */

function resp(answer: 'yes' | 'no' | 'skip'): MetricEventRow {
  return { kind: 'intelligibility_response', ts: 1, intelligibilityAnswer: answer };
}

describe('metric2 — intelligibility', () => {
  it('computes yes / (yes + no) excluding skips', () => {
    const events: MetricEventRow[] = [
      resp('yes'),
      resp('yes'),
      resp('yes'),
      resp('yes'),
      resp('no'),
      resp('skip'),
      resp('skip'),
    ];
    const r = computeIntelligibility(events);
    expect(r.value!).toBeCloseTo(0.8, 5); // 4 yes / 5 (yes+no)
    expect(r.sampleN).toBe(5);
  });

  it('passes when the yes-rate is at/above threshold', () => {
    const events: MetricEventRow[] = [resp('yes'), resp('yes'), resp('yes'), resp('yes'), resp('yes')];
    const r = computeIntelligibility(events);
    expect(r.state).toBe('pass');
    expect(r.pass).toBe(true);
    expect(r.value).toBe(1);
  });

  it('fails when the yes-rate is below threshold', () => {
    const events: MetricEventRow[] = [
      resp('yes'),
      resp('no'),
      resp('no'),
      resp('no'),
      resp('no'),
    ];
    const r = computeIntelligibility(events);
    expect(r.state).toBe('fail');
    expect(r.pass).toBe(false);
    expect(r.value!).toBeCloseTo(0.2, 5);
  });

  it('reports insufficient_data when yes+no < MIN_N (=5)', () => {
    const events: MetricEventRow[] = [resp('yes'), resp('no'), resp('skip'), resp('skip')];
    const r = computeIntelligibility(events);
    expect(r.state).toBe('insufficient_data');
    expect(r.value).toBeNull();
    expect(r.sampleN).toBe(2); // skips don't count toward N
  });

  it('ignores non-intelligibility events', () => {
    const events: MetricEventRow[] = [
      { kind: 'submit', ts: 1, submitCorrect: true },
      resp('yes'),
      resp('yes'),
      resp('yes'),
      resp('yes'),
      resp('yes'),
    ];
    const r = computeIntelligibility(events);
    expect(r.sampleN).toBe(5);
    expect(r.value).toBe(1);
  });

  it('always reports the intelligibility id/label/source', () => {
    const r = computeIntelligibility([]);
    expect(r.id).toBe('intelligibility');
    expect(r.state).toBe('insufficient_data');
  });
});
