import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { canRunPg, ensureTestPg } from '../db/testPg.js';
import { seedTransferBank } from '../db/seed.js';
import { StubAgentClient } from '../agent/stubClient.js';
import { createServer, type PolymathServer } from '../server.js';

/**
 * MR !7 review fixes — operator-auth gate, idempotent test-start, atomic one-shot
 * submit, and the /api/session subjectId existence check. Each runs against a real
 * Postgres + the real HTTP server. OFFLINE (no OPENAI_API_KEY / no LLM).
 */

const SECRET = 'test-operator-secret-123';

let db: Db;
let pool: { end: () => Promise<void> };
let server: PolymathServer;
let baseUrl: string;

function url(p: string): string {
  return `${baseUrl}${p}`;
}

describe.skipIf(!canRunPg)('MR !7 review fixes', () => {
  beforeAll(async () => {
    const u = await ensureTestPg();
    await runMigrations(u);
    ({ db, pool } = createDb(u));
    // A configured operator secret exercises the auth gate's enforce path (the
    // lifecycle suite covers the dev/open path with no secret).
    server = createServer({ db, agent: new StubAgentClient(), operatorSecret: SECRET });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    baseUrl = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
  }, 60000);

  beforeEach(async () => {
    await seedTransferBank(db);
  });

  afterAll(async () => {
    await server.close();
    await pool.end().catch(() => {});
  });

  const auth = { authorization: `Bearer ${SECRET}` };

  describe('operator-auth gate', () => {
    it('rejects an operator route with no credential (401)', async () => {
      const res = await fetch(url('/api/experiment/subjects'), { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('rejects a wrong credential (401)', async () => {
      const res = await fetch(url('/api/experiment/subjects'), {
        method: 'POST',
        headers: { authorization: 'Bearer wrong' },
      });
      expect(res.status).toBe(401);
    });

    it('allows a correct Bearer credential (201)', async () => {
      const res = await fetch(url('/api/experiment/subjects'), { method: 'POST', headers: auth });
      expect(res.status).toBe(201);
    });

    it('accepts the X-Operator-Secret header too', async () => {
      const res = await fetch(url('/api/experiment/subjects'), {
        method: 'POST',
        headers: { 'x-operator-secret': SECRET },
      });
      expect(res.status).toBe(201);
    });

    it('gates the session replay route (401 without the secret)', async () => {
      // Make a real session first (the create route is public).
      const s = await (await fetch(url('/api/session'), { method: 'POST' })).json();
      const sessionId = (s as { sessionId: string }).sessionId;
      const denied = await fetch(url(`/api/session/${sessionId}/replay`));
      expect(denied.status).toBe(401);
      const ok = await fetch(url(`/api/session/${sessionId}/replay`), { headers: auth });
      expect(ok.status).toBe(200);
    });

    it('does NOT gate the learner-facing followup route (its own token authenticates)', async () => {
      // An unknown token is a 404/410 from the route itself — NOT a 401 from the gate.
      const res = await fetch(url('/api/experiment/followup/not-a-real-token'));
      expect(res.status).not.toBe(401);
    });
  });

  describe('idempotent pretest/start', () => {
    it('a second start returns the SAME served items without growing the served set', async () => {
      const subjectId = ((await (await fetch(url('/api/experiment/subjects'), { method: 'POST', headers: auth })).json()) as { subjectId: string }).subjectId;
      const first = (await (await fetch(url(`/api/experiment/subjects/${subjectId}/pretest/start`), { method: 'POST', headers: auth })).json()) as { items: { itemId: string }[] };
      const second = (await (await fetch(url(`/api/experiment/subjects/${subjectId}/pretest/start`), { method: 'POST', headers: auth })).json()) as { items: { itemId: string }[] };
      const firstIds = new Set(first.items.map((i) => i.itemId));
      const secondIds = new Set(second.items.map((i) => i.itemId));
      expect(secondIds).toEqual(firstIds);
      expect(second.items).toHaveLength(first.items.length);
      // The submit (covering exactly the served set once each) still succeeds after a
      // double start — i.e. the subject is NOT soft-locked.
      const submit = await fetch(url(`/api/experiment/subjects/${subjectId}/pretest/submit`), {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ responses: first.items.map((i) => ({ itemId: i.itemId, submission: 'x' })) }),
      });
      expect(submit.status).toBe(201);
    });
  });

  describe('/api/session subjectId existence check', () => {
    it('404s when an explicit subjectId does not resolve', async () => {
      const res = await fetch(url('/api/session'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId: '11111111-1111-4111-8111-111111111111' }),
      });
      expect(res.status).toBe(404);
    });

    it('still creates an unadorned session (no subjectId) — robustness preserved', async () => {
      const res = await fetch(url('/api/session'), { method: 'POST' });
      expect(res.status).toBe(201);
    });
  });
});
