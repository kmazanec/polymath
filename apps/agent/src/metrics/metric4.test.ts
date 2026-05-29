import { describe, expect, it } from 'vitest';
import { computeDependencyCheck } from './metric4.js';
import type { MetricEventRow } from './inputs.js';

/**
 * Metric 4 — dependency check: median time-to-correct on TRANSFER items vs final
 * PRACTICE items. The pedagogical question is "does the learner still solve quickly
 * once the crutch (the practice scaffolding) is gone?" — a transfer median that
 * balloons vs practice means the learner depended on the scaffold.
 *
 * `pass` = the transfer median is within 25% of the practice median.
 * `insufficient_data` when either side has < MIN_DEPENDENCY_SAMPLES (=3) correct
 * samples — a median over 1-2 points is noise, never a green/red tile.
 */

function submit(ts: number, correct: boolean, responseTimeMs: number): MetricEventRow {
  return { kind: 'submit', ts, submitCorrect: correct, responseTimeMs };
}
// `responseTimeMs` on a transfer row is now wire-backed: the `transfer_submitted`
// ClientEvent carries an optional responseTimeMs (see wire.ts + index.test.ts), the web
// client sends it, and fetchMetricInputs maps payload.event.responseTimeMs onto this
// row for transfer_submitted just as it does for submit. So these fixtures reflect a
// shape production actually produces (previously the field was fabricated here while
// the wire never sent it — F-21 review, I5).
function transfer(ts: number, correct: boolean, responseTimeMs: number): MetricEventRow {
  return { kind: 'transfer_submitted', ts, transferCorrect: correct, responseTimeMs };
}

describe('metric4 — dependency check', () => {
  it('passes when the transfer median is within 25% of the practice median', () => {
    const events: MetricEventRow[] = [
      submit(1, true, 1000),
      submit(2, true, 1000),
      submit(3, true, 1000),
      transfer(4, true, 1100),
      transfer(5, true, 1200),
      transfer(6, true, 1150),
    ];
    const r = computeDependencyCheck(events);
    expect(r.state).toBe('pass');
    expect(r.pass).toBe(true);
    expect(r.value).not.toBeNull();
    // value is the ratio transferMedian/practiceMedian (1.15 here ≤ 1.25).
    expect(r.value!).toBeCloseTo(1.15, 5);
    expect(r.sampleN).toBe(6);
  });

  it('fails when the transfer median exceeds 125% of the practice median', () => {
    const events: MetricEventRow[] = [
      submit(1, true, 1000),
      submit(2, true, 1000),
      submit(3, true, 1000),
      transfer(4, true, 2000),
      transfer(5, true, 2000),
      transfer(6, true, 2000),
    ];
    const r = computeDependencyCheck(events);
    expect(r.state).toBe('fail');
    expect(r.pass).toBe(false);
    expect(r.value!).toBeCloseTo(2.0, 5);
  });

  it('reports insufficient_data when transfer correct samples < 3', () => {
    const events: MetricEventRow[] = [
      submit(1, true, 1000),
      submit(2, true, 1000),
      submit(3, true, 1000),
      transfer(4, true, 1000),
      transfer(5, true, 1000),
    ];
    const r = computeDependencyCheck(events);
    expect(r.state).toBe('insufficient_data');
    expect(r.pass).toBeNull();
    expect(r.value).toBeNull();
  });

  it('reports insufficient_data when practice correct samples < 3', () => {
    const events: MetricEventRow[] = [
      submit(1, true, 1000),
      submit(2, true, 1000),
      transfer(4, true, 1000),
      transfer(5, true, 1000),
      transfer(6, true, 1000),
    ];
    const r = computeDependencyCheck(events);
    expect(r.state).toBe('insufficient_data');
  });

  it('excludes INCORRECT submissions from the median (time-to-CORRECT only)', () => {
    const events: MetricEventRow[] = [
      submit(1, true, 1000),
      submit(2, true, 1000),
      submit(3, true, 1000),
      submit(4, false, 9_999_999), // a wrong slow attempt must not skew the median
      transfer(5, true, 1000),
      transfer(6, true, 1000),
      transfer(7, true, 1000),
    ];
    const r = computeDependencyCheck(events);
    expect(r.state).toBe('pass');
    expect(r.value!).toBeCloseTo(1.0, 5);
  });

  it('ignores rows with no responseTimeMs', () => {
    const events: MetricEventRow[] = [
      { kind: 'submit', ts: 1, submitCorrect: true }, // no responseTimeMs → ignored
      submit(2, true, 1000),
      submit(3, true, 1000),
      submit(4, true, 1000),
      transfer(5, true, 1000),
      transfer(6, true, 1000),
      transfer(7, true, 1000),
    ];
    const r = computeDependencyCheck(events);
    expect(r.state).toBe('pass');
    // sampleN counts the contributing (correct + timed) rows on both sides: 3 + 3.
    expect(r.sampleN).toBe(6);
  });

  it('always reports the dependency-check id/label/source', () => {
    const r = computeDependencyCheck([]);
    expect(r.id).toBe('dependency_check');
    expect(r.source).toContain('events');
    expect(r.state).toBe('insufficient_data');
  });
});
