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

/**
 * One event row as the churn fold sees it. The endpoint's DB query already scopes
 * `app IS NULL`, but the fold re-applies the filter so a foreign-app row can never
 * inflate the rate even if a future caller forgets the scope (defence in depth — the
 * D3 discriminator is only protective if applied at the read site, CLAUDE.md).
 */
export interface UiChurnEventRow {
  kind: string;
  ts: Date;
  app: string | null;
  payload: unknown;
}

/**
 * Honesty floor (D-plan): below this much engaged time OR below this many mounts the
 * session is too sparse to characterise churn — we report `insufficient_data` rather
 * than a fabricated rate (or a divide-by-near-zero blowup). Fail closed: a near-empty
 * session must never read as a clean zero-churn pass.
 */
const MIN_ENGAGEMENT_MINUTES = 0.5;
const MIN_MOUNTS = 2;
const TRANSFER_PHASE = 'transferring';

function mountPhase(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'phase' in payload) {
    const p = (payload as { phase?: unknown }).phase;
    if (typeof p === 'string') return p;
  }
  return 'unknown';
}

/**
 * Pure fold: count `ui_mount` beacons into a mounts-per-engaged-minute rate, grouped
 * by phase, with transfer-phase mounts surfaced separately. Scoped to `app IS NULL`.
 * NEVER returns NaN/Infinity: the rate is only computed once the honesty floor is met,
 * otherwise `status:'insufficient_data'` with `mountsPerMinute:null`.
 */
export function computeUiChurn(sessionId: string, rows: UiChurnEventRow[]): UiChurnResponse {
  const mounts = rows
    .filter((r) => r.kind === 'ui_mount' && r.app === null)
    .map((r) => ({ tsMs: r.ts.getTime(), phase: mountPhase(r.payload) }))
    .sort((a, b) => a.tsMs - b.tsMs);

  const mountsTotal = mounts.length;
  const windowStartTs = mountsTotal > 0 ? mounts[0]!.tsMs : 0;
  const windowEndTs = mountsTotal > 0 ? mounts[mountsTotal - 1]!.tsMs : 0;
  const engagementMinutes = mountsTotal > 0 ? (windowEndTs - windowStartTs) / 60_000 : 0;

  const phaseMounts = new Map<string, number>();
  let duringTransfer = 0;
  for (const m of mounts) {
    phaseMounts.set(m.phase, (phaseMounts.get(m.phase) ?? 0) + 1);
    if (m.phase === TRANSFER_PHASE) duringTransfer += 1;
  }

  const rawCounts = { mountsTotal, engagementMinutes, windowStartTs, windowEndTs };

  // Fail closed: too few mounts or too little engaged time => no rate.
  if (mountsTotal < MIN_MOUNTS || engagementMinutes < MIN_ENGAGEMENT_MINUTES) {
    return {
      sessionId,
      status: 'insufficient_data',
      mountsPerMinute: null,
      byPhase: {},
      duringTransfer: { mounts: duringTransfer },
      rawCounts,
    };
  }

  const byPhase: Record<string, UiChurnPhaseEntry> = {};
  for (const [phase, count] of phaseMounts) {
    byPhase[phase] = { mounts: count, mountsPerMinute: count / engagementMinutes };
  }

  return {
    sessionId,
    status: 'ok',
    mountsPerMinute: mountsTotal / engagementMinutes,
    byPhase,
    duringTransfer: { mounts: duringTransfer },
    rawCounts,
  };
}
