import { describe, expect, it } from 'vitest';
import { computeVisualUtility } from './metric3.js';
import type { MetricEventRow } from './inputs.js';

/**
 * Metric 3 — VISUAL UTILITY: a split-test that suppresses the circuit view for a
 * matched item set and compares time-to-correct (does the circuit rep actually help?).
 *
 * D6: shipped DESIGNED-FOR + DORMANT. The suppression split-test is off by default
 * (env opt-in), so with `enabled=false` the metric is `unconfigured` — it never
 * perturbs the probe-integrity boundary and never reports a half-wired number.
 * Even with `enabled=true` it stays `insufficient_data` until both arms have data.
 */

function arm(suppressed: boolean, correct: boolean, ms: number): MetricEventRow {
  return { kind: 'submit', ts: 1, submitCorrect: correct, responseTimeMs: ms, circuitSuppressed: suppressed };
}

describe('metric3 — visual utility (dormant split-test)', () => {
  it('is UNCONFIGURED when the split-test is disabled (dormant)', () => {
    const events: MetricEventRow[] = [arm(true, true, 1000), arm(false, true, 2000)];
    const r = computeVisualUtility(events, false);
    expect(r.state).toBe('unconfigured');
    expect(r.value).toBeNull();
    expect(r.pass).toBeNull();
    expect(r.id).toBe('visual_utility');
  });

  it('is UNCONFIGURED when no enabled flag is supplied', () => {
    const r = computeVisualUtility([], undefined);
    expect(r.state).toBe('unconfigured');
  });

  it('is INSUFFICIENT when enabled but an arm lacks samples', () => {
    const events: MetricEventRow[] = [arm(true, true, 1000), arm(true, true, 1000)];
    const r = computeVisualUtility(events, true);
    expect(r.state).toBe('insufficient_data');
    expect(r.value).toBeNull();
  });

  it('reports a real ratio when enabled with both arms populated', () => {
    const events: MetricEventRow[] = [
      arm(false, true, 1000),
      arm(false, true, 1000),
      arm(false, true, 1000),
      arm(true, true, 1500),
      arm(true, true, 1500),
      arm(true, true, 1500),
    ];
    const r = computeVisualUtility(events, true);
    expect(['pass', 'fail']).toContain(r.state);
    expect(r.value).not.toBeNull();
  });
});
