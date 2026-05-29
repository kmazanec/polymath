import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { seedTransferBank } from '../db/seed.js';
import { canRunPg, ensureTestPg } from '../db/testPg.js';
import { StubAgentClient } from '../agent/stubClient.js';
import { createServer, type PolymathServer } from '../server.js';
import { experimentSubjects, preTestResults, sessions } from '../db/schema.js';
import { CSV_COLUMNS } from './csv.js';

/**
 * F-17 full subject lifecycle, end-to-end against a real Postgres + the real
 * HTTP server (the experiment route dispatcher). OFFLINE — no OPENAI_API_KEY: the
 * session "legs" are injected as fixtures (no LLM lesson is run), and scoring is
 * the shared deterministic `scoreEquivalence`.
 *
 * Exercises:
 *   create subject → pretest start/submit → link two sessions → posttest (both
 *   conditions) → followup (different surface form) → export.csv (frozen shape).
 * Plus: the item-exclusion gate (a pretest item never reappears in the posttest),
 * the DB composite-PK backstop, and follow-up expiry (410 when backdated).
 */

let db: Db;
let pool: { end: () => Promise<void> };
let server: PolymathServer;
let baseUrl: string;

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Create a raw polymath session row and return its id (a stand-in for a real
 *  WS lesson leg, which needs no LLM here). */
async function newSession(): Promise<string> {
  const res = await post('/api/session');
  const json = (await res.json()) as { sessionId: string };
  return json.sessionId;
}

