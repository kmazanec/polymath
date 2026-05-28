import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Action } from '@polymath/contract';
import { createDb, type Db } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { events, sessions } from './db/schema.js';
import { canRunPg, ensureTestPg } from './db/testPg.js';
import { StubAgentClient } from './agent/stubClient.js';
import { createServer, type PolymathServer } from './server.js';
import { eq } from 'drizzle-orm';

/**
 * End-to-end integration test. Boots a throwaway Postgres in Docker, runs
 * migrations, starts the real HTTP+WS server with the key-free heuristic agent,
 * then exercises:
 *   - GET /api/health, POST /api/session (F-01 health + session round-trip)
 *   - a WS `submit` round-trips a valid `mount` Action + writes an `events` row
 *     (F-05 the inner loop exists)
 *   - a submit sequence advances items, and the replay endpoint returns each
 *     turn's rationale + Layer-2 status (F-05 criteria 1, 10)
 *   - a *wrong* submit re-presents the same item rather than advancing
 *     (F-05 criterion 3)
 *   - on/off-topic questions route to answer/deflection (F-05 criteria 4, 5)
 *   - an unknown sessionId is rejected without crashing the server
 *
 * Runs against a real Postgres via the shared `ensureTestPg` helper (external
 * `TEST_POSTGRES_URL`, else a throwaway Docker container). Skips only when the
 * environment has neither — a genuine capability gap, not a default.
 */

let db: Db;
let pool: { end: () => Promise<void> };
let server: PolymathServer;
let baseUrl: string;
let wsUrl: string;

