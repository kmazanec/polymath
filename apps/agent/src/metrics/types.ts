/**
 * Metrics dashboard contract — the wire shape of the operator metrics endpoint.
 *
 * This module fixes ONLY the shapes (`MetricResult`, `MetricsPayload`) so the
 * computation modules and the web dashboard renderer agree on them. The six metric
 * computations themselves are owned by the metrics workstream; nothing here computes
 * a metric.
 *
 * The `state` field is the load-bearing discriminator the dashboard renders on, and
 * it FAILS CLOSED by design:
 *  - `insufficient_data` — the metric is configured but `sampleN` is below the
 *    threshold to report a meaningful value (`value`/`pass` are `null`).
 *  - `unconfigured`     — the metric depends on an unwired external service or
 *    missing data source (e.g. no analytics key); `value`/`pass` are `null`.
 * Neither of those is a `pass`: an unmeasured metric never reads as green. `pass`
 * is `boolean | null` so "not yet determinable" is distinct from a real fail.
 */
export interface MetricResult {
  /** Stable identifier for the metric (used as a React key + dashboard anchor). */
  id: string;
  /** Human-readable label for the tile. */
  label: string;
  /** The measured value, or `null` when not determinable (insufficient/unconfigured). */
  value: number | null;
  /** The pass threshold the value is compared against. */
  threshold: number;
  /** Unit suffix for display (e.g. `'%'`, `'ms'`, `'/min'`). */
  unit: string;
  /** Whether the metric passed its threshold, or `null` when not determinable. */
  pass: boolean | null;
  /** Render discriminator. `insufficient_data` / `unconfigured` are NOT passes. */
  state: 'pass' | 'fail' | 'insufficient_data' | 'unconfigured';
  /** Number of samples the value was computed from (drives `insufficient_data`). */
  sampleN: number;
  /** Provenance of the metric (which data source / computation produced it). */
  source: string;
  /** Optional human note (e.g. why it is unconfigured). */
  note?: string;
}

export interface MetricsPayload {
  metrics: MetricResult[];
  /** ISO-8601 timestamp the payload was generated. */
  generatedAt: string;
}