describe.skipIf(!canRunPg)('F-17 experiment lifecycle', () => {
  beforeAll(async () => {
    const url = await ensureTestPg();
    await runMigrations(url);
    ({ db, pool } = createDb(url));
    server = createServer({ db, agent: new StubAgentClient() });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  }, 60000);

  // Re-assert this suite's precondition before EVERY test: the L1 transfer bank is
  // fully seeded (8 items — design (ii) has zero slack, so a partial bank yields a
  // 409 from pretest/start). `seedTransferBank` is idempotent. This makes the suite
  // order-independent against the shared test Postgres: `seed.test.ts` deletes/re-seeds
  // `transfer_bank` to exercise its own behavior, and in the full cross-project
  // `pnpm test` run that DELETE could otherwise leave the bank short for an experiment
  // `it`. Owning the precondition here removes that cross-suite coupling.
  beforeEach(async () => {
    await seedTransferBank(db);
  });

  afterAll(async () => {
    await server.close();
    await pool.end().catch(() => {});
  });

  it('runs a subject through the full lifecycle to a frozen-shape CSV', async () => {
    // 1. Create a subject (counterbalanced order + a follow-up token that is NOT
    //    the subject id).
    const createRes = await post('/api/experiment/subjects');
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      subjectId: string;
      conditionOrder: string;
      followupToken: string;
    };
    expect(['polymath_first', 'baseline_first']).toContain(created.conditionOrder);
    expect(created.followupToken).not.toBe(created.subjectId);
    expect(created.followupToken.length).toBeGreaterThanOrEqual(32);
    const { subjectId, followupToken } = created;

    // 2. Pretest: 4 items.
    const preStart = await post(`/api/experiment/subjects/${subjectId}/pretest/start`);
    expect(preStart.status).toBe(200);
    const preItems = ((await preStart.json()) as { items: { itemId: string }[] }).items;
    expect(preItems).toHaveLength(4);
    const preIds = new Set(preItems.map((i) => i.itemId));

    // Submit: known-correct for L1-01-and (A AND B), the rest wrong text.
    const preSubmit = await post(`/api/experiment/subjects/${subjectId}/pretest/submit`, {
      responses: preItems.map((i) => ({
        itemId: i.itemId,
        submission: i.itemId === 'L1-01-and' ? 'A AND B' : 'this is prose not a formula',
      })),
    });
    expect(preSubmit.status).toBe(201);

    // 3. Link two sessions (the polymath + baseline arms) — the CSV joins on these.
    const polySession = await newSession();
    const baseSession = await newSession();
    expect((await post(`/api/experiment/subjects/${subjectId}/session`, { sessionId: polySession, arm: 'polymath' })).status).toBe(200);
    expect((await post(`/api/experiment/subjects/${subjectId}/session`, { sessionId: baseSession, arm: 'baseline' })).status).toBe(200);
    // The barrier linkage column is stamped on the session row.
    const linked = await db.select({ subjectId: sessions.subjectId }).from(sessions).where(eq(sessions.id, polySession));
    expect(linked[0]?.subjectId).toBe(subjectId);

    // 4. Posttest: the 4 REMAINING items (design (ii): one shared held-out set).
    const postStart = await post(`/api/experiment/subjects/${subjectId}/posttest/start`);
    expect(postStart.status).toBe(200);
    const postItems = ((await postStart.json()) as { items: { itemId: string }[] }).items;
    expect(postItems).toHaveLength(4);

    // ITEM-EXCLUSION: no pretest item reappears in the posttest.
    for (const item of postItems) expect(preIds.has(item.itemId)).toBe(false);
    // Together they consume the whole 8-item bank exactly (zero slack, design (ii)).
    expect(new Set([...preIds, ...postItems.map((i) => i.itemId)]).size).toBe(8);

    // Both conditions' post-tests (the same shared items).
    const correctFor = (id: string): string =>
      ({
        'L1-01-and': 'A AND B',
        'L1-02-or': 'A OR B',
        'L1-03-nand': 'NOT (A AND B)',
        'L1-04-not': 'NOT A',
        'L1-05-and-or': 'A AND (B OR C)',
        'L1-06-not-and': 'NOT A AND B AND C',
        'L1-07-nor': 'NOT (A OR B)',
        'L1-08-or-and': '(A OR B) AND C',
      })[id] ?? 'wrong';
    // polymath arm: all correct → 1.0
    expect((await post(`/api/experiment/subjects/${subjectId}/posttest/submit`, {
      condition: 'polymath',
      responses: postItems.map((i) => ({ itemId: i.itemId, submission: correctFor(i.itemId) })),
    })).status).toBe(201);
    // baseline arm: all wrong → 0.0
    expect((await post(`/api/experiment/subjects/${subjectId}/posttest/submit`, {
      condition: 'baseline',
      responses: postItems.map((i) => ({ itemId: i.itemId, submission: 'nope' })),
    })).status).toBe(201);

    // 5. Followup is now OPEN (the window opens after both post-tests). GET serves
    //    2 already-seen items in a DIFFERENT surface form.
    const followStart = await fetch(`${baseUrl}/api/experiment/followup/${followupToken}`);
    expect(followStart.status).toBe(200);
    const followItems = ((await followStart.json()) as { items: { itemId: string; targetRep: string }[] }).items;
    expect(followItems).toHaveLength(2);

    const followSubmit = await post(`/api/experiment/followup/${followupToken}`, {
      responses: followItems.map((i) => ({
        itemId: i.itemId,
        targetRepOverride: i.targetRep,
        submission: correctFor(i.itemId),
      })),
    });
    expect(followSubmit.status).toBe(201);

    // qualitative notes
    expect((await post(`/api/experiment/subjects/${subjectId}/notes`, { notes: 'reflection, with a comma' })).status).toBe(200);

    // 6. Export CSV — FROZEN 9-column shape, joined from Postgres.
    const csvRes = await fetch(`${baseUrl}/api/experiment/subjects/${subjectId}/export.csv`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get('content-type')).toContain('text/csv');
    const csv = await csvRes.text();
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    // One data row, parsed loosely (notes is quoted because of the comma).
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(subjectId);
    expect(lines[1]).toContain('polymath_first'.length ? created.conditionOrder : '');
    expect(lines[1]).toContain(polySession);
    expect(lines[1]).toContain(baseSession);
    // polymath post = 1, baseline post = 0
    expect(lines[1]).toContain(',1,'); // polymath_post_score after polymath_session_id
    expect(lines[1]).toContain('"reflection, with a comma"');
  });

  it('rejects a submission whose itemId was not served (served-set integrity)', async () => {
    const subjectId = ((await (await post('/api/experiment/subjects')).json()) as { subjectId: string }).subjectId;
    const preStart = await post(`/api/experiment/subjects/${subjectId}/pretest/start`);
    const preItems = ((await preStart.json()) as { items: { itemId: string }[] }).items;
    // A forged itemId that was never served is rejected (400), not silently scored
    // as an incorrect row that inflates the denominator of the frozen CSV.
    const forged = await post(`/api/experiment/subjects/${subjectId}/pretest/submit`, {
      responses: [
        { itemId: 'NOT-A-REAL-ITEM', submission: 'A AND B' },
        ...preItems.slice(1).map((i) => ({ itemId: i.itemId, submission: 'x' })),
      ],
    });
    expect(forged.status).toBe(400);
  });

  it('rejects a submission whose itemId count is not the phase N (no padding/short)', async () => {
    const subjectId = ((await (await post('/api/experiment/subjects')).json()) as { subjectId: string }).subjectId;
    const preStart = await post(`/api/experiment/subjects/${subjectId}/pretest/start`);
    const preItems = ((await preStart.json()) as { items: { itemId: string }[] }).items;
    // Submit only 1 of the 4 served items → 400 (a short submit would otherwise
    // let a caller score 1/1 instead of x/4 into the frozen CSV).
    const short = await post(`/api/experiment/subjects/${subjectId}/pretest/submit`, {
      responses: [{ itemId: preItems[0]!.itemId, submission: 'A AND B' }],
    });
    expect(short.status).toBe(400);
    // Submit a served item duplicated to pad the set → 400 (distinct count check).
    const padded = await post(`/api/experiment/subjects/${subjectId}/pretest/submit`, {
      responses: preItems.map((i) => ({ itemId: preItems[0]!.itemId, submission: 'A AND B' })),
    });
    expect(padded.status).toBe(400);
  });

  it('is one-shot per phase — a re-submit is rejected (409) and does not skew the score', async () => {
    const subjectId = ((await (await post('/api/experiment/subjects')).json()) as { subjectId: string }).subjectId;
    const preStart = await post(`/api/experiment/subjects/${subjectId}/pretest/start`);
    const preItems = ((await preStart.json()) as { items: { itemId: string }[] }).items;
    const body = {
      responses: preItems.map((i) => ({ itemId: i.itemId, submission: i.itemId === 'L1-01-and' ? 'A AND B' : 'wrong' })),
    };
    const first = await post(`/api/experiment/subjects/${subjectId}/pretest/submit`, body);
    expect(first.status).toBe(201);
    // A double-click / retry re-POST is rejected, not appended.
    const second = await post(`/api/experiment/subjects/${subjectId}/pretest/submit`, body);
    expect(second.status).toBe(409);
    // Exactly the first submission's rows survive (no accumulation).
    const rows = await db
      .select({ id: preTestResults.id })
      .from(preTestResults)
      .where(eq(preTestResults.subjectId, subjectId));
    expect(rows).toHaveLength(preItems.length);
  });

  it('posttest one-shot is PER condition (a 2nd polymath submit 409s; baseline still allowed)', async () => {
    const subjectId = ((await (await post('/api/experiment/subjects')).json()) as { subjectId: string }).subjectId;
    await post(`/api/experiment/subjects/${subjectId}/pretest/start`);
    const postStart = await post(`/api/experiment/subjects/${subjectId}/posttest/start`);
    const postItems = ((await postStart.json()) as { items: { itemId: string }[] }).items;
    const mk = (cond: string) => ({ condition: cond, responses: postItems.map((i) => ({ itemId: i.itemId, submission: 'wrong' })) });
    expect((await post(`/api/experiment/subjects/${subjectId}/posttest/submit`, mk('polymath'))).status).toBe(201);
    // A second polymath submit is rejected...
    expect((await post(`/api/experiment/subjects/${subjectId}/posttest/submit`, mk('polymath'))).status).toBe(409);
    // ...but the baseline arm of the SAME shared item set is still allowed.
    expect((await post(`/api/experiment/subjects/${subjectId}/posttest/submit`, mk('baseline'))).status).toBe(201);
  });

  it('followup only scores its served items, is one-shot, and resists replay inflation', async () => {
    // Drive a fresh subject to an open follow-up window.
    const created = (await (await post('/api/experiment/subjects')).json()) as { subjectId: string; followupToken: string };
    const { subjectId, followupToken } = created;
    await post(`/api/experiment/subjects/${subjectId}/pretest/start`);
    const postStart = await post(`/api/experiment/subjects/${subjectId}/posttest/start`);
    const postItems = ((await postStart.json()) as { items: { itemId: string }[] }).items;
    for (const cond of ['polymath', 'baseline']) {
      await post(`/api/experiment/subjects/${subjectId}/posttest/submit`, {
        condition: cond,
        responses: postItems.map((i) => ({ itemId: i.itemId, submission: 'wrong' })),
      });
    }
    const followStart = await fetch(`${baseUrl}/api/experiment/followup/${followupToken}`);
    const followItems = ((await followStart.json()) as { items: { itemId: string }[] }).items;
    expect(followItems).toHaveLength(2);

    // Replay-inflation attempt: pad with extra correct itemIds NOT in the served
    // followup set. Rejected (400) — a subject can't inflate followup_score.
    const inflate = await post(`/api/experiment/followup/${followupToken}`, {
      responses: [
        ...followItems.map((i) => ({ itemId: i.itemId, submission: 'wrong' })),
        { itemId: 'L1-08-or-and', submission: '(A OR B) AND C' },
      ],
    });
    expect(inflate.status).toBe(400);

    // Legitimate submit of exactly the served set → 201.
    const ok = await post(`/api/experiment/followup/${followupToken}`, {
      responses: followItems.map((i) => ({ itemId: i.itemId, submission: 'wrong' })),
    });
    expect(ok.status).toBe(201);
    // Replay the same submit → 409 (one-shot; can't accumulate rows).
    const replay = await post(`/api/experiment/followup/${followupToken}`, {
      responses: followItems.map((i) => ({ itemId: i.itemId, submission: 'wrong' })),
    });
    expect(replay.status).toBe(409);
  });

  it('the DB composite-PK backstops AC#6 — usage rows are unique per (subject,item)', async () => {
    const subjectId = ((await (await post('/api/experiment/subjects')).json()) as { subjectId: string }).subjectId;
    // Two pretest "start" calls would try to record the same items twice; the
    // onConflictDoNothing + composite PK means no duplicate usage rows.
    await post(`/api/experiment/subjects/${subjectId}/pretest/start`);
    await post(`/api/experiment/subjects/${subjectId}/pretest/start`);
    const rows = await db.execute<{ n: string }>(
      sql`SELECT item_id, COUNT(*) AS n FROM subject_item_usage WHERE subject_id = ${subjectId} GROUP BY item_id HAVING COUNT(*) > 1`,
    );
    expect(rows.rows.length).toBe(0);
  });

  it('follow-up fails CLOSED before post-tests (410) and after expiry (410)', async () => {
    const created = (await (await post('/api/experiment/subjects')).json()) as {
      subjectId: string;
      followupToken: string;
    };
    // Before any post-test: window not opened → 410.
    const early = await fetch(`${baseUrl}/api/experiment/followup/${created.followupToken}`);
    expect(early.status).toBe(410);

    // Backdate an opened-but-expired window → 410.
    await db
      .update(experimentSubjects)
      .set({ followupExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(experimentSubjects.id, created.subjectId));
    const expired = await fetch(`${baseUrl}/api/experiment/followup/${created.followupToken}`);
    expect(expired.status).toBe(410);
  });

  it('an unknown follow-up token is a 404 (not a 410)', async () => {
    const res = await fetch(`${baseUrl}/api/experiment/followup/deadbeefdeadbeefdeadbeefdeadbeef`);
    expect(res.status).toBe(404);
  });

  it('counterbalancing alternates by creation ordinal', async () => {
    // Fresh table region: read the two most-recent orders by created_at and assert
    // they alternate (the ordinal parity rule). Use a clean comparison of two new ones.
    const a = (await (await post('/api/experiment/subjects')).json()) as { conditionOrder: string };
    const b = (await (await post('/api/experiment/subjects')).json()) as { conditionOrder: string };
    expect(a.conditionOrder).not.toBe(b.conditionOrder);
  });

  it('export.csv 404s for an unknown subject', async () => {
    const res = await fetch(`${baseUrl}/api/experiment/subjects/11111111-1111-1111-1111-111111111111/export.csv`);
    expect(res.status).toBe(404);
  });
});
