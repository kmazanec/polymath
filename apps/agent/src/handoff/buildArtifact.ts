import { and, eq, isNull } from 'drizzle-orm';
import { generateTutorQuestions } from '@polymath/graph';
import type { HandoffArtifact, SessionSummary, TutorQuestion } from '@polymath/contract';
import type { Db } from '../db/client.js';
import { learnerState, sessions } from '../db/schema.js';
import { currentLessonId } from '../server.js';
import { loadLesson } from '../lessons/loader.js';
import { buildReport } from '../report/buildReport.js';

/**
 * The tutor-handoff artifact composer (ADR-012 stretch). This is the SOLE coupling
 * point to the session-summary source: it derives `masteredKcs` / `stuckKcs` from
 * the per-(session,kc) `learner_state` BKT rows, and embeds F-18's real
 * `SessionSummary` (via `buildReport`) as the artifact's `summary` field.
 *
 * F-18 landed (I5), so the F-24↔F-18 reconcile happens HERE — the single adapter the
 * F-24 plan said it would be confined to: `summary` is now the real `buildReport`
 * output and `HandoffArtifactSchema.summary` is the real `SessionSummarySchema` (the
 * `z.unknown()` placeholder is gone). The top-level `masteredKcs`/`stuckKcs` stay
 * derived here (they drive the questions node + the view's tiles) and agree with
 * `summary.kcsMastered`/`kcsStuck`.
 *
 * Returns `null` for an unknown session or a session with no learner state (an
 * empty/never-practised session has no artifact to hand off), and never throws.
 */

/** The DI seam — pure async readers so the unit tests need no DB and production
 *  wires them to Postgres + the lesson loader. */
export interface HandoffArtifactDeps {
  /** Does this Polymath session exist? (scoped to `events.app IS NULL` rows via the
   *  session-arm check in the production wiring). */
  sessionExists(sessionId: string): Promise<boolean>;
  /** Per-KC BKT rows for the session. */
  readLearnerKcs(sessionId: string): Promise<{ kc: string; bktProbability: number | null }[]>;
  /** The lesson's BKT mastery threshold (the mastered/stuck split point). */
  masteryThreshold(sessionId: string): Promise<number>;
  /** The questions node. */
  generateQuestions(input: { stuckKcs: string[]; masteredKcs: string[] }): Promise<TutorQuestion[]>;
  /** F-18's session-summary pipeline (`buildReport`). Returns null only for an unknown
   *  session — by the time it is called the session has learner state, so it resolves. */
  getSessionSummary(sessionId: string): Promise<SessionSummary | null>;
}

const WARM_INTRO =
  "I've taken you as far as I usefully can on this on my own. Here's what you've " +
  'nailed, where a human can help most, and exactly what to ask in your next live ' +
  'tutoring session.';

const NERDY_FOOTER =
  'Bring this to your next session with a Nerdy human tutor — they can pick up right ' +
  'where this left off, dig into the questions above, and take you the rest of the way.';

export async function buildHandoffArtifact(
  deps: HandoffArtifactDeps,
  sessionId: string,
): Promise<HandoffArtifact | null> {
  if (!(await deps.sessionExists(sessionId))) return null;

  const rows = await deps.readLearnerKcs(sessionId);
  if (rows.length === 0) return null; // empty/never-practised session — nothing to hand off

  const threshold = await deps.masteryThreshold(sessionId);
  const masteredKcs: string[] = [];
  const stuckKcs: string[] = [];
  for (const row of rows) {
    // A null/absent BKT or one below the lesson threshold is "stuck" — fail toward
    // "worth a tutor's time", never silently into "mastered".
    if (typeof row.bktProbability === 'number' && row.bktProbability >= threshold) {
      masteredKcs.push(row.kc);
    } else {
      stuckKcs.push(row.kc);
    }
  }

  const tutorQuestions = await deps.generateQuestions({ stuckKcs, masteredKcs });

  // F-18's real session summary (the reconcile). The session has learner state here
  // (we returned null above otherwise), so buildReport resolves; the `?? null` guard
  // keeps us null-safe and we fail closed to no-artifact if the summary is somehow
  // unavailable rather than emitting a contract-invalid partial.
  const summary = await deps.getSessionSummary(sessionId);
  if (summary === null) return null;

  // Field order is load-bearing (AC#2): intro -> mastered -> stuck -> questions ->
  // footer. `summary` is F-18's real `SessionSummary` (kcsMastered/kcsStuck agree with
  // the top-level lists derived above from the same learner_state rows).
  const artifact: HandoffArtifact = {
    sessionId,
    generatedAt: new Date().toISOString(),
    warmIntro: WARM_INTRO,
    summary,
    masteredKcs,
    stuckKcs,
    tutorQuestions,
    nerdyFooter: NERDY_FOOTER,
  };
  return artifact;
}

/** Production deps: read `learner_state` scoped to the session, the lesson threshold
 *  via the durable lesson binding, and the real (templates + fail-soft) questions
 *  node. The session-existence check scopes to Polymath rows (`events.app IS NULL`'s
 *  session-level mirror — `sessions.app IS NULL`) so a baseline-arm session id never
 *  yields a Polymath artifact. */
export function makeHandoffArtifactDeps(db: Db): HandoffArtifactDeps {
  return {
    async sessionExists(sessionId) {
      const found = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), isNull(sessions.app)))
        .limit(1);
      return found.length > 0;
    },
    async readLearnerKcs(sessionId) {
      return db
        .select({ kc: learnerState.kc, bktProbability: learnerState.bktProbability })
        .from(learnerState)
        .where(eq(learnerState.sessionId, sessionId));
    },
    async masteryThreshold(sessionId) {
      const lessonId = await currentLessonId(db, sessionId);
      return loadLesson(lessonId).masteryConfig.bktMasteryThreshold;
    },
    generateQuestions: (input) => generateTutorQuestions(input),
    getSessionSummary: (sessionId) => buildReport(db, sessionId),
  };
}
