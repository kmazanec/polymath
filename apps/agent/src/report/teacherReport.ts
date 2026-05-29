import { eq, and, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { learnerState, sessions } from '../db/schema.js';

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
  /** KCs with BKT probability >= BKT_MASTERY_THRESHOLD (heuristic: 0.95).
   *  Derived here for UI convenience; the threshold is the standard one. */
  masteredKcs: string[];
  /** KCs with BKT probability < BKT_MASTERY_THRESHOLD.
   *  These are the "stuck" KCs that guide the focus paragraph. */
  stuckKcs: string[];
}

/** BKT mastery threshold (matches each lesson's mastery_config.json `bktMasteryThreshold`).
 *  The default L1 config uses 0.95; this constant lets the report derive the same
 *  categorical split without a lesson-config DB read. */
const BKT_MASTERY_THRESHOLD = 0.95;

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
    if (typeof p === 'number' && p >= BKT_MASTERY_THRESHOLD) {
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
