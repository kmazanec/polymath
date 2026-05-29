import { type ReactElement } from 'react';

/**
 * Metrics dashboard view — mounted at `/metrics`.
 *
 * Barrier placeholder: a real, routable component so the router array is exhaustive
 * and compiles. The metrics workstream fills in the data fetch (`GET /api/metrics`,
 * the `MetricsPayload`), the per-metric tile rendering over the `state`
 * discriminator, and the view-scoped stylesheet (`metrics.css`, consuming the global
 * `var()` tokens).
 */
export function MetricsDashboard(): ReactElement {
  return (
    <main>
      <h1>Metrics</h1>
      <p>The metrics dashboard is not yet available.</p>
    </main>
  );
}
