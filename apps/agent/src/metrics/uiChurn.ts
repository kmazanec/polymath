/**
 * UI-churn observability — the response shape of
 * `GET /api/session/:id/observability/ui-churn`.
 *
 * This module fixes ONLY the response shape so the endpoint owner and the metrics
 * adapter that optionally consumes it agree. The aggregation (folding `ui_mount`
 * beacons into mounts-per-minute, by phase, during transfer) is owned by the
 * observability workstream.
 *
 * `status` fails closed: `insufficient_data` when there isn't enough engagement to
 * compute a rate (`mountsPerMinute` is `null`), so the metric adapter never treats a
 * near-empty session as a clean zero-churn pass.
 */
export interface UiChurnPhaseEntry {
  mounts: number;
  mountsPerMinute: number;
}

export interface UiChurnResponse {
  sessionId: string;
  status: 'ok' | 'insufficient_data';
  /** Mounts per engaged minute across the session, or `null` when insufficient data. */
  mountsPerMinute: number | null;
  /** Per-phase mount counts and rates, keyed by the beacon's `phase` string. */
  byPhase: Record<string, UiChurnPhaseEntry>;
  /** Mounts that occurred while a transfer probe was active. */
  duringTransfer: { mounts: number };
  /** The raw counts the rate was derived from (so a reader can recompute / audit). */
  rawCounts: {
    mountsTotal: number;
    engagementMinutes: number;
    windowStartTs: number;
    windowEndTs: number;
  };
}
