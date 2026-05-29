import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { HandoffArtifactSchema } from '@polymath/contract';
import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { canRunPg, ensureTestPg } from '../db/testPg.js';
import { StubAgentClient } from '../agent/stubClient.js';
import { createServer, type PolymathServer } from '../server.js';
import { learnerState, sessions } from '../db/schema.js';

/**
 * The tutor-handoff route, end-to-end against a real Postgres + the real HTTP
 * server. Offline (no key — the questions node's deterministic templates run). Seeds
 * `learner_state` directly (a stand-in for a real WS lesson leg) and drives the route.
 */

let db: Db;
let pool: { end: () => Promise<void> };
let server: PolymathServer;
let baseUrl: string;

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

/** Create a Polymath session and seed per-KC learner state. Optionally tag the
 *  session's app arm (to prove baseline scoping). */
async function seedSession(
  kcs: { kc: string; bkt: number | null }[],
  app?: 'baseline',
): Promise<string> {
  const rows = await db
    .insert(sessions)
    .values(app ? { app } : {})
    .returning({ id: sessions.id });
  const id = rows[0]!.id;
  for (const { kc, bkt } of kcs) {
    await db.insert(learnerState).values({
      sessionId: id,
      kc,
      bktProbability: bkt,
      masteryState: 'practicing',
    });
  }
  return id;
}

describe.skipIf(!canRunPg)('handoff route', () => {
  beforeAll(async () => {
    const url = await ensureTestPg();
    await runMigrations(url);
    ({ db, pool } = createDb(url));
    server = createServer({ db, agent: new StubAgentClient() });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  }, 60000);

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  it('bare path returns a contract-valid artifact + a share URL (AC#2/#3)', async () => {
    const id = await seedSession([
      { kc: 'AND', bkt: 0.99 },
      { kc: 'OR', bkt: 0.2 },
      { kc: 'NOT', bkt: null },
    ]);
    const res = await get(`/api/session/${id}/handoff`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifact: unknown; shareUrl: string };
    expect(HandoffArtifactSchema.safeParse(body.artifact).success).toBe(true);
    const art = HandoffArtifactSchema.parse(body.artifact);
    expect(art.masteredKcs).toEqual(['AND']);
    expect(art.stuckKcs.sort()).toEqual(['NOT', 'OR']);
    expect(art.tutorQuestions.length).toBeGreaterThanOrEqual(3);
    expect(art.warmIntro.toLowerCase()).toContain('taken you as far');
    expect(body.shareUrl).toMatch(new RegExp(`^/handoff/${id}/[0-9a-f]+$`));
  });

  it('mints the share token once and is stable across calls (lazy mint)', async () => {
    const id = await seedSession([{ kc: 'AND', bkt: 0.99 }, { kc: 'OR', bkt: 0.2 }]);
    const a = (await (await get(`/api/session/${id}/handoff`)).json()) as { shareUrl: string };
    const b = (await (await get(`/api/session/${id}/handoff`)).json()) as { shareUrl: string };
    expect(a.shareUrl).toBe(b.shareUrl);
    const persisted = await db
      .select({ shareToken: sessions.shareToken })
      .from(sessions)
      .where(eq(sessions.id, id));
    expect(persisted[0]!.shareToken).not.toBeNull();
  });

  it('tokened path with the right token returns 200 (AC#4)', async () => {
    const id = await seedSession([{ kc: 'AND', bkt: 0.99 }, { kc: 'OR', bkt: 0.2 }]);
    const { shareUrl } = (await (await get(`/api/session/${id}/handoff`)).json()) as {
      shareUrl: string;
    };
    // shareUrl is `/handoff/:id/:token` (the web route); the API path is
    // `/api/session/:id/handoff/:token`.
    const token = shareUrl.split('/').pop()!;
    const apiRes = await get(`/api/session/${id}/handoff/${token}`);
    expect(apiRes.status).toBe(200);
    const body = (await apiRes.json()) as { artifact: unknown };
    expect(HandoffArtifactSchema.safeParse(body.artifact).success).toBe(true);
  });

  it('tokened path with the wrong token returns 403 (AC#4 security)', async () => {
    const id = await seedSession([{ kc: 'AND', bkt: 0.99 }, { kc: 'OR', bkt: 0.2 }]);
    await get(`/api/session/${id}/handoff`); // mint
    const res = await get(`/api/session/${id}/handoff/deadbeefdeadbeef`);
    expect(res.status).toBe(403);
  });

  it('tokened path on a never-shared session returns 403 (fail closed)', async () => {
    const id = await seedSession([{ kc: 'AND', bkt: 0.99 }, { kc: 'OR', bkt: 0.2 }]);
    // No bare call → no token minted. Any token presented must fail closed.
    const res = await get(`/api/session/${id}/handoff/cafecafecafecafe`);
    expect(res.status).toBe(403);
  });

  it('unknown session returns 404', async () => {
    const res = await get('/api/session/00000000-0000-0000-0000-000000000000/handoff');
    expect(res.status).toBe(404);
  });

  it('non-UUID session id returns 400', async () => {
    const res = await get('/api/session/not-a-uuid/handoff');
    expect(res.status).toBe(400);
  });

  it("a baseline-arm session is scoped out (app='baseline' -> 404)", async () => {
    const id = await seedSession([{ kc: 'AND', bkt: 0.99 }, { kc: 'OR', bkt: 0.2 }], 'baseline');
    const res = await get(`/api/session/${id}/handoff`);
    expect(res.status).toBe(404);
  });

  it('a session with no learner state returns 404 (empty session)', async () => {
    const rows = await db.insert(sessions).values({}).returning({ id: sessions.id });
    const res = await get(`/api/session/${rows[0]!.id}/handoff`);
    expect(res.status).toBe(404);
  });
});