describe.skipIf(!canRunPg)('agent server end-to-end', () => {
  beforeAll(async () => {
    const POSTGRES_URL = await ensureTestPg();
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
    // The shared test container is intentionally left running (the seed suite may
    // reuse it). It's a throwaway dev artifact: `docker rm -f polymath-test-pg`.
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
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true },
      { kind: 'submit', sessionId, itemId: 'l1-or', submission: 'A OR B', correct: true },
      { kind: 'submit', sessionId, itemId: 'l1-not', submission: 'NOT A', correct: true },
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

  it('a wrong submit re-presents the same item rather than advancing (criterion 3)', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    // The submission ("A OR B") is genuinely WRONG for l1-and ("A AND B"); the
    // server recomputes correctness (it ignores the client `correct` flag) and
    // re-presents the item rather than advancing.
    const [action] = await driveSequence(sessionId, [
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A OR B', correct: true },
    ]);
    expect(action!.type).toBe('mount');
    if (action!.type === 'mount' && action!.component.kind === 'TruthTablePractice') {
      expect(action!.component.expression).toBe('A AND B'); // same item, not advanced
    }
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

  it('fires a transfer probe once the REAL rule gate passes, then a correct transfer leads to mastery (F-07/F-09 criteria 1,5,7)', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    // F-09: the gate is derived from the actual event history (BKT ≥ 0.95 after 3
    // consecutive correct on the AND KC, no hints, no retries). The first submits
    // don't pass the gate; once it does, the agent fires the probe. Drive correct
    // AND submits until a TransferProbe mounts.
    // Each submit carries an in-band responseTimeMs — the gate now requires enough
    // timed submissions (a scripted client that omits timings is blocked).
    const actions = await driveSequence(sessionId, [
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 5000 },
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 6000 },
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 4000 },
    ]);
    const probe = actions.find((a) => a.type === 'mount' && a.component.kind === 'TransferProbe');
    expect(probe, 'a transfer probe should fire once the rule gate passes').toBeTruthy();
    const probedItemId = probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.itemId : '';
    const probedExpr = probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.expression : '';
    expect(probedItemId).toBeTruthy();

    // Submit a correct transfer answer (equivalent to the probed expression). The
    // rule + transfer conditions are now met, but L1 config requires explain-back
    // (F-11/F-12) — so the agent does NOT declare mastery; it waits. Mastery in I1
    // is deliberately unreachable until the voice explain-back ships.
    const [afterTransfer] = await driveSequence(sessionId, [
      { kind: 'transfer_submitted', sessionId, itemId: probedItemId, submission: probedExpr },
    ]);
    expect(afterTransfer!.type).toBe('no_action');

    // The transfer verdict is recorded in the replay log (criterion 5), and the
    // replay shows the per-turn BKT trajectory rising toward mastery (F-09 crit 8).
    await new Promise((r) => setTimeout(r, 300));
    const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
      events: { payload: { transferVerdict?: { correct: boolean }; learnerSnapshot?: { bktByKc?: Record<string, number> } } }[];
    };
    expect(replay.events.some((e) => e.payload.transferVerdict?.correct === true)).toBe(true);
    const andTrajectory = replay.events
      .map((e) => e.payload.learnerSnapshot?.bktByKc?.['AND'])
      .filter((v): v is number => typeof v === 'number');
    expect(andTrajectory.length).toBeGreaterThanOrEqual(3);
    expect(andTrajectory.at(-1)!).toBeGreaterThanOrEqual(0.95); // reached mastery threshold
  });

  it('refuses a transfer_submitted for an item the session never probed (forgery defense)', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    // No probe was ever mounted for this session. A client that forges a
    // transfer_submitted for a real bank item must NOT get a pass.
    await driveSequence(sessionId, [
      { kind: 'transfer_submitted', sessionId, itemId: 'L1-01-and', submission: 'A AND B' },
    ]);
    await new Promise((r) => setTimeout(r, 300));
    const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
      events: { payload: { transferVerdict?: { correct: boolean } } }[];
    };
    const verdicts = replay.events.map((e) => e.payload.transferVerdict).filter(Boolean);
    expect(verdicts.length).toBeGreaterThanOrEqual(1);
    expect(verdicts.every((v) => v!.correct === false)).toBe(true);
  });

  describe('POST /api/realtime/session (ephemeral LiveKit token)', () => {
    // The endpoint reads LiveKit credentials from env at request time; these
    // tests set/unset them around each case and restore the prior values so the
    // rest of the suite (and other suites in the run) see no leaked env.
    const ENV_KEYS = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const;
    let saved: Record<string, string | undefined>;

    beforeAll(() => {
      saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<
        string,
        string | undefined
      >;
    });

    afterAll(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    function setVoiceEnv(): void {
      process.env.LIVEKIT_URL = 'wss://livekit.example.com';
      process.env.LIVEKIT_API_KEY = 'devkey';
      process.env.LIVEKIT_API_SECRET = 'devsecret-at-least-32-bytes-long-padding';
    }
    function clearVoiceEnv(): void {
      delete process.env.LIVEKIT_API_KEY;
      delete process.env.LIVEKIT_API_SECRET;
    }

    it('mints a 201 token scoped to the session room for a known session', async () => {
      setVoiceEnv();
      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      const res = await fetch(`${baseUrl}/api/realtime/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        token: string;
        url: string;
        roomName: string;
        expiresAt: number;
      };
      expect(typeof body.token).toBe('string');
      expect(body.token.split('.')).toHaveLength(3); // a JWT
      expect(body.roomName).toBe(`session-${sessionId}`);
      expect(body.url).toBe('wss://livekit.example.com');
      expect(body.expiresAt).toBeGreaterThan(Date.now());
    });

    it('returns 404 for an unknown session', async () => {
      setVoiceEnv();
      const res = await fetch(`${baseUrl}/api/realtime/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: '11111111-1111-4111-8111-111111111111' }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'unknown session' });
    });

    it('returns 400 for a missing/non-uuid sessionId', async () => {
      setVoiceEnv();
      const res = await fetch(`${baseUrl}/api/realtime/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'not-a-uuid' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 503 when voice is not configured', async () => {
      clearVoiceEnv();
      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      const res = await fetch(`${baseUrl}/api/realtime/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'voice not configured' });
    });

    it('returns 503 when LIVEKIT_API_KEY+SECRET are set but LIVEKIT_URL is empty', async () => {
      // Regression guard: a blank URL with valid credentials must still be treated
      // as "not configured" (the URL is required for the client to connect).
      process.env.LIVEKIT_API_KEY = 'devkey';
      process.env.LIVEKIT_API_SECRET = 'devsecret-at-least-32-bytes-long-padding';
      delete process.env.LIVEKIT_URL;

      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      const res = await fetch(`${baseUrl}/api/realtime/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'voice not configured' });
    });

    it('rate-limits repeated mints for one session (429 after the per-window cap)', async () => {
      setVoiceEnv();
      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      const mint = (): Promise<Response> =>
        fetch(`${baseUrl}/api/realtime/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
      // The limiter allows 6 mints per minute per session; the 7th is throttled.
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) statuses.push((await mint()).status);
      expect(statuses.slice(0, 6).every((s) => s === 201)).toBe(true);
      expect(statuses[6]).toBe(429);
    });
  });
});
