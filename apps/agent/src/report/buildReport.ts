import { and, asc, eq, isNull } from 'drizzle-orm';
import { type SessionSummary } from '@polymath/contract';
import { buildSessionSummary, type SummaryInput } from '@polymath/graph';
import type { Db } from '../db/client.js';
import { events, learnerState, postTestResults, preTestResults, sessions } from '../db/schema.js';
import { loadLessonIfExists } from '../lessons/loader.js';
import { deriveState, type LoggedEvent } from '../mastery/eventConsumer.js';

/** Bounded event window for the in-session fold (mirrors the server's
 *  `MAX_SESSION_EVENTS`). Tactical/aggregate state only — the report is a read-only
 *  snapshot, not an integrity-accumulating counter, so a bounded window is fine. */
const MAX_SESSION_EVENTS = 500;

/** A session's terminal mastery is `mastered` only if the durable learner_state
 *  says so — fail-soft default is `not_started`, never a pass. */
type LessonProgress = { currentLessonId?: number } | null;

/**
 * Build the end-of-session summary report (the body of `GET /api/session/:id/report`).
 *
 * This is the agent-side I/O layer for the summary pipeline: it does ALL the
 * Drizzle reads and hands the already-assembled numbers to `buildSessionSummary`
 * (the pure `@polymath/graph` pipeline, which owns the composition + contract shape).
 * The split mirrors `explainback/` — the subgraph never touches the DB.
 *
 * Provenance (D-fallback): a session linked to an experiment subject reads the
 * frozen pre/post-test tables (`source:'experiment'`); otherwise it falls back to an
 * in-session post-test proxy from the bounded event fold (`source:'in_session'`,
 * `preTestScore:null`, `growthMultiplier:null` — the designed graceful state, not a
 * failure). NO LLM call; fully deterministic.
 *
 * Every read scopes to `events.app IS NULL` (the D3 discriminator) so a foreign-app
 * row sharing a session id can never fold into the in-session post proxy.
 *
 * Returns `null` for an unknown session so the route answers 404.
 */
