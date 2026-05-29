import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { canRunPg, ensureTestPg } from '../db/testPg.js';
import { events, learnerState, sessions } from '../db/schema.js';
import {
  scheduleSessionDeletion,
  sessionDataGraceHours,
  sweepExpiredSessions,
} from './sessionDeletion.js';

/**
 * Session-data deletion (ADR-012 / AC#9): a session that ends is scheduled for
 * deletion after a grace period; the sweep hard-deletes the session's events +
 * learner_state once past grace. Verifies the fail-closed default (a session that
 * ends is always scheduled), the grace window, the hard-delete, and the `app IS NULL`
 * scoping (a baseline-arm session sharing nothing is never collaterally deleted).
 */

let db: Db;
let pool: { end: () => Promise<void> };

async function seedSession(opts: { app: string | null }): Promise<string> {
  const [row] = await db.insert(sessions).values({ app: opts.app }).returning({ id: sessions.id });
  const id = row!.id;
  await db.insert(events).values({
    sessionId: id,
    kind: 'submit',
    payload: { x: 1 },
    app: opts.app,
  });
  await db.insert(learnerState).values({
    sessionId: id,
    kc: 'AND',
    bktProbability: 0.5,
    masteryState: 'practicing',
  });
  return id;
}

async function counts(sessionId: string): Promise<{ events: number; state: number }> {
  const ev = await db.select().from(events).where(eq(events.sessionId, sessionId));
  const st = await db.select().from(learnerState).where(eq(learnerState.sessionId, sessionId));
  return { events: ev.length, state: st.length };
}

describe.skipIf(!canRunPg)('session-data deletion', () => {
  beforeAll(async () => {
    const url = await ensureTestPg();
    await runMigrations(url);
    ({ db, pool } = createDb(url));
  }, 60000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
  });

  it('grace hours default to 24 and respect a configured override', () => {
    expect(sessionDataGraceHours({})).toBe(24);
    expect(sessionDataGraceHours({ POLYMATH_SESSION_DATA_GRACE_HOURS: '1' })).toBe(1);
    // A bad value falls back to the default (never disables grace / deletes immediately).
    expect(sessionDataGraceHours({ POLYMATH_SESSION_DATA_GRACE_HOURS: 'nonsense' })).toBe(24);
    expect(sessionDataGraceHours({ POLYMATH_SESSION_DATA_GRACE_HOURS: '-5' })).toBe(24);
  });

  it('schedules deletion on session end (fail-closed default: always stamped)', async () => {
    const id = await seedSession({ app: null });
    const now = new Date();
    await scheduleSessionDeletion(db, id, now, 24);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
    expect(row?.endedAt).not.toBeNull();
    expect(row?.deleteAfter).not.toBeNull();
    // deleteAfter is ~24h after now.
    const delta = row!.deleteAfter!.getTime() - now.getTime();
    expect(delta).toBeGreaterThan(23 * 3600_000);
    expect(delta).toBeLessThan(25 * 3600_000);
  });

  it('a re-close keeps the FIRST end time and does not extend the window', async () => {
    const id = await seedSession({ app: null });
    const firstEnd = new Date();
    await scheduleSessionDeletion(db, id, firstEnd, 24);
    const [first] = await db.select().from(sessions).where(eq(sessions.id, id));
    const firstDeleteAfter = first!.deleteAfter!.getTime();
    // A reconnect/double-close an hour later must NOT push endedAt or deleteAfter out
    // (otherwise a client reconnecting forever postpones deletion — a fail-open drift).
    const laterClose = new Date(firstEnd.getTime() + 3600_000);
    await scheduleSessionDeletion(db, id, laterClose, 24);
    const [second] = await db.select().from(sessions).where(eq(sessions.id, id));
    expect(second!.endedAt!.getTime()).toBe(first!.endedAt!.getTime());
    expect(second!.deleteAfter!.getTime()).toBe(firstDeleteAfter);
  });

  it('does NOT delete a session still within its grace window', async () => {
    const id = await seedSession({ app: null });
    // Scheduled to delete 24h from now → not yet expired.
    await scheduleSessionDeletion(db, id, new Date(), 24);
    await sweepExpiredSessions(db, new Date());
    expect(await counts(id)).toEqual({ events: 1, state: 1 });
  });

  it('hard-deletes events + learner_state once past grace', async () => {
    const id = await seedSession({ app: null });
    const ended = new Date();
    await scheduleSessionDeletion(db, id, ended, 24);
    // Sweep at a time 25h after the end → past grace.
    const future = new Date(ended.getTime() + 25 * 3600_000);
    const res = await sweepExpiredSessions(db, future);
    expect(res.sessionsSwept).toBeGreaterThanOrEqual(1);
    expect(await counts(id)).toEqual({ events: 0, state: 0 });
    // The session row survives as a tombstone, with deleteAfter cleared (not re-swept).
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
    expect(row).toBeDefined();
    expect(row?.deleteAfter).toBeNull();
  });

  it('never schedules or deletes a non-Polymath (baseline-arm) session', async () => {
    const baselineId = await seedSession({ app: 'baseline' });
    // scheduleSessionDeletion is app IS NULL-scoped → a no-op on a baseline session.
    await scheduleSessionDeletion(db, baselineId, new Date(), 0);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, baselineId));
    expect(row?.deleteAfter).toBeNull();
    // Even if a baseline session somehow carried an expired deleteAfter, the sweep's
    // app IS NULL filter leaves its data intact.
    await db
      .update(sessions)
      .set({ deleteAfter: new Date(Date.now() - 3600_000) })
      .where(eq(sessions.id, baselineId));
    await sweepExpiredSessions(db, new Date());
    const ev = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, baselineId)));
    expect(ev.length).toBe(1);
    // And a NULL-app integrity read over this session sees nothing (the discriminator).
    const polymathScoped = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, baselineId), isNull(events.app)));
    expect(polymathScoped.length).toBe(0);
  });
});
