import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createDb, type Db } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { events, learnerState, sessions } from './db/schema.js';
import { canRunPg, ensureTestPg } from './db/testPg.js';
import { StubAgentClient } from './agent/stubClient.js';
import { createServer, type PolymathServer } from './server.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { UiChurnResponse } from './metrics/uiChurn.js';

/**
 * F-20 observability: the `ui_mount` beacon persistence + the
 * `GET /api/session/:id/observability/ui-churn` endpoint.
 *
 * Acceptance:
 *  - a `ui_mount` WS frame writes a NON-integrity `events` row (`app:null`,
 *    `payload:{componentKind,phase}`) and is ACKed — but NEVER alters `learner_state`
 *    (it must not route through the mastery/eventConsumer fold).
 *  - the churn endpoint is operator-gated EXACTLY like `/replay`: open in dev/CI when
 *    the secret is unset, 401 on a bad secret when one IS set.
 *  - it returns the locked `UiChurnResponse` shape (or `insufficient_data`), and 400
 *    on a malformed sessionId.
 */

let db: Db;
let pool: { end: () => Promise<void> };
let baseUrl: string;
let wsUrl: string;

/** Default server: no operator secret (dev/CI → routes open, like /replay). */
let server: PolymathServer;
/** A second server with a secret set, to prove the 401 path. */
let secretServer: PolymathServer;
let secretBaseUrl: string;
const OP_SECRET = 'test-operator-secret-xyz';

/** Open a socket, send one frame, resolve on the first message, then close. */
async function sendFrame(frame: Record<string, unknown>): Promise<{ kind: string }> {
  const ws = new WebSocket(wsUrl);
  const msg = await new Promise<{ kind: string }>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify(frame)));
    ws.on('message', (data) => resolve(JSON.parse(data.toString())));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('timed out')), 5000);
  });
  ws.close();
  return msg;
}

async function newSession(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/session`, { method: 'POST' });
  const body = (await res.json()) as { sessionId: string };
  return body.sessionId;
}

describe.skipIf(!canRunPg)('F-20 ui_mount beacon + ui-churn endpoint', () => {
  beforeAll(async () => {
    const POSTGRES_URL = await ensureTestPg();
    await runMigrations(POSTGRES_URL);
    ({ db, pool } = createDb(POSTGRES_URL));

    server = createServer({ db, agent: new StubAgentClient() });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
    wsUrl = `ws://localhost:${port}/agent`;

    secretServer = createServer({ db, agent: new StubAgentClient(), operatorSecret: OP_SECRET });
    await new Promise<void>((resolve) => secretServer.httpServer.listen(0, resolve));
    const sp = secretServer.httpServer.address() as AddressInfo;
    secretBaseUrl = `http://localhost:${sp.port}`;
  }, 60000);

  afterAll(async () => {
    await server.close();
    await secretServer.close();
    await pool.end().catch(() => {});
  });

  it('persists a ui_mount beacon as a NON-integrity events row and ACKs it', async () => {
    const sessionId = await newSession();
    const ack = await sendFrame({
      kind: 'ui_mount',
      sessionId,
      componentKind: 'TruthTablePractice',
      phase: 'practicing',
    });
    expect(ack.kind).toBe('ack');

    await new Promise((r) => setTimeout(r, 300));
    const rows = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, sessionId), isNull(events.app)));
    const beacon = rows.find((r) => r.kind === 'ui_mount');
    expect(beacon).toBeTruthy();
    expect(beacon!.app).toBeNull();
    expect(beacon!.payload).toMatchObject({ componentKind: 'TruthTablePractice', phase: 'practicing' });

    // CRITICAL: the beacon must NOT touch the mastery fold — no learner_state row from it.
    const ls = await db.select().from(learnerState).where(eq(learnerState.sessionId, sessionId));
    expect(ls).toHaveLength(0);
  });

  it('GET ui-churn returns insufficient_data for a sparse session (never NaN)', async () => {
    const sessionId = await newSession();
    await sendFrame({ kind: 'ui_mount', sessionId, componentKind: 'TruthTablePractice', phase: 'practicing' });
    await new Promise((r) => setTimeout(r, 200));

    const res = await fetch(`${baseUrl}/api/session/${sessionId}/observability/ui-churn`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as UiChurnResponse;
    expect(body.sessionId).toBe(sessionId);
    expect(body.status).toBe('insufficient_data');
    expect(body.mountsPerMinute).toBeNull();
    expect(body.rawCounts.mountsTotal).toBe(1);
  });

  it('GET ui-churn computes a rate from several mounts over an engaged window', async () => {
    const sessionId = await newSession();
    // Insert beacons directly with controlled timestamps so the window is deterministic.
    const t0 = Date.now() - 4 * 60_000; // 4 minutes ago
    for (let i = 0; i < 5; i++) {
      await db.insert(events).values({
        sessionId,
        kind: 'ui_mount',
        ts: new Date(t0 + i * 60_000),
        payload: { componentKind: 'TruthTablePractice', phase: 'practicing' },
        app: null,
      });
    }
    const res = await fetch(`${baseUrl}/api/session/${sessionId}/observability/ui-churn`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as UiChurnResponse;
    expect(body.status).toBe('ok');
    // 5 mounts over 4 engaged minutes = 1.25/min.
    expect(body.mountsPerMinute).toBeCloseTo(1.25, 2);
    expect(body.byPhase['practicing']!.mounts).toBe(5);
  });

  it('returns 400 for a malformed sessionId', async () => {
    const res = await fetch(`${baseUrl}/api/session/not-a-uuid/observability/ui-churn`);
    expect(res.status).toBe(400);
  });

  it('is operator-gated: 401 with no/incorrect secret when one IS configured', async () => {
    const sessionId = await newSession();
    const noAuth = await fetch(`${secretBaseUrl}/api/session/${sessionId}/observability/ui-churn`);
    expect(noAuth.status).toBe(401);

    const badAuth = await fetch(`${secretBaseUrl}/api/session/${sessionId}/observability/ui-churn`, {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    expect(badAuth.status).toBe(401);

    const goodAuth = await fetch(`${secretBaseUrl}/api/session/${sessionId}/observability/ui-churn`, {
      headers: { Authorization: `Bearer ${OP_SECRET}` },
    });
    expect(goodAuth.status).toBe(200);
  });
});