export async function buildReport(db: Db, sessionId: string): Promise<SessionSummary | null> {
  const sessionRows = await db
    .select({
      id: sessions.id,
      subjectId: sessions.subjectId,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      lessonProgress: sessions.lessonProgress,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session) return null;

  const lessonId =
    typeof (session.lessonProgress as LessonProgress)?.currentLessonId === 'number'
      ? (session.lessonProgress as { currentLessonId: number }).currentLessonId
      : 1;
  const lesson = loadLessonIfExists(lessonId) ?? loadLessonIfExists(1);

  // The in-session fold (bounded, app-scoped). Drives the in-session post proxy,
  // transfer rate, and the latched explain-back verdict. Chronological for the fold.
  const eventRows = await db
    .select({ kind: events.kind, payload: events.payload })
    .from(events)
    .where(and(eq(events.sessionId, sessionId), isNull(events.app)))
    .orderBy(asc(events.ts))
    .limit(MAX_SESSION_EVENTS);
  const logged: LoggedEvent[] = eventRows.map((r) => projectLoggedEvent(r.kind, r.payload));

  // Production mastery signal: the server resolves an accepted mastery transition into
  // a persisted `mount MasteryCelebration` action. The `learner_state` writer only ever
  // records `rule_gate_passed`/`practicing` (never `'mastered'`), so without reading the
  // log a genuinely-mastered session would mis-report as `practicing`. Read it from the
  // app-scoped event log here. Fail-soft: absent the celebration, masteryStatus keeps
  // its default — never a fabricated pass.
  const reachedMasteryInLog = eventRows.some((r) => {
    const p = (r.payload ?? {}) as { action?: { type?: string; component?: { kind?: string } } };
    return p.action?.type === 'mount' && p.action.component?.kind === 'MasteryCelebration';
  });

  // Transfer probe tally from the raw events (a `transfer_submitted` per probe; the
  // verdict's `transferCorrect` is the server-recomputed pass).
  const transferProbes = logged.reduce(
    (acc, ev) => {
      if (ev.kind === 'transfer_submitted') {
        acc.total += 1;
        if (ev.transferCorrect === true) acc.passed += 1;
      }
      return acc;
    },
    { passed: 0, total: 0 },
  );

  const bktMasteryThreshold = lesson?.masteryConfig.bktMasteryThreshold ?? 0.95;

  // In-session post-test proxy: mean BKT P(mastered) across the KCs the fold touched,
  // in [0,1]. Null when the learner never submitted (no KC) — never a fabricated 0.
  let inSessionPost: number | null = null;
  let explainBackPassed = false;
  if (lesson) {
    const derived = deriveState(logged, lesson.content, lesson.masteryConfig);
    const ps = Object.values(derived.bktByKc).map((p) => p.pMastered);
    inSessionPost = ps.length > 0 ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
    explainBackPassed = derived.explainBackPassed;
  }

  // learner_state → masteryStatus + KC lists (the durable, server-written snapshot).
  const lsRows = await db
    .select({
      kc: learnerState.kc,
      bktProbability: learnerState.bktProbability,
      masteryState: learnerState.masteryState,
    })
    .from(learnerState)
    .where(eq(learnerState.sessionId, sessionId));

  let masteryStatus: SessionSummary['masteryStatus'] = lsRows.length === 0 ? 'not_started' : 'practicing';
  const kcsMastered: string[] = [];
  const kcsStuck: string[] = [];
  for (const row of lsRows) {
    const p = row.bktProbability ?? 0;
    if (p >= bktMasteryThreshold) kcsMastered.push(row.kc);
    else kcsStuck.push(row.kc);
    // A durable terminal status wins. Fail-soft: anything else stays 'practicing'.
    if (row.masteryState === 'mastered') masteryStatus = 'mastered';
    else if (row.masteryState === 'remediating' && masteryStatus !== 'mastered') masteryStatus = 'remediating';
  }
  // The production mastery signal lives in the event log (the celebration mount), not
  // learner_state — promote a session that reached it (unless already remediating off it).
  if (reachedMasteryInLog) masteryStatus = 'mastered';

  // Experiment provenance: a linked subject means the frozen pre/post tables exist.
  const hasExperimentArm = session.subjectId !== null && session.subjectId !== undefined;
  let preTestScore: number | null = null;
  let postTestScore: number | null = inSessionPost;
  if (hasExperimentArm) {
    const subjectId = session.subjectId!;
    const [preRows, postRows] = await Promise.all([
      db
        .select({ correct: preTestResults.correct })
        .from(preTestResults)
        .where(eq(preTestResults.subjectId, subjectId)),
      db
        .select({ correct: postTestResults.correct })
        .from(postTestResults)
        // This is the Polymath arm's post-test (the report is a Polymath session).
        .where(and(eq(postTestResults.subjectId, subjectId), eq(postTestResults.condition, 'polymath'))),
    ]);
    preTestScore = fractionCorrect(preRows);
    // Experiment post score (the held-out arm test) supersedes the in-session proxy.
    postTestScore = fractionCorrect(postRows);
  }

  // Time on task: ended - started (or now - started while in progress). Guarded
  // non-negative; the pipeline re-guards finiteness.
  const startMs = session.startedAt instanceof Date ? session.startedAt.getTime() : Date.parse(String(session.startedAt));
  const endMs = session.endedAt instanceof Date ? session.endedAt.getTime() : session.endedAt ? Date.parse(String(session.endedAt)) : Date.now();
  const timeOnTaskMs = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;

  const input: SummaryInput = {
    preTestScore,
    postTestScore,
    hasExperimentArm,
    timeOnTaskMs,
    transferProbes,
    masteryStatus,
    explainBackVerdict: { passed: explainBackPassed, reasons: [] },
    kcsMastered,
    kcsStuck,
  };
  return buildSessionSummary(input);
}

/** Fraction-correct (0.0–1.0) of a result set, or `null` when empty ("phase not
 *  run"). Local copy of the experiment helper's contract so the report has no
 *  dependency on the experiment route module. */
function fractionCorrect(results: { correct: boolean }[]): number | null {
  if (results.length === 0) return null;
  const n = results.filter((r) => r.correct).length;
  return n / results.length;
}

/** Project a persisted event payload into the consumer's `LoggedEvent`. A read-only
 *  mirror of the server's `toLoggedEvent` projection — the fields the report's fold
 *  reads (correctness, transfer verdict, hints, off-topic, explain-back). Kept local
 *  so the report module doesn't import the server (which imports the report). */
function projectLoggedEvent(kind: string, payload: unknown): LoggedEvent {
  const p = (payload ?? {}) as {
    event?: { itemId?: string; submission?: string; responseTimeMs?: number; targetItemId?: string };
    transferVerdict?: { correct?: boolean };
    action?: { type?: string; component?: { kind?: string }; topicClassification?: string };
    explainBackVerdict?: { passed?: boolean };
  };
  return {
    kind,
    itemId: p.event?.itemId ?? p.event?.targetItemId ?? p.event?.submission,
    submission: p.event?.submission,
    responseTimeMs: p.event?.responseTimeMs,
    transferCorrect: p.transferVerdict?.correct,
    hintMounted: p.action?.type === 'mount' && p.action.component?.kind === 'HintCard',
    offTopic: p.action?.type === 'answer_question' && p.action.topicClassification === 'off_topic',
    explainBackPassed: p.explainBackVerdict?.passed === true,
  };
}
