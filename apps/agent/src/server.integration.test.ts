import { execFileSync, spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Action } from '@polymath/contract';
import { createDb, type Db } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { events, sessions } from './db/schema.js';
import { StubAgentClient } from './agent/stubClient.js';
import { createServer, type PolymathServer } from './server.js';
import { eq } from 'drizzle-orm';

/**
 * End-to-end integration test (F-01 testing requirements + acceptance criteria
 * 3,4,5). Boots a throwaway Postgres in Docker, runs migrations, starts the real
 * HTTP+WS server with the stub agent, then:
 *   - POST /api/session writes a `sessions` row (criterion 4)
 *   - a WS `submit` round-trips a valid `no_action` Action (criterion 3, 5)
 *   - an `events` row is written (criterion 3)
 *   - GET /api/health returns {status:"ok"} (criterion 2)
 *
 * Skips cleanly if Docker is unavailable so the rest of the suite still runs.
 */

function dockerAvailable(): boolean {
  const r = spawnSync('docker', ['info'], { stdio: 'ignore' });
  return r.status === 0;
}

// Prefer an externally-provided Postgres (CI provides a sibling container via
// TEST_POSTGRES_URL). Otherwise spin up a throwaway Docker container locally.
// The suite is skipped entirely if neither is available (no Docker, no URL).
const EXTERNAL_PG_URL = process.env.TEST_POSTGRES_URL;
const HAVE_DOCKER = dockerAvailable();
const CAN_RUN = Boolean(EXTERNAL_PG_URL) || HAVE_DOCKER;
const MANAGE_OWN_PG = !EXTERNAL_PG_URL && HAVE_DOCKER;

const CONTAINER = 'polymath-test-pg';
const PG_PORT = 55432;
const POSTGRES_URL =
  EXTERNAL_PG_URL ?? `postgres://polymath:polymath@localhost:${PG_PORT}/polymath`;

let db: Db;
let pool: { end: () => Promise<void> };
let server: PolymathServer;
let baseUrl: string;
let wsUrl: string;

