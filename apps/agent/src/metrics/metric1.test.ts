import { describe, expect, it } from 'vitest';
import { computeUiChurn } from './metric1.js';

/**
 * Metric 1 — UI CHURN RATE (mounts per engaged minute). There is NO mount-event /
 * phase column in the `events` table today (verified), so the metric has no agent-
 * side source: it defaults to `unconfigured` pointing at the observability churn
 * endpoint (D-metric1). It does NOT fabricate a number, and this feature deliberately
 * does NOT add a competing client mount event (that would duplicate the observability
 * workstream and risk two divergent churn definitions).
 *
 * An OPTIONAL churn adapter (the churn-endpoint result) may be supplied; when present
 * the metric reports a real value, when absent it is honestly gray.
 */

describe('metric1 — UI churn', () => {
  it('is UNCONFIGURED with no adapter (no agent-side mount source)', () => {
    const r = computeUiChurn(undefined);
    expect(r.state).toBe('unconfigured');
    expect(r.value).toBeNull();
    expect(r.pass).toBeNull();
    expect(r.source).toContain('churn endpoint');
    expect(r.id).toBe('ui_churn');
  });

  it('passes when an adapter supplies a churn rate at/under threshold', () => {
    const r = computeUiChurn({ mountsPerMinute: 3, sampleN: 40 });
    expect(r.state).toBe('pass');
    expect(r.value).toBe(3);
    expect(r.pass).toBe(true);
  });

  it('fails when the adapter rate exceeds threshold', () => {
    const r = computeUiChurn({ mountsPerMinute: 20, sampleN: 40 });
    expect(r.state).toBe('fail');
    expect(r.pass).toBe(false);
  });

  it('is INSUFFICIENT when the adapter has data but a null rate', () => {
    const r = computeUiChurn({ mountsPerMinute: null, sampleN: 0 });
    expect(r.state).toBe('insufficient_data');
    expect(r.value).toBeNull();
  });
});
