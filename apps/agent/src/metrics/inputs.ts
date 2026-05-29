/**
 * Pure input shapes the six metric computations fold over.
 *
 * The compute functions are deliberately DB-FREE and PURE so they are trivially
 * unit-testable over synthetic fixtures — the Postgres I/O lives in
 * `fetchMetricInputs.ts`, which materialises these rows (every `events` read scoped
 * to `events.app IS NULL`, the D3 discriminator). Keeping the two apart is what lets
 * the metric tests assert behavior on tiny/degenerate N without a database.
 */

/** A single persisted Polymath turn, projected to just what the metrics need. The
 *  shape mirrors `server.ts`'s `payload.{event,transferVerdict,explainBackVerdict}`
 *  slot (the durable turn-write convention). All fields optional — a turn that
 *  doesn't carry a signal simply doesn't contribute to a metric. */
export interface MetricEventRow {
  /** The inbound event kind (`'submit'`, `'transfer_submitted'`, `'intelligibility_response'`, …). */
  kind: string;
  /** Insert timestamp (ms epoch) — ordering, never a value. */
  ts: number;
  /** `payload.event.responseTimeMs` — the learner's client-clock time-on-item. */
  responseTimeMs?: number;
  /** `payload.event.correct` — the client correctness flag for a practice submit. */
  submitCorrect?: boolean;
  /** `payload.transferVerdict.correct` — the SERVER-computed transfer verdict. */
  transferCorrect?: boolean;
  /** `intelligibility_response.answer` — the learner's yes/no/skip clarity rating. */
  intelligibilityAnswer?: 'yes' | 'no' | 'skip';
  /** Metric-3 split-arm marker (`payload.event.circuitSuppressed`), DORMANT by default. */
  circuitSuppressed?: boolean;
}

/** A subject's experiment outcome rows (the experiment tables), projected for metrics 5 + 6. */
export interface MetricSubjectRow {
  subjectId: string;
  /** Whether this subject was declared mastered in their Polymath session (for metric 6). */
  declaredMastered: boolean;
  /** The held-out follow-up (24h) result correctness, if a follow-up was recorded. */
  followupCorrect?: boolean;
  /** The explain-back rubric verdict (pass/fail), for the metric-5 κ table. */
  explainBackPassed?: boolean;
  /** The held-out transfer verdict (pass/fail), for the metric-5 κ table. */
  transferPassed?: boolean;
}

/** Everything the six computations need, materialised once by `fetchMetricInputs`. */
export interface MetricInputs {
  events: MetricEventRow[];
  subjects: MetricSubjectRow[];
  /** Optional UI-churn adapter result (metric 1's source is the observability churn
   *  endpoint, not the events table; absent ⇒ metric 1 is `unconfigured`). */
  uiChurn?: { mountsPerMinute: number | null; sampleN: number } | undefined;
  /** Whether the metric-3 circuit-suppression split-test is enabled (env opt-in).
   *  Off ⇒ metric 3 is `unconfigured` (designed-for + dormant, D6). */
  metric3Enabled?: boolean;
}

/** D7: the minimum sample size below which a metric reports `insufficient_data`
 *  (value/pass null) rather than a number a reviewer would over-read on N<5. */
export const MIN_N = 5;

/** The minimum count of correct samples per side for the dependency-check median
 *  to be meaningful (a median over <3 points is noise). */
export const MIN_DEPENDENCY_SAMPLES = 3;

/** The median of a numeric list (average of the two middles for an even count).
 *  Assumes a non-empty input (callers guard the empty case). */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
