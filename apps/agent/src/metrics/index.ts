import type { Db } from '../db/client.js';
import type { MetricResult, MetricsPayload } from './types.js';

export type { MetricResult, MetricsPayload } from './types.js';
export type {
  UiChurnResponse,
  UiChurnPhaseEntry,
} from './uiChurn.js';

/**
 * Assemble the metrics dashboard payload (the body of `GET /api/metrics`).
 *
 * This is the minimum-viable producer that fixes the seam: it returns a valid
 * `MetricsPayload`. The six metric computations are owned by the metrics workstream
 * and slot in here; until then every metric reports `unconfigured` — which the
 * `state` discriminator renders as "not measured", NEVER as a pass. Failing closed
 * is the whole point: an unwired metric must not read green.
 */
export async function buildMetricsPayload(_db: Db): Promise<MetricsPayload> {
  const metrics: MetricResult[] = [];
  return { metrics, generatedAt: new Date().toISOString() };
}
