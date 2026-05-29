import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { events, learnerState, sessions } from '../db/schema.js';

/**
 * Session-data deletion (ADR-012 privacy posture). When a Polymath session ends —
 * detected server-side from the WebSocket close, NOT a client-sent beacon, which is
 * unreliable — its data is scheduled for deletion after a configurable grace period
 * (default 24h for the eval/replay tool). A boot/interval sweep then HARD-DELETES the
 * session's `events` + `learner_state` once `now >= deleteAfter`.
 *
 * FAIL-CLOSED is the rule: the default is to delete. A session that ends is ALWAYS
 * scheduled (no opt-out path), and the sweep deletes anything past grace; a missing
 * stamp simply isn't swept yet (it gets stamped on the next end). Every read/delete is
 * scoped to `app IS NULL` (the D3 discriminator) so a baseline/other-arm session that
 * happened to share a UUID is never collaterally deleted by Polymath's sweep.
 */

const DEFAULT_GRACE_HOURS = 24;
const MS_PER_HOUR = 60 * 60 * 1000;

/** The configurable grace window (`POLYMATH_SESSION_DATA_GRACE_HOURS`). Defaults to
 *  24h. A non-finite / negative value falls back to the default (a misconfig must not
 *  silently disable the grace or, worse, delete immediately mid-session). */
export function sessionDataGraceHours(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['POLYMATH_SESSION_DATA_GRACE_HOURS'];
  if (raw === undefined || raw === '') return DEFAULT_GRACE_HOURS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_GRACE_HOURS;
  return parsed;
}

/**
 * Mark a Polymath session as ended and schedule its deletion at `endedAt + grace`.
 * Scoped to `app IS NULL` so it only ever touches a Polymath session. Only stamps
 * `endedAt` if not already set (a reconnect/double-close doesn't extend the window),
 * but always (re)affirms `deleteAfter` so a session can't end without a delete stamp.
 * Idempotent and non-throwing-by-contract for the caller — but it does propagate DB
 * errors so the WS-close handler can log them; the handler must not let them escape.
 */
export async function scheduleSessionDeletion(
  db: Db,
  sessionId: string,
  now: Date = new Date(),
  graceHours: number = sessionDataGraceHours(),
): Promise<void> {
  const graceMs = graceHours * MS_PER_HOUR;
  // endedAt: COALESCE so a re-close (a reconnect cycle) keeps the FIRST end time and
  // doesn't keep pushing the window out — otherwise a client that reconnects forever
  // postpones deletion indefinitely (a fail-open drift on a privacy control). The
  // grace is anchored to the *preserved* end (`endedAt + grace`), measured from the
  // real first end; on the first close (endedAt currently NULL) that resolves to
  // `now + grace`. Computed in SQL so the COALESCE sees the existing row value.
  const interval = `${graceMs} milliseconds`;
  await db
    .update(sessions)
    .set({
      endedAt: sql`coalesce(${sessions.endedAt}, ${now})`,
      deleteAfter: sql`coalesce(${sessions.endedAt}, ${now}) + ${interval}::interval`,
    })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.app)));
}

export interface SweepResult {
  sessionsSwept: number;
  eventsDeleted: number;
  learnerStateDeleted: number;
}

/**
 * Hard-delete the data of every Polymath session whose grace has expired
 * (`deleteAfter <= now`). Deletes the session's `events` and `learner_state` rows; the
 * `sessions` row itself is kept as a tombstone (its `deleteAfter` is cleared so it
 * isn't re-swept) so cross-session experiment linkage / counts survive while the
 * learner-identifying interaction data is gone. Scoped to `app IS NULL`.
 *
 * NON-FATAL by design: the caller (boot/interval) wraps this so a sweep failure
 * degrades to "data lingers until the next sweep", never crashing the agent before it
 * serves health.
 */
export async function sweepExpiredSessions(db: Db, now: Date = new Date()): Promise<SweepResult> {
  const expired = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(isNull(sessions.app), lte(sessions.deleteAfter, now)));

  const result: SweepResult = { sessionsSwept: 0, eventsDeleted: 0, learnerStateDeleted: 0 };
  for (const { id } of expired) {
    const delEvents = await db
      .delete(events)
      .where(and(eq(events.sessionId, id), isNull(events.app)));
    const delState = await db.delete(learnerState).where(eq(learnerState.sessionId, id));
    // Clear the stamp so the tombstoned session is not re-swept every interval.
    await db
      .update(sessions)
      .set({ deleteAfter: null })
      .where(and(eq(sessions.id, id), isNull(sessions.app)));
    result.sessionsSwept += 1;
    result.eventsDeleted += delEvents.rowCount ?? 0;
    result.learnerStateDeleted += delState.rowCount ?? 0;
  }
  return result;
}

/**
 * Start a periodic sweep. Returns a stop function. The interval is unref'd so it never
 * keeps the process alive on its own. Each tick is wrapped non-fatally (a sweep error
 * is logged, not thrown). A first sweep runs immediately on start (boot cleanup).
 */
export function startSessionDeletionSweep(
  db: Db,
  intervalMs: number = MS_PER_HOUR,
): () => void {
  const tick = (): void => {
    void sweepExpiredSessions(db).catch((err) => {
      console.error('session-data sweep failed — will retry next interval', err);
    });
  };
  tick();
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  return () => clearInterval(handle);
}
