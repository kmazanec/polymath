import { describe, expect, it } from 'vitest';
import { computeUiChurn, type UiChurnEventRow } from './uiChurn.js';

/**
 * `computeUiChurn` is the pure fold behind `GET /api/session/:id/observability/ui-churn`.
 * It counts ONLY `ui_mount` beacons, scoped to `app IS NULL` (the D3 discriminator —
 * a foreign-app row sharing a sessionId must never inflate the rate), derives engaged
 * minutes from first→last mount timestamp, groups by the beacon's `phase`, surfaces
 * transfer-phase mounts separately (ADR-011 wants ~0 during a probe), and FAILS CLOSED
 * to `insufficient_data` on a short/sparse session rather than fabricating a rate/NaN.
 */

const SID = '11111111-1111-1111-1111-111111111111';

function mount(
  tsMs: number,
  phase: string,
  componentKind = 'truth_table',
  app: string | null = null,
): UiChurnEventRow {
  return {
    kind: 'ui_mount',
    ts: new Date(tsMs),
    app,
    payload: { componentKind, phase },
  };
}

describe('computeUiChurn', () => {
  it('counts only ui_mount beacons, ignoring other kinds', () => {
    const t0 = 1_700_000_000_000;
    const rows: UiChurnEventRow[] = [
      mount(t0, 'practicing'),
      { kind: 'submit', ts: new Date(t0 + 1000), app: null, payload: {} },
      mount(t0 + 60_000, 'practicing'),
      { kind: 'action', ts: new Date(t0 + 90_000), app: null, payload: {} },
      mount(t0 + 120_000, 'practicing'),
    ];
    const result = computeUiChurn(SID, rows);
    expect(result.status).toBe('ok');
    expect(result.rawCounts.mountsTotal).toBe(3);
  });

  it('rejects foreign-app rows (app IS NULL scope, D3 discriminator)', () => {
    const t0 = 1_700_000_000_000;
    const rows: UiChurnEventRow[] = [
      mount(t0, 'practicing'),
      mount(t0 + 30_000, 'practicing', 'truth_table', 'baseline'), // foreign — must be ignored
      mount(t0 + 60_000, 'practicing'),
      mount(t0 + 90_000, 'practicing'),
    ];
    const result = computeUiChurn(SID, rows);
    expect(result.rawCounts.mountsTotal).toBe(3);
  });

  it('derives engagement minutes from first→last mount timestamp', () => {
    const t0 = 1_700_000_000_000;
    // 4 mounts over exactly 2 minutes => 4 / 2 = 2 mounts/min
    const rows: UiChurnEventRow[] = [
      mount(t0, 'practicing'),
      mount(t0 + 40_000, 'practicing'),
      mount(t0 + 80_000, 'practicing'),
      mount(t0 + 120_000, 'practicing'),
    ];
    const result = computeUiChurn(SID, rows);
    expect(result.status).toBe('ok');
    expect(result.rawCounts.engagementMinutes).toBeCloseTo(2, 5);
    expect(result.mountsPerMinute).toBeCloseTo(2, 5);
    expect(result.rawCounts.windowStartTs).toBe(t0);
    expect(result.rawCounts.windowEndTs).toBe(t0 + 120_000);
  });

  it('groups mounts by phase with per-phase rate', () => {
    const t0 = 1_700_000_000_000;
    const rows: UiChurnEventRow[] = [
      mount(t0, 'introducing'),
      mount(t0 + 60_000, 'practicing'),
      mount(t0 + 90_000, 'practicing'),
      mount(t0 + 120_000, 'practicing'),
    ];
    const result = computeUiChurn(SID, rows);
    expect(result.byPhase['introducing']?.mounts).toBe(1);
    expect(result.byPhase['practicing']?.mounts).toBe(3);
    // engagement window = 2 min total; per-phase rate uses the same engaged-minutes
    // denominator so the phase rates are comparable shares of one timeline.
    expect(result.byPhase['practicing']?.mountsPerMinute).toBeCloseTo(1.5, 5);
  });

  it('surfaces transfer-phase mounts separately (ADR-011 probe integrity)', () => {
    const t0 = 1_700_000_000_000;
    const rows: UiChurnEventRow[] = [
      mount(t0, 'practicing'),
      mount(t0 + 60_000, 'transferring'),
      mount(t0 + 120_000, 'practicing'),
    ];
    const result = computeUiChurn(SID, rows);
    expect(result.duringTransfer.mounts).toBe(1);
  });

  it('fails closed to insufficient_data when the window is too short', () => {
    const t0 = 1_700_000_000_000;
    // Two mounts 10s apart => 0.167 min < 0.5 min honesty floor.
    const rows: UiChurnEventRow[] = [mount(t0, 'practicing'), mount(t0 + 10_000, 'practicing')];
    const result = computeUiChurn(SID, rows);
    expect(result.status).toBe('insufficient_data');
    expect(result.mountsPerMinute).toBeNull();
    // raw counts still surfaced for audit.
    expect(result.rawCounts.mountsTotal).toBe(2);
  });

  it('fails closed to insufficient_data when too few mounts', () => {
    const t0 = 1_700_000_000_000;
    // One lone mount over a long span: not enough to characterise churn.
    const rows: UiChurnEventRow[] = [mount(t0, 'practicing')];
    const result = computeUiChurn(SID, rows);
    expect(result.status).toBe('insufficient_data');
    expect(result.mountsPerMinute).toBeNull();
  });

  it('fails closed with zero mounts (never NaN / divide-by-zero)', () => {
    const result = computeUiChurn(SID, []);
    expect(result.status).toBe('insufficient_data');
    expect(result.mountsPerMinute).toBeNull();
    expect(result.rawCounts.mountsTotal).toBe(0);
    expect(result.rawCounts.engagementMinutes).toBe(0);
    expect(Number.isNaN(result.rawCounts.engagementMinutes)).toBe(false);
  });

  it('echoes the sessionId', () => {
    const result = computeUiChurn(SID, []);
    expect(result.sessionId).toBe(SID);
  });
});
