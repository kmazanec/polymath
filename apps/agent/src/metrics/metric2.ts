import type { MetricResult } from './types.js';
import { MIN_N, type MetricEventRow } from './inputs.js';

/**
 * Metric 2 — INTELLIGIBILITY (ADR-011). After ~1-in-3 component mounts the learner is
 * asked "did that change make sense?"; this folds the yes/no/skip answers
 * (`intelligibility_response` events, persisted under `events.app IS NULL`).
 *
 * value = yes / (yes + no). A SKIP is "no opinion" — excluded from BOTH numerator and
 * denominator (counting it as a no would punish the metric for a learner who just
 * dismissed the prompt). sampleN = yes + no; < MIN_N (=5) ⇒ `insufficient_data`.
 *
 * `pass` = yes-rate ≥ threshold (0.8).
 */
const INTELLIGIBILITY_THRESHOLD = 0.8;

export function computeIntelligibility(events: MetricEventRow[]): MetricResult {
  let yes = 0;
  let no = 0;
  for (const e of events) {
    if (e.kind !== 'intelligibility_response') continue;
    if (e.intelligibilityAnswer === 'yes') yes++;
    else if (e.intelligibilityAnswer === 'no') no++;
    // 'skip' (and any absent answer) excluded by design.
  }

  const sampleN = yes + no;
  const base = {
    id: 'intelligibility',
    label: 'Intelligibility (changes that made sense)',
    threshold: INTELLIGIBILITY_THRESHOLD,
    unit: '%',
    sampleN,
    source: "events (app IS NULL): intelligibility_response yes/(yes+no), skips excluded",
  } as const;

  if (sampleN < MIN_N) {
    return {
      ...base,
      value: null,
      pass: null,
      state: 'insufficient_data',
      note: `need ≥${MIN_N} yes/no answers (have ${sampleN})`,
    };
  }

  const rate = yes / sampleN;
  const pass = rate >= INTELLIGIBILITY_THRESHOLD;
  return { ...base, value: rate, pass, state: pass ? 'pass' : 'fail' };
}