async function waitForPg(url: string, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const { db: probeDb, pool: probePool } = createDb(url);
    try {
      await probeDb.execute('select 1');
      await probePool.end();
      return;
    } catch {
      await probePool.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('Postgres did not become ready');
}

describe.skipIf(!CAN_RUN)('agent server end-to-end', () => {
  beforeAll(async () => {
    if (MANAGE_OWN_PG) {
      spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
      execFileSync('docker', [
        'run', '-d', '--name', CONTAINER,
        '-e', 'POSTGRES_USER=polymath',
        '-e', 'POSTGRES_PASSWORD=polymath',
        '-e', 'POSTGRES_DB=polymath',
        '-p', `${PG_PORT}:5432`,
        'postgres:16-alpine',
      ]);
    }
    await waitForPg(POSTGRES_URL);
    await runMigrations(POSTGRES_URL);

    ({ db, pool } = createDb(POSTGRES_URL));
    server = createServer({ db, agent: new StubAgentClient() });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
    wsUrl = `ws://localhost:${port}/agent`;
  }, 60000);

  afterAll(async () => {
    await server.close();
    await pool.end().catch(() => {});
    if (MANAGE_OWN_PG) {
      spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
    }
  });

  it('GET /api/health returns {status:"ok"}', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('POST /api/session creates a sessions row', async () => {
    const res = await fetch(`${baseUrl}/api/session`, { method: 'POST' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { sessionId: string; startedAt: string };
    expect(body.sessionId).toMatch(/[0-9a-f-]{36}/);

    const rows = await db.select().from(sessions).where(eq(sessions.id, body.sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startedAt).toBeTruthy();
  });

  it('round-trips a submit to a valid mount Action (the inner loop) and writes an events row', async () => {
    // First create a session so the events FK is satisfiable.
    const res = await fetch(`${baseUrl}/api/session`, { method: 'POST' });
    const { sessionId } = (await res.json()) as { sessionId: string };

    const ws = new WebSocket(wsUrl);
    const action: Action = await new Promise((resolve, reject) => {
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            kind: 'submit',
            sessionId,
            itemId: 'l1-and',
            submission: 'A AND B',
          }),
        );
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.kind === 'action') {
          resolve(Action.parse(msg.action));
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timed out waiting for action')), 5000);
    });
    ws.close();

    // F-05: a correct submit now drives the inner loop to mount the next item
    // (the key-free heuristic provider), not the F-01 `no_action` stub.
    expect(action.type).toBe('mount');
    if (action.type === 'mount') {
      expect(['TruthTablePractice', 'CircuitBuilder', 'PseudocodeChallenge', 'WorkedExample']).toContain(
        action.component.kind,
      );
    }

    // Give the async insert a beat to land, then assert the events row exists.
    await new Promise((r) => setTimeout(r, 300));
    const rows = await db.select().from(events).where(eq(events.sessionId, sessionId));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.kind === 'submit')).toBe(true);
  });

  it('replies with a clean error for an unknown session and keeps serving', async () => {
    // A valid-but-unknown UUID must NOT crash the server (regression guard for
    // the unhandled-rejection-on-FK-violation DoS). The server should send an
    // "unknown session" error and remain healthy for the next request.
    const ws = new WebSocket(wsUrl);
    const msg: { kind: string; message: string } = await new Promise((resolve, reject) => {
      ws.on('open', () =>
        ws.send(
          JSON.stringify({
            kind: 'submit',
            sessionId: '11111111-1111-4111-8111-111111111111',
            itemId: 'l1-and',
            submission: 'A AND B',
          }),
        ),
      );
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timed out')), 5000);
    });
    ws.close();
    expect(msg.kind).toBe('error');
    expect(msg.message).toBe('unknown session');

    // Server still serving:
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
  });

  /** Drive a sequence of events through one socket, collecting each Action. */
  async function driveSequence(
    sessionId: string,
    frames: Record<string, unknown>[],
  ): Promise<Action[]> {
    const ws = new WebSocket(wsUrl);
    const actions: Action[] = [];
    await new Promise<void>((resolve, reject) => {
      let sent = 0;
      ws.on('open', () => ws.send(JSON.stringify(frames[sent++])));
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.kind === 'action') {
          actions.push(Action.parse(msg.action));
          if (sent < frames.length) ws.send(JSON.stringify(frames[sent++]));
          else resolve();
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('sequence timed out')), 8000);
    });
    ws.close();
    return actions;
  }

  it('drives a submit sequence through the inner loop and advances items (criteria 1,3)', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    const actions = await driveSequence(sessionId, [
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B' },
      { kind: 'submit', sessionId, itemId: 'l1-or', submission: 'A OR B' },
      { kind: 'submit', sessionId, itemId: 'l1-not', submission: 'NOT A' },
    ]);
    // Every turn mounts a valid next item (pattern, not exact strings).
    expect(actions).toHaveLength(3);
    for (const a of actions) {
      expect(a.type).toBe('mount');
      if (a.type === 'mount') {
        expect(['TruthTablePractice', 'CircuitBuilder', 'PseudocodeChallenge', 'WorkedExample']).toContain(
          a.component.kind,
        );
      }
    }

    // Replay endpoint returns the per-Action log including rationale (criterion 10).
    await new Promise((r) => setTimeout(r, 300));
    const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
      events: { payload: { action?: { rationale?: string }; validation?: { status?: string } } }[];
    };
    const submitTurns = replay.events.filter((e) => e.payload.action);
    expect(submitTurns.length).toBeGreaterThanOrEqual(3);
    expect(submitTurns.every((e) => typeof e.payload.action!.rationale === 'string')).toBe(true);
    expect(submitTurns.every((e) => e.payload.validation?.status === 'pass')).toBe(true);
  });

  it('answers an on-topic question and deflects an off-topic one (criteria 4,5)', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    const [onTopic] = await driveSequence(sessionId, [
      { kind: 'learner_question', sessionId, question: 'what does an AND gate output?' },
    ]);
    expect(onTopic!.type).toBe('answer_question');
    expect(onTopic!.type === 'answer_question' && onTopic!.topicClassification).toBe('on_topic');

    const [offTopic] = await driveSequence(sessionId, [
      { kind: 'learner_question', sessionId, question: 'can you book me a flight to Paris?' },
    ]);
    expect(offTopic!.type === 'answer_question' && offTopic!.topicClassification).toBe('off_topic');
  });
});
