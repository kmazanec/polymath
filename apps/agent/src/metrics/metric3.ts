import type { MetricResult } from './types.js';
import { MIN_DEPENDENCY_SAMPLES, median, type MetricEventRow } from './inputs.js';

/**
 * Metric 3 — VISUAL UTILITY (ADR-011 counter-metric). A split-test: for a matched
 * item set, randomly SUPPRESS the circuit view and compare time-to-correct against
 * the circuit-shown arm. If the suppressed arm is no slower, the circuit rep wasn't
 * pulling its weight.
 *
 * D6: shipped DESIGNED-FOR + DORMANT. The suppression decision is the only genuinely
 * intrusive change in this feature, so it stays OFF behind an explicit env opt-in. When the
 * split-test is disabled (`enabled` falsy) this metric is `unconfigured` — it never
 * fabricates a number from a non-running experiment, and a half-wired suppression
 * never perturbs the `spec.visibleReps` probe-integrity boundary. Even when enabled,
 * it is `insufficient_data` until BOTH arms have ≥ MIN_DEPENDENCY_SAMPLES correct,
 * timed samples.
 *
 * value = suppressedMedian / shownMedian (>1 = the circuit helped). pass = the
 * suppressed arm is NOT meaningfully slower-yet-helped... we report pass when the
 * circuit's presence measurably helps (ratio ≥ threshold), i.e. the rep earned its
 * place. (Threshold tuning is a manual ADR-011 step.)
 */
const VISUAL_UTILITY_THRESHOLD = 1.0;

export function computeVisualUtility(
  events: MetricEventRow[],
  enabled: boolean | undefined,
): MetricResult {
  const base = {
    id: 'visual_utility',
    label: 'Visual utility (circuit-suppressed split-test)',
    threshold: VISUAL_UTILITY_THRESHOLD,
    unit: '×',
    source: 'events (app IS NULL): circuit-suppressed vs shown time-to-correct (split-test)',
  } as const;

  if (!enabled) {
    return {
      ...base,
      value: null,
      pass: null,
      state: 'unconfigured',
      sampleN: 0,
      note: 'circuit-suppression split-test dormant (off by default; opt-in env)',
    };
  }

  const shown: number[] = [];
  const suppressed: number[] = [];
  for (const e of events) {
    if (e.kind !== 'submit' || e.submitCorrect !== true || typeof e.responseTimeMs !== 'number') {
      continue;
    }
    if (e.circuitSuppressed === true) suppressed.push(e.responseTimeMs);
    else if (e.circuitSuppressed === false) shown.push(e.responseTimeMs);
  }

  const sampleN = shown.length + suppressed.length;
  if (shown.length < MIN_DEPENDENCY_SAMPLES || suppressed.length < MIN_DEPENDENCY_SAMPLES) {
    return {
      ...base,
      value: null,
      pass: null,
      state: 'insufficient_data',
      sampleN,
      note: `need ≥${MIN_DEPENDENCY_SAMPLES} correct timed samples per arm (shown=${shown.length}, suppressed=${suppressed.length})`,
    };
  }

  const shownMedian = median(shown);
  const suppressedMedian = median(suppressed);
  if (shownMedian <= 0) {
    return { ...base, value: null, pass: null, state: 'insufficient_data', sampleN, note: 'zero shown median' };
  }
  const ratio = suppressedMedian / shownMedian;
  const pass = ratio >= VISUAL_UTILITY_THRESHOLD;
  return { ...base, value: ratio, pass, state: pass ? 'pass' : 'fail', sampleN };
}
