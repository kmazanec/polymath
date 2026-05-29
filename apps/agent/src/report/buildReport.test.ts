import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { SessionSummarySchema } from '@polymath/contract';
import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { canRunPg, ensureTestPg } from '../db/testPg.js';
import {
  events,
  experimentSubjects,
  learnerState,
  postTestResults,
  preTestResults,
  sessions,
} from '../db/schema.js';
import { buildReport } from './buildReport.js';

let db: Db;
let pool: { end: () => Promise<void> };

/** Log a `submit` event in the shape `toLoggedEvent`/`deriveState` consume:
 *  the payload nests the client frame under `event`. We use L1's known items so the
 *  server-side recompute scores them. */
async function logSubmit(sessionId: string, itemId: string, submission: string): Promise<void> {
  await db.insert(events).values({
    sessionId,
    kind: 'submit',
    payload: { event: { kind: 'submit', sessionId, itemId, submission } },
  });
}

describe.skipIf(!canRunPg)('buildReport', () => {
  beforeAll(async () => {
    const url = await ensureTestPg();
    await runMigrations(url);
    ({ db, pool } = createDb(url));
  }, 60000);

  beforeEach(async () => {
    // Isolate each test: clear every table this suite touches in one CASCADE so the
    // sessions↔experiment_subjects FK cycle doesn't block deletion ordering.
    await db.execute(
      sql`TRUNCATE TABLE pre_test_results, post_test_results, learner_state, events, experiment_subjects, sessions RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  it('returns null for an unknown session (⇒ 404)', async () => {
    const result = await buildReport(db, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('in-session session: source=in_session, preTestScore null, growth null, contract-valid', async () => {
    const [s] = await db.insert(sessions).values({ lessonProgress: { currentLessonId: 1 } }).returning({ id: sessions.id });
    const sessionId = s!.id;
    // One correct + one wrong submit on L1 items so the post-test proxy is meaningful.
    await logSubmit(sessionId, 'l1-and', 'A AND B'); // correct
    await logSubmit(sessionId, 'l1-or', 'A AND A'); // wrong

    const summary = await buildReport(db, sessionId);
    expect(summary).not.toBeNull();
    expect(SessionSummarySchema.safeParse(summary).success).toBe(true);
    expect(summary!.source).toBe('in_session');
    expect(summary!.preTestScore).toBeNull();
    expect(summary!.growthMultiplier).toBeNull();
    expect(summary!.timeOnTaskMs).toBeGreaterThanOrEqual(0);
  });

  it('experiment session: source=experiment, scores from pre/post fractionCorrect, growth computed', async () => {
    const [subj] = await db
      .insert(experimentSubjects)
      .values({ conditionOrder: 'polymath_first', followupToken: 'tok-' + Math.random().toString(36).slice(2) })
      .returning({ id: experimentSubjects.id });
    const subjectId = subj!.id;
    const [s] = await db
      .insert(sessions)
      .values({ subjectId, lessonProgress: { currentLessonId: 1 } })
      .returning({ id: sessions.id });
    const sessionId = s!.id;

    // Pre-test: 1/4 correct ⇒ 0.25.
    await db.insert(preTestResults).values([
      { subjectId, itemId: 'p1', submission: 'x', correct: true },
      { subjectId, itemId: 'p2', submission: 'x', correct: false },
      { subjectId, itemId: 'p3', submission: 'x', correct: false },
      { subjectId, itemId: 'p4', submission: 'x', correct: false },
    ]);
    // Polymath-arm post-test: 3/4 correct ⇒ 0.75.
    await db.insert(postTestResults).values([
      { subjectId, condition: 'polymath', itemId: 'q1', submission: 'x', correct: true },
      { subjectId, condition: 'polymath', itemId: 'q2', submission: 'x', correct: true },
      { subjectId, condition: 'polymath', itemId: 'q3', submission: 'x', correct: true },
      { subjectId, condition: 'polymath', itemId: 'q4', submission: 'x', correct: false },
    ]);

    const summary = await buildReport(db, sessionId);
    expect(summary).not.toBeNull();
    expect(summary!.source).toBe('experiment');
    expect(summary!.preTestScore).toBeCloseTo(0.25);
    expect(summary!.postTestScore).toBeCloseTo(0.75);
    // growth = (0.75-0.25)/max(0.25,0.25) = 2.0
    expect(summary!.growthMultiplier).toBeCloseTo(2.0);
  });

  it('mastered learner_state surfaces masteryStatus=mastered + kcsMastered', async () => {
    const [s] = await db.insert(sessions).values({ lessonProgress: { currentLessonId: 1 } }).returning({ id: sessions.id });
    const sessionId = s!.id;
    await db.insert(learnerState).values({
      sessionId,
      kc: 'and',
      bktProbability: 0.97,
      masteryState: 'mastered',
      signals: {},
    });

    const summary = await buildReport(db, sessionId);
    expect(summary!.masteryStatus).toBe('mastered');
    expect(summary!.kcsMastered).toContain('and');
  });

  it('promotes masteryStatus=mastered from the persisted MasteryCelebration mount (production signal)', async () => {
    // The learner_state writer only records rule_gate_passed/practicing — the
    // production mastery signal is the celebration mount persisted at payload.action.
    const [s] = await db.insert(sessions).values({ lessonProgress: { currentLessonId: 1 } }).returning({ id: sessions.id });
    const sessionId = s!.id;
    await db.insert(learnerState).values({
      sessionId,
      kc: 'and',
      bktProbability: 0.97,
      masteryState: 'rule_gate_passed', // NOT 'mastered' — mirrors the real writer
      signals: {},
    });
    await db.insert(events).values({
      sessionId,
      kind: 'submit',
      payload: { action: { type: 'mount', component: { kind: 'MasteryCelebration' } } },
    });

    const summary = await buildReport(db, sessionId);
    expect(summary!.masteryStatus).toBe('mastered');
  });
});
