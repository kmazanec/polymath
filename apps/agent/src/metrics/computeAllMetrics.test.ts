import { describe, expect, it } from 'vitest';
import { computeAllMetrics } from './computeAllMetrics.js';
import type { MetricInputs } from './inputs.js';

/**
 * `computeAllMetrics` aggregates the six pure computations into the ordered metrics
 * list of a `MetricsPayload`. The headline acceptance bar (the "honest gray-heavy"
 * empty state): with NO data, all six are gray (insufficient_data/unconfigured) —
 * NEVER a fabricated green or red.
 */

const EMPTY: MetricInputs = { events: [], subjects: [], metric3Enabled: false, uiChurn: undefined };

describe('computeAllMetrics', () => {
  it('emits exactly six metrics in a stable order', () => {
    const m = computeAllMetrics(EMPTY);
    expect(m).toHaveLength(6);
    expect(m.map((x) => x.id)).toEqual([
      'ui_churn',
      'intelligibility',
      'visual_utility',
      'dependency_check',
      'rubric_transfer_kappa',
      'false_positive_rate',
    ]);
  });

  it('the N=0 empty state is entirely gray — no metric is a pass or a fail', () => {
    const m = computeAllMetrics(EMPTY);
    for (const metric of m) {
      expect(['insufficient_data', 'unconfigured']).toContain(metric.state);
      expect(metric.pass).toBeNull();
      expect(metric.value).toBeNull();
    }
    // Specifically: metric1 + metric3 are unconfigured; the other four insufficient.
    const byId = Object.fromEntries(m.map((x) => [x.id, x]));
    expect(byId.ui_churn!.state).toBe('unconfigured');
    expect(byId.visual_utility!.state).toBe('unconfigured');
    expect(byId.intelligibility!.state).toBe('insufficient_data');
    expect(byId.dependency_check!.state).toBe('insufficient_data');
    expect(byId.rubric_transfer_kappa!.state).toBe('insufficient_data');
    expect(byId.false_positive_rate!.state).toBe('insufficient_data');
  });

  it('threads the metric3 enable flag through to visual_utility', () => {
    const enabled = computeAllMetrics({ ...EMPTY, metric3Enabled: true });
    const vu = enabled.find((x) => x.id === 'visual_utility')!;
    // Enabled but no arm data ⇒ insufficient (not unconfigured).
    expect(vu.state).toBe('insufficient_data');
  });

  it('threads the churn adapter through to ui_churn', () => {
    const withChurn = computeAllMetrics({ ...EMPTY, uiChurn: { mountsPerMinute: 2, sampleN: 30 } });
    const churn = withChurn.find((x) => x.id === 'ui_churn')!;
    expect(churn.state).toBe('pass');
    expect(churn.value).toBe(2);
  });
});
