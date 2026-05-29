import { and, eq, isNull } from 'drizzle-orm';
import { generateTutorQuestions } from '@polymath/graph';
import type { HandoffArtifact, TutorQuestion } from '@polymath/contract';
import type { Db } from '../db/client.js';
import { learnerState, sessions } from '../db/schema.js';
import { currentLessonId } from '../server.js';
import { loadLesson } from '../lessons/loader.js';

/**
 * The tutor-handoff artifact composer (ADR-012 stretch). This is the SOLE coupling
 * point to the session-summary source: it derives `masteredKcs` / `stuckKcs` from
 * the per-(session,kc) `learner_state` BKT rows — the same source the summary
 * pipeline reads — and composes a contract-valid `HandoffArtifact`.
 *
 * The summary pipeline (`getSessionSummary` + `SessionSummarySchema`) is owned
 * elsewhere and is NOT on this branch; the frozen `HandoffArtifactSchema.summary`
 * field is a forward-compatible `z.unknown()` placeholder for exactly this reason.
 * Until that pipeline lands we emit a small forward-compatible summary object here.
 * When it merges, replace this file's inline summary projection with a
 * `getSessionSummary` call and swap the contract placeholder for the real schema —
 * both confined to this one adapter, per the plan.
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

  // Field order is load-bearing (AC#2): intro -> mastered -> stuck -> questions ->
  // footer. `summary` is the forward-compatible placeholder until the summary
  // pipeline lands (see the file header).
  const artifact: HandoffArtifact = {
    sessionId,
    generatedAt: new Date().toISOString(),
    warmIntro: WARM_INTRO,
    summary: {
      kcsMastered: masteredKcs,
      kcsStuck: stuckKcs,
      masteryStatus: stuckKcs.length === 0 ? 'all_kcs_mastered' : 'in_progress',
    },
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
  };
}
