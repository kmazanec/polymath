import { eq, and, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { learnerState, sessions } from '../db/schema.js';
import { currentLessonId } from '../server.js';
import { loadLesson } from '../lessons/loader.js';

/**
 * Per-KC mastery snapshot for the teacher report.
 * `bktProbability` is the BKT P(mastered) in [0,1]; `masteryState` is the
 * last-written textual state ('practicing' | 'rule_gate_passed').
 */
export interface KcMasteryRow {
  kc: string;
  bktProbability: number | null;
  masteryState: string | null;
}

/**
 * The teacher report payload: per-KC mastery + categorical lists.
 * Keyed by `sessionId` so the client can confirm it's the right session.
 */
export interface TeacherReportPayload {
  sessionId: string;
  /** ISO-8601 timestamp of when the session started (from `sessions.startedAt`). */
  sessionStartedAt: string | null;
  /** All KC rows in ascending KC-name order. */
  kcRows: KcMasteryRow[];
  /** KCs with BKT probability >= the session's per-lesson `bktMasteryThreshold`. */
  masteredKcs: string[];
  /** KCs with BKT probability < the threshold — the "stuck" KCs that guide focus. */
  stuckKcs: string[];
}

/**
 * Build the teacher report payload for a session.
 * Returns `null` if the session does not exist (→ 404).
 * The session is scoped to Polymath rows (`sessions.app IS NULL`) — a baseline-arm
 * session id must not yield a Polymath report (D3 discriminator, MR !7 review).
 */
export async function buildTeacherReport(
  db: Db,
  sessionId: string,
): Promise<TeacherReportPayload | null> {
  // Verify the session exists and is a Polymath session (not a baseline arm).
  const sessionRows = await db
    .select({ startedAt: sessions.startedAt })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), isNull(sessions.app)))
    .limit(1);

  if (sessionRows.length === 0) return null;

  const sessionStartedAt = sessionRows[0]?.startedAt?.toISOString() ?? null;

  // Use the SESSION'S per-lesson mastery threshold (MR !9 review) — the same source
  // buildHandoffArtifact reads — so the teacher report and the handoff never disagree
  // on mastered vs stuck if a lesson tunes its threshold away from the 0.95 default.
  const lessonId = await currentLessonId(db, sessionId);
  const bktMasteryThreshold = loadLesson(lessonId).masteryConfig.bktMasteryThreshold;

  // Read the per-KC learner state rows for the session.
  const kcRows = await db
    .select({
      kc: learnerState.kc,
      bktProbability: learnerState.bktProbability,
      masteryState: learnerState.masteryState,
    })
    .from(learnerState)
    .where(eq(learnerState.sessionId, sessionId))
    .orderBy(learnerState.kc);

  const masteredKcs: string[] = [];
  const stuckKcs: string[] = [];

  for (const row of kcRows) {
    const p = row.bktProbability;
    if (typeof p === 'number' && p >= bktMasteryThreshold) {
      masteredKcs.push(row.kc);
    } else {
      stuckKcs.push(row.kc);
    }
  }

  return {
    sessionId,
    sessionStartedAt,
    kcRows: kcRows.map((r) => ({
      kc: r.kc,
      bktProbability: r.bktProbability,
      masteryState: r.masteryState,
    })),
    masteredKcs,
    stuckKcs,
  };
}
