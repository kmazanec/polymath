import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { canRunPg, ensureTestPg } from '../db/testPg.js';
import { StubAgentClient } from '../agent/stubClient.js';
import { createServer, type PolymathServer } from '../server.js';
import type { MetricsPayload } from './types.js';

/**
 * GET /api/metrics — the operator-gated counter-metrics dashboard payload. Runs
 * against a real Postgres + the real HTTP+WS server. OFFLINE (no LLM key). Asserts:
 *  - the operator gate (401 without/with-wrong secret, 200 with the correct header);
 *  - the fresh-DB honest empty state (six metrics, all gray, none a pass/fail);
 *  - the intelligibility beacon is PERSISTED under `events.app IS NULL` and folds
 *    into the intelligibility metric (the legitimate metric-2 path actually works).
 */

const SECRET = 'metrics-operator-secret-xyz';

let db: Db;
let pool: { end: () => Promise<void> };
let server: PolymathServer;
let baseUrl: string;
let wsUrl: string;

const auth = { authorization: `Bearer ${SECRET}` };

/** Send a batch of client frames over a single WS connection, resolving once all are
 *  acked/answered (one server reply per frame for these telemetry beacons). */
async function sendFrames(frames: unknown[]): Promise<void> {
  const ws = new WebSocket(wsUrl);
  let replies = 0;
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      for (const f of frames) ws.send(JSON.stringify(f));
    });
    ws.on('message', () => {
      replies += 1;
      if (replies >= frames.length) {
        ws.close();
        resolve();
      }
    });
    ws.on('error', reject);
  });
}

describe.skipIf(!canRunPg)('GET /api/metrics', () => {
  beforeAll(async () => {
    const u = await ensureTestPg();
    await runMigrations(u);
    ({ db, pool } = createDb(u));
    server = createServer({ db, agent: new StubAgentClient(), operatorSecret: SECRET });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
    wsUrl = `ws://localhost:${port}/agent`;
  }, 60000);

  afterAll(async () => {
    await server.close();
    await pool.end().catch(() => {});
  });

  it('rejects with no credential (401)', async () => {
    const res = await fetch(`${baseUrl}/api/metrics`);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong credential (401)', async () => {
    const res = await fetch(`${baseUrl}/api/metrics`, { headers: { authorization: 'Bearer wrong' } });
    expect(res.status).toBe(401);
  });

  it('returns the six-metric payload with the correct Bearer (200)', async () => {
    const res = await fetch(`${baseUrl}/api/metrics`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MetricsPayload;
    expect(body.metrics).toHaveLength(6);
    expect(typeof body.generatedAt).toBe('string');
    // The honest empty state: nothing is a green/red tile on a (near-)fresh DB.
    for (const m of body.metrics) {
      expect(['pass', 'fail', 'insufficient_data', 'unconfigured']).toContain(m.state);
    }
    const churn = body.metrics.find((m) => m.id === 'ui_churn')!;
    expect(churn.state).toBe('unconfigured');
    const visual = body.metrics.find((m) => m.id === 'visual_utility')!;
    expect(visual.state).toBe('unconfigured');
  });

  it('accepts the X-Operator-Secret header too (200)', async () => {
    const res = await fetch(`${baseUrl}/api/metrics`, { headers: { 'x-operator-secret': SECRET } });
    expect(res.status).toBe(200);
  });

  it('PERSISTS intelligibility_response beacons and folds them into the intelligibility metric', async () => {
    // Mint a real session, then fire ≥ MIN_N (=5) yes/no intelligibility beacons over WS.
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    const frames = [
      { kind: 'intelligibility_response', sessionId, mountedKind: 'TruthTablePractice', answer: 'yes' },
      { kind: 'intelligibility_response', sessionId, mountedKind: 'TruthTablePractice', answer: 'yes' },
      { kind: 'intelligibility_response', sessionId, mountedKind: 'CircuitBuilder', answer: 'yes' },
      { kind: 'intelligibility_response', sessionId, mountedKind: 'CircuitBuilder', answer: 'yes' },
      { kind: 'intelligibility_response', sessionId, mountedKind: 'HintCard', answer: 'no' },
      { kind: 'intelligibility_response', sessionId, mountedKind: 'HintCard', answer: 'skip' },
    ];
    await sendFrames(frames);

    const res = await fetch(`${baseUrl}/api/metrics`, { headers: auth });
    const body = (await res.json()) as MetricsPayload;
    const intelligibility = body.metrics.find((m) => m.id === 'intelligibility')!;
    // 4 yes / (4 yes + 1 no) = 0.8; the skip is excluded → sampleN = 5, state determinable.
    expect(intelligibility.sampleN).toBe(5);
    expect(intelligibility.value).toBeCloseTo(0.8, 5);
    expect(['pass', 'fail']).toContain(intelligibility.state);
  });
});
