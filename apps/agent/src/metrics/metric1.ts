import type { MetricResult } from './types.js';

/**
 * Metric 1 — UI CHURN RATE (mounts per engaged minute, ADR-011). Measures whether
 * the responsive interface re-mounts components so often it churns under the learner.
 *
 * D-metric1: there is NO mount event or phase column in the `events` table today
 * (verified — `ui_mount` is an append-only beacon kind the server ACKs but the
 * agent does not yet aggregate). So this metric has no agent-side source and defaults
 * to `unconfigured`, pointing at the observability churn endpoint
 * (`GET /api/session/:id/observability/ui-churn`). It does NOT fabricate a number,
 * and this feature deliberately does NOT add a competing client mount event (that
 * would duplicate the observability workstream and risk two divergent churn
 * definitions).
 *
 * An OPTIONAL adapter (the churn-endpoint result, when one is wired in) may be passed;
 * absent ⇒ `unconfigured`, a null rate with data ⇒ `insufficient_data`.
 */
const UI_CHURN_THRESHOLD = 6; // mounts/min — a generous ADR-011 default

export function computeUiChurn(
  adapter: { mountsPerMinute: number | null; sampleN: number } | undefined,
): MetricResult {
  const base = {
    id: 'ui_churn',
    label: 'UI churn rate (component mounts per minute)',
    threshold: UI_CHURN_THRESHOLD,
    unit: '/min',
    source: 'observability churn endpoint (no agent-side mount source in events today)',
  } as const;

  if (adapter === undefined) {
    return {
      ...base,
      value: null,
      pass: null,
      state: 'unconfigured',
      sampleN: 0,
      note: 'no churn adapter wired — value pending the observability churn endpoint',
    };
  }

  if (adapter.mountsPerMinute === null) {
    return {
      ...base,
      value: null,
      pass: null,
      state: 'insufficient_data',
      sampleN: adapter.sampleN,
      note: 'churn endpoint returned no rate (insufficient engagement)',
    };
  }

  const pass = adapter.mountsPerMinute <= UI_CHURN_THRESHOLD;
  return {
    ...base,
    value: adapter.mountsPerMinute,
    pass,
    state: pass ? 'pass' : 'fail',
    sampleN: adapter.sampleN,
  };
}
