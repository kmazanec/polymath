import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  events,
  experimentSubjects,
  followupResults,
} from '../db/schema.js';
import type { MetricEventRow, MetricInputs, MetricSubjectRow } from './inputs.js';

/**
 * The single DB-I/O seam for the counter-metrics. It materialises every row the six
 * PURE computations fold over, so the compute functions stay DB-free and unit-testable
 * (see `inputs.ts`). Keeping all the SQL here is also what lets the
 * `events.app IS NULL` discriminator be applied UNIFORMLY: every `events` read below
 * scopes to Polymath rows only (NULL=polymath, 'baseline'=the chat-baseline arm), so a
 * foreign-app row can never fold into the dependency-check / intelligibility / visual-
 * utility metrics — mirroring `countOffTopicAnswers`.
 *
 * Experiment reads (metrics 5 + 6) join the subject tables and honour the FROZEN CSV
 * semantics: a phase with no rows is "not run" (the subject is simply excluded from the
 * metric's denominator), NEVER scored as 0.
 *
 * `metric3Enabled` reflects the (default-off) circuit-suppression split-test opt-in;
 * the churn `uiChurn` adapter is intentionally absent (metric 1 is unconfigured until
 * the observability churn endpoint is wired through here).
 */

/** What the metric-2/3/4 folds read out of a persisted `events.payload`. */
interface PersistedPayload {
  event?: {
    kind?: string;
    correct?: boolean;
    responseTimeMs?: number;
    answer?: 'yes' | 'no' | 'skip';
    circuitSuppressed?: boolean;
  };
  transferVerdict?: { correct?: boolean };
  explainBackVerdict?: { passed?: boolean };
  gateEvaluation?: { passed?: boolean };
}

/** The follow-up pass bar: a subject "passed" the 24h 3rd-rep follow-up when the
 *  majority of their follow-up items were correct. Below it ⇒ a false positive. */
const FOLLOWUP_PASS_FRACTION = 0.5;

export async function fetchMetricInputs(db: Db, opts: { metric3Enabled?: boolean } = {}): Promise<MetricInputs> {
  // 1) All Polymath event rows (app IS NULL), projected to the metric fields. One scan
  //    feeds the dependency-check, intelligibility, and visual-utility folds.
  const rawEvents = await db
    .select({ kind: events.kind, ts: events.ts, payload: events.payload })
    .from(events)
    .where(isNull(events.app))
    .orderBy(events.ts);

  const eventRows: MetricEventRow[] = rawEvents.map((r) => {
    const p = (r.payload ?? {}) as PersistedPayload;
    const ev = p.event ?? {};
    const row: MetricEventRow = { kind: r.kind, ts: r.ts instanceof Date ? r.ts.getTime() : Number(r.ts) };
    if (typeof ev.responseTimeMs === 'number') row.responseTimeMs = ev.responseTimeMs;
    if (typeof ev.correct === 'boolean') row.submitCorrect = ev.correct;
    if (typeof p.transferVerdict?.correct === 'boolean') row.transferCorrect = p.transferVerdict.correct;
    if (ev.answer === 'yes' || ev.answer === 'no' || ev.answer === 'skip') {
      row.intelligibilityAnswer = ev.answer;
    }
    if (typeof ev.circuitSuppressed === 'boolean') row.circuitSuppressed = ev.circuitSuppressed;
    return row;
  });

  // 2) Per-subject experiment signals (metrics 5 + 6). For each subject we derive,
  //    from their Polymath session's event log, whether they were declared mastered,
  //    and the explain-back / transfer verdicts; the follow-up correctness comes from
  //    `followupResults`. A phase with no rows is "not run" → the field is omitted and
  //    the metric excludes that subject from its denominator (never scores it 0).
  const subjects = await db
    .select({
      id: experimentSubjects.id,
      polymathSessionId: experimentSubjects.polymathSessionId,
    })
    .from(experimentSubjects);

  const subjectRows: MetricSubjectRow[] = [];
  for (const s of subjects) {
    const row: MetricSubjectRow = { subjectId: s.id, declaredMastered: false };

    if (s.polymathSessionId) {
      const sessionEvents = await db
        .select({ payload: events.payload })
        .from(events)
        .where(and(eq(events.sessionId, s.polymathSessionId), isNull(events.app)));
      for (const e of sessionEvents) {
        const p = (e.payload ?? {}) as PersistedPayload;
        if (p.gateEvaluation?.passed === true) row.declaredMastered = true;
        if (typeof p.explainBackVerdict?.passed === 'boolean') row.explainBackPassed = p.explainBackVerdict.passed;
        if (typeof p.transferVerdict?.correct === 'boolean') row.transferPassed = p.transferVerdict.correct;
      }
    }

    const followup = await db
      .select({ correct: followupResults.correct })
      .from(followupResults)
      .where(eq(followupResults.subjectId, s.id));
    if (followup.length > 0) {
      const correct = followup.filter((f) => f.correct).length;
      row.followupCorrect = correct / followup.length >= FOLLOWUP_PASS_FRACTION;
    }

    subjectRows.push(row);
  }

  return {
    events: eventRows,
    subjects: subjectRows,
    metric3Enabled: opts.metric3Enabled ?? false,
    // Metric 1 has no agent-side source today (D-metric1): no churn adapter wired here.
    uiChurn: undefined,
  };
}
