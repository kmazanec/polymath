import type { Db } from '../db/client.js';
import type { MetricsPayload } from './types.js';
import { fetchMetricInputs } from './fetchMetricInputs.js';
import { computeAllMetrics } from './computeAllMetrics.js';

export type { MetricResult, MetricsPayload } from './types.js';
export type {
  UiChurnResponse,
  UiChurnPhaseEntry,
  UiChurnEventRow,
} from './uiChurn.js';
export { computeUiChurn } from './uiChurn.js';
export { computeAllMetrics } from './computeAllMetrics.js';
export { fetchMetricInputs } from './fetchMetricInputs.js';

/** The default-off env opt-in for the circuit-suppression split-test (metric 3, D6).
 *  Off ⇒ metric 3 reports `unconfigured` and the suppression decision never fires, so
 *  it can never perturb the probe-integrity boundary. */
function metric3Enabled(): boolean {
  return (process.env['POLYMATH_ENABLE_CIRCUIT_SPLIT_TEST'] ?? '').trim() === 'true';
}

/**
 * Assemble the metrics dashboard payload (the body of `GET /api/metrics`).
 *
 * Reads everything the six PURE computations need via `fetchMetricInputs` (the single
 * DB seam, every `events` read scoped to `events.app IS NULL`), then folds them with
 * `computeAllMetrics`. The `state` discriminator fails closed: a metric with no data
 * reports `insufficient_data`/`unconfigured`, NEVER a default green/red. At demo time
 * (small/empty N) most tiles WILL be gray — that is the correct, defensible output.
 */
export async function buildMetricsPayload(db: Db): Promise<MetricsPayload> {
  const inputs = await fetchMetricInputs(db, { metric3Enabled: metric3Enabled() });
  return { metrics: computeAllMetrics(inputs), generatedAt: new Date().toISOString() };
}
