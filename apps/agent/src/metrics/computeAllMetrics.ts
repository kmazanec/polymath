import type { MetricResult } from './types.js';
import type { MetricInputs } from './inputs.js';
import { computeUiChurn } from './metric1.js';
import { computeIntelligibility } from './metric2.js';
import { computeVisualUtility } from './metric3.js';
import { computeDependencyCheck } from './metric4.js';
import { computeRubricTransferKappa } from './metric5.js';
import { computeFalsePositiveRate } from './metric6.js';

/**
 * Aggregate the six pure counter-metric computations into the ordered list the
 * dashboard renders. Pure (no DB) — `fetchMetricInputs` does the I/O — so the
 * empty/honest state is unit-testable: with no data every tile is gray
 * (insufficient_data / unconfigured), never a fabricated pass or fail.
 *
 * Order is stable (it is the tile order on the dashboard): churn, intelligibility,
 * visual-utility, dependency-check, κ, false-positive.
 */
export function computeAllMetrics(inputs: MetricInputs): MetricResult[] {
  return [
    computeUiChurn(inputs.uiChurn),
    computeIntelligibility(inputs.events),
    computeVisualUtility(inputs.events, inputs.metric3Enabled),
    computeDependencyCheck(inputs.events),
    computeRubricTransferKappa(inputs.subjects),
    computeFalsePositiveRate(inputs.subjects),
  ];
}
