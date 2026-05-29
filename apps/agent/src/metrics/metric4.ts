import type { MetricResult } from './types.js';
import { MIN_DEPENDENCY_SAMPLES, median, type MetricEventRow } from './inputs.js';

/**
 * Metric 4 — DEPENDENCY CHECK (ADR-011 counter-metric). The safest real metric: it
 * reads data Polymath already persists (no new event kind, no external service), so
 * it is built first.
 *
 * It compares the median time-to-CORRECT on TRANSFER items against the median on
 * PRACTICE items. A learner who solves transfer items roughly as fast as practice
 * items (within +25%) was not leaning on the practice scaffolding; a transfer median
 * that balloons signals a dependency the mastery gate should have caught.
 *
 * - `value` = transferMedian / practiceMedian (a ratio; 1.0 = identical speed).
 * - `pass`  = ratio ≤ 1.25 (within 25%).
 * - `insufficient_data` when EITHER side has fewer than MIN_DEPENDENCY_SAMPLES (=3)
 *   correct, timed samples — a median over 1-2 points is noise, never a tile colour.
 *
 * Only CORRECT submissions count (time-to-CORRECT), and a row without
 * `responseTimeMs` is skipped (it carries no time to fold).
 */
const DEPENDENCY_THRESHOLD = 1.25;

export function computeDependencyCheck(events: MetricEventRow[]): MetricResult {
  const practiceTimes: number[] = [];
  const transferTimes: number[] = [];
  for (const e of events) {
    if (typeof e.responseTimeMs !== 'number') continue;
    if (e.kind === 'submit' && e.submitCorrect === true) practiceTimes.push(e.responseTimeMs);
    else if (e.kind === 'transfer_submitted' && e.transferCorrect === true) {
      transferTimes.push(e.responseTimeMs);
    }
  }

  const sampleN = practiceTimes.length + transferTimes.length;
  const base = {
    id: 'dependency_check',
    label: 'Dependency check (transfer vs practice speed)',
    threshold: DEPENDENCY_THRESHOLD,
    unit: '×',
    sampleN,
    source: 'events (app IS NULL): time-to-correct, transfer vs final practice',
  } as const;

  if (practiceTimes.length < MIN_DEPENDENCY_SAMPLES || transferTimes.length < MIN_DEPENDENCY_SAMPLES) {
    return {
      ...base,
      value: null,
      pass: null,
      state: 'insufficient_data',
      note: `need ≥${MIN_DEPENDENCY_SAMPLES} correct timed samples per side (have practice=${practiceTimes.length}, transfer=${transferTimes.length})`,
    };
  }

  const practiceMedian = median(practiceTimes);
  const transferMedian = median(transferTimes);
  // practiceMedian is a positive responseTimeMs (>0 by construction of the fixtures /
  // real client clock), but guard the degenerate 0 so we never divide by zero.
  if (practiceMedian <= 0) {
    return {
      ...base,
      value: null,
      pass: null,
      state: 'insufficient_data',
      note: 'practice median time is zero — cannot form a ratio',
    };
  }
  const ratio = transferMedian / practiceMedian;
  const pass = ratio <= DEPENDENCY_THRESHOLD;
  return {
    ...base,
    value: ratio,
    pass,
    state: pass ? 'pass' : 'fail',
  };
}
