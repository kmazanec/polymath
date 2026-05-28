import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Action } from '@polymath/contract';
import { createDb, type Db } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { events, sessions } from './db/schema.js';
import { canRunPg, ensureTestPg } from './db/testPg.js';
import { StubAgentClient } from './agent/stubClient.js';
import type { AgentClient } from './agent/client.js';
import { createServer, type PolymathServer } from './server.js';
import { deriveState, toLearnerState, type LoggedEvent } from './mastery/eventConsumer.js';
import { loadLesson } from './lessons/loader.js';
import type { ExplainBackJudge } from '@polymath/graph';
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
    // (F-11/F-12) — so the agent does NOT declare mastery. F-11's deterministic
    // server reflex now mounts an ExplainBackPrompt for the just-passed item
    // (superseding the I1 no_action arm); F-12 owns the eventual mastery transition
    // and remains fail-closed: a passed transfer alone is never mastery while the
    // explain-back condition is unmet.
    const [afterTransfer] = await driveSequence(sessionId, [
      { kind: 'transfer_submitted', sessionId, itemId: probedItemId, submission: probedExpr },
    ]);
    expect(afterTransfer!.type).toBe('mount');
    if (afterTransfer!.type === 'mount') {
      expect(afterTransfer!.component.kind).toBe('ExplainBackPrompt');
      if (afterTransfer!.component.kind === 'ExplainBackPrompt') {
        expect(afterTransfer!.component.targetItemId).toBe(probedItemId);
        expect(afterTransfer!.component.maxDurationSec).toBe(15);
      }
    }

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

  /**
   * F-12 AC#1/#5/#6 — the REACHABILITY test: drive a RAW ClientEvent sequence
   * through the real `handleClientFrame` fold to MASTERY. The single most important
   * F-12 test — it fails if the gate wiring is inert (the I1 inert-refusal trap). It
   * uses the dev `?testExplainBackVerdict=pass` seam to synthesize F-11's verdict
   * (the Phase-2 serial join; F-11's real judge replaces the seam, the fold is
   * unchanged), then asserts (i) the agent organically proposes mastery, (ii) the
   * server earned-it gate accepts → a MasteryCelebration mounts, (iii) the replay
   * shows the per-turn gate evaluation flipping from failing to passing.
   */
  it('drives a RAW event sequence through the real fold to mastery: celebration mounts + gate flips (AC#1,#5,#6)', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    // Get the learner past the rule gate and fire + pass a transfer probe (as above).
    const ws1 = new WebSocket(wsUrl);
    const upToTransfer = await new Promise<Action[]>((resolve, reject) => {
      const frames: Record<string, unknown>[] = [
        { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 5000 },
        { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 6000 },
        { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 4000 },
      ];
      const out: Action[] = [];
      let sent = 0;
      ws1.on('open', () => ws1.send(JSON.stringify(frames[sent++])));
      ws1.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.kind === 'action') {
          out.push(Action.parse(msg.action));
          if (sent < frames.length) ws1.send(JSON.stringify(frames[sent++]));
          else resolve(out);
        }
      });
      ws1.on('error', reject);
      setTimeout(() => reject(new Error('timed out')), 8000);
    });
    ws1.close();
    const probe = upToTransfer.find((a) => a.type === 'mount' && a.component.kind === 'TransferProbe');
    const probedItemId = probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.itemId : '';
    const probedExpr = probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.expression : '';
    expect(probedItemId).toBeTruthy();

    // Resolve the transfer probe (rule + transfer now satisfied; explain-back still unmet).
    await driveSequence(sessionId, [
      { kind: 'transfer_submitted', sessionId, itemId: probedItemId, submission: probedExpr },
    ]);

    // Now drive the explain-back turn over a socket carrying the dev verdict seam.
    // The server folds the synthetic PASS verdict, the FULL gate clears, the agent
    // organically proposes mastery, and the earned-it gate accepts → the server
    // reflexively mounts the MasteryCelebration listing the mastered concepts.
    const wsEb = new WebSocket(`${wsUrl}?testExplainBackVerdict=pass`);
    const mastery = await new Promise<Action>((resolve, reject) => {
      wsEb.on('open', () =>
        wsEb.send(
          JSON.stringify({
            kind: 'explain_back_recording_ended',
            sessionId,
            targetItemId: 'l1-and',
            transcript: 'An AND gate outputs true only when both inputs are true.',
            durationMs: 20000,
          }),
        ),
      );
      wsEb.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.kind === 'action') resolve(Action.parse(msg.action));
      });
      wsEb.on('error', reject);
      setTimeout(() => reject(new Error('timed out')), 8000);
    });
    wsEb.close();

    // AC#1 + AC#6: the gate accepted → a MasteryCelebration mounts listing mastered KCs.
    expect(mastery.type).toBe('mount');
    if (mastery.type === 'mount') {
      expect(mastery.component.kind).toBe('MasteryCelebration');
      if (mastery.component.kind === 'MasteryCelebration') {
        expect(mastery.component.conceptsMastered).toContain('AND');
      }
    }

    // AC#5: the replay shows the per-turn gate evaluation flipping failing → passing,
    // and the accepted statechart decision on the mastery turn.
    await new Promise((r) => setTimeout(r, 300));
    const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
      events: {
        payload: {
          gateEvaluation?: { passed: boolean; blockers: string[] };
          statechartDecision?: string;
          explainBackVerdict?: { passed: boolean };
        };
      }[];
    };
    const gateSeries = replay.events
      .map((e) => e.payload.gateEvaluation)
      .filter((g): g is { passed: boolean; blockers: string[] } => g !== undefined);
    expect(gateSeries.some((g) => g.passed === false)).toBe(true); // failed earlier
    expect(gateSeries.some((g) => g.passed === true)).toBe(true); // then passed
    expect(replay.events.some((e) => e.payload.explainBackVerdict?.passed === true)).toBe(true);
    expect(replay.events.some((e) => e.payload.statechartDecision === 'accept')).toBe(true);
  });

  /**
   * FAIL-path reachability (the I1 inert-refusal trap, the inverse of the PASS test):
   * an explicit FAILING explain-back verdict must carry `passed:false` through the
   * REAL fold (toLoggedEvent → deriveState → toLearnerState → evaluateMasteryGate) and
   * block mastery with `explain_back_not_passed`. Same setup as the PASS test, but the
   * explain-back turn carries `?testExplainBackVerdict=fail`. Proves the explicit-false
   * verdict (not just the no-verdict default) is folded fail-closed end-to-end.
   */
  it('drives a FAILING explain-back verdict through the real fold and blocks with explain_back_not_passed', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    const ws1 = new WebSocket(wsUrl);
    const upToTransfer = await new Promise<Action[]>((resolve, reject) => {
      const frames: Record<string, unknown>[] = [
        { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 5000 },
        { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 6000 },
        { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 4000 },
      ];
      const out: Action[] = [];
      let sent = 0;
      ws1.on('open', () => ws1.send(JSON.stringify(frames[sent++])));
      ws1.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.kind === 'action') {
          out.push(Action.parse(msg.action));
          if (sent < frames.length) ws1.send(JSON.stringify(frames[sent++]));
          else resolve(out);
        }
      });
      ws1.on('error', reject);
      setTimeout(() => reject(new Error('timed out')), 8000);
    });
    ws1.close();
    const probe = upToTransfer.find((a) => a.type === 'mount' && a.component.kind === 'TransferProbe');
    const probedItemId = probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.itemId : '';
    const probedExpr = probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.expression : '';
    expect(probedItemId).toBeTruthy();
    await driveSequence(sessionId, [
      { kind: 'transfer_submitted', sessionId, itemId: probedItemId, submission: probedExpr },
    ]);

    // Explain-back turn carrying a FAILING verdict: the gate must NOT pass.
    const wsEb = new WebSocket(`${wsUrl}?testExplainBackVerdict=fail`);
    const after = await new Promise<Action>((resolve, reject) => {
      wsEb.on('open', () =>
        wsEb.send(
          JSON.stringify({
            kind: 'explain_back_recording_ended',
            sessionId,
            targetItemId: 'l1-and',
            transcript: 'um, I am not sure',
            durationMs: 20000,
          }),
        ),
      );
      wsEb.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.kind === 'action') resolve(Action.parse(msg.action));
      });
      wsEb.on('error', reject);
      setTimeout(() => reject(new Error('timed out')), 8000);
    });
    wsEb.close();
    // No celebration — the explicit-false verdict folds fail-closed.
    expect(after.type === 'mount' && after.component.kind === 'MasteryCelebration').toBe(false);

    await new Promise((r) => setTimeout(r, 300));
    const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
      events: { payload: { gateEvaluation?: { passed: boolean; blockers: string[] }; explainBackVerdict?: { passed: boolean } } }[];
    };
    // The failing verdict was persisted and folded → the gate blocks with explain_back_not_passed.
    expect(replay.events.some((e) => e.payload.explainBackVerdict?.passed === false)).toBe(true);
    const lastGate = replay.events
      .map((e) => e.payload.gateEvaluation)
      .filter((g): g is { passed: boolean; blockers: string[] } => g !== undefined)
      .at(-1);
    expect(lastGate?.passed).toBe(false);
    expect(lastGate?.blockers).toContain('explain_back_not_passed');
  });

  /**
   * F-12 AC#2 — the NEGATIVE path: a learner who clears rule + transfer + explain-back
   * but has tripped the off-topic budget. Drive REAL off-topic `learner_question`
   * turns (the agent's off_topic answers are counted by the real fold) past the
   * budget of 3, then drive the explain-back PASS — and assert mastery is NOT
   * proposed and the persisted gate evaluation carries `topic_guardrail_exceeded`.
   */
  it('blocks mastery when the off-topic budget is tripped, with topic_guardrail_exceeded logged (AC#2)', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    // Pass the rule gate.
    const upToProbe = await driveSequence(sessionId, [
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 5000 },
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 6000 },
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 4000 },
    ]);
    const probe = upToProbe.find((a) => a.type === 'mount' && a.component.kind === 'TransferProbe');
    const probedItemId = probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.itemId : '';
    const probedExpr = probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.expression : '';
    // Pass the transfer.
    await driveSequence(sessionId, [
      { kind: 'transfer_submitted', sessionId, itemId: probedItemId, submission: probedExpr },
    ]);
    // Trip the off-topic budget (budget = 3 → 4 off-topic answers exceeds it). Each
    // off-topic question is answered with an off_topic-tagged answer the fold counts.
    await driveSequence(sessionId, [
      { kind: 'learner_question', sessionId, question: 'can you book me a flight to Paris?' },
      { kind: 'learner_question', sessionId, question: 'what is the weather tomorrow?' },
      { kind: 'learner_question', sessionId, question: 'tell me a joke about cats' },
      { kind: 'learner_question', sessionId, question: 'who won the game last night?' },
    ]);
    // Now the explain-back passes — but the guardrail is dirty, so mastery is blocked.
    const wsEb = new WebSocket(`${wsUrl}?testExplainBackVerdict=pass`);
    const after = await new Promise<Action>((resolve, reject) => {
      wsEb.on('open', () =>
        wsEb.send(
          JSON.stringify({
            kind: 'explain_back_recording_ended',
            sessionId,
            targetItemId: 'l1-and',
            transcript: 'An AND gate outputs true only when both inputs are true.',
            durationMs: 20000,
          }),
        ),
      );
      wsEb.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.kind === 'action') resolve(Action.parse(msg.action));
      });
      wsEb.on('error', reject);
      setTimeout(() => reject(new Error('timed out')), 8000);
    });
    wsEb.close();
    // The agent does NOT propose mastery (it waits) — no MasteryCelebration mounts.
    expect(after.type === 'mount' && after.component.kind === 'MasteryCelebration').toBe(false);

    await new Promise((r) => setTimeout(r, 300));
    const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
      events: { payload: { gateEvaluation?: { passed: boolean; blockers: string[] } } }[];
    };
    const lastGate = replay.events
      .map((e) => e.payload.gateEvaluation)
      .filter((g): g is { passed: boolean; blockers: string[] } => g !== undefined)
      .at(-1);
    expect(lastGate?.passed).toBe(false);
    expect(lastGate?.blockers).toContain('topic_guardrail_exceeded');
  });

  /**
   * F-12 AC#3 — the DEMOABLE mastery-without-conditions refusal. The dev-only
   * `?testForce=mastered` seam injects a real `transition→mastered` proposal at the
   * very first turn (the gate cannot possibly be satisfied). The earned-it gate must
   * REJECT it: the action is downgraded to `no_action` and the persisted statechart
   * decision is `reject` with `mastery_gate_failed: <blockers>`.
   */
  it('rejects a forced mastery transition when the gate is unsatisfied (?testForce=mastered) — AC#3', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    const ws = new WebSocket(`${wsUrl}?testForce=mastered`);
    const action = await new Promise<Action>((resolve, reject) => {
      ws.on('open', () =>
        ws.send(
          JSON.stringify({ kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true }),
        ),
      );
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.kind === 'action') resolve(Action.parse(msg.action));
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timed out')), 8000);
    });
    ws.close();
    // The forced transition is REJECTED → downgraded to no_action (NOT a celebration).
    expect(action.type).toBe('no_action');

    await new Promise((r) => setTimeout(r, 300));
    const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
      events: { payload: { statechartDecision?: string; statechartReason?: string } }[];
    };
    const rejection = replay.events.find((e) => e.payload.statechartDecision === 'reject');
    expect(rejection, 'a reject statechart decision should be logged').toBeTruthy();
    expect(rejection!.payload.statechartReason).toMatch(/^mastery_gate_failed:/);
  });

  /**
   * SECURITY (earned-it gate, direct-mount route): a jailbroken/forged provider
   * can try to mount `MasteryCelebration` DIRECTLY (bypassing the `transition→mastered`
   * route the earned-it gate guards) with attacker-controlled `conceptsMastered`. A
   * direct MasteryCelebration mount passes Zod + passes Layer-2 trivially (it carries
   * no claimedTruthTable), so without an explicit earned-it check it would be forwarded
   * to the learner. The server must downgrade it to `no_action` unless the full mastery
   * gate is satisfied server-side — MasteryCelebration is server-minted only.
   *
   * Driven through the REAL fold (handleClientFrame): a dedicated forging agent boots
   * its own server so the very first turn's proposal is the forged mount.
   */
  it('downgrades a forged direct MasteryCelebration mount when the gate is unsatisfied (earned-it, direct-mount route)', async () => {
    const forgingAgent: AgentClient = {
      propose: async (): Promise<Action> => ({
        type: 'mount',
        component: { kind: 'MasteryCelebration', conceptsMastered: ['AND', 'OR', 'NOT'] },
        rationale: 'forged early celebration',
      }),
    };
    const forgeServer = createServer({ db, agent: forgingAgent });
    await new Promise<void>((resolve) => forgeServer.httpServer.listen(0, resolve));
    const { port } = forgeServer.httpServer.address() as AddressInfo;
    const forgeBase = `http://localhost:${port}`;
    const forgeWs = `ws://localhost:${port}/agent`;
    try {
      const { sessionId } = (await (await fetch(`${forgeBase}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      const ws = new WebSocket(forgeWs);
      const action = await new Promise<Action>((resolve, reject) => {
        ws.on('open', () =>
          ws.send(
            JSON.stringify({ kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true }),
          ),
        );
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.kind === 'action') resolve(Action.parse(msg.action));
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('timed out')), 8000);
      });
      ws.close();
      // The forged celebration is REJECTED at the first turn (gate cannot be satisfied)
      // → downgraded to no_action, NOT forwarded with attacker-controlled concepts.
      expect(action.type).toBe('no_action');
    } finally {
      await forgeServer.close();
    }
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

  // ── F-11 explain-back rubric: REACHABILITY (the I1 inert-refusal lesson) ──────
  // The single most important F-11 test: a raw `explain_back_recording_ended`
  // ClientEvent driven through the real fold (handleClientFrame), NOT a hand-set
  // state. Proves the subgraph is REACHABLE (wired), not merely correct in isolation.
  describe('F-11 explain-back rubric (server reflex, reachability)', () => {
    /** Drive the gate to a transfer-pass so an ExplainBackPrompt is mounted; return
     *  the probed item id (the explain-back `targetItemId`). */
    async function driveToExplainBackPrompt(sessionId: string): Promise<string> {
      const actions = await driveSequence(sessionId, [
        { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 5000 },
        { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 6000 },
        { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 4000 },
      ]);
      const probe = actions.find((a) => a.type === 'mount' && a.component.kind === 'TransferProbe');
      const probedItemId =
        probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.itemId : '';
      const probedExpr =
        probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.expression : '';
      const [afterTransfer] = await driveSequence(sessionId, [
        { kind: 'transfer_submitted', sessionId, itemId: probedItemId, submission: probedExpr },
      ]);
      // The transfer-pass reflex mounted the explain-back prompt.
      expect(afterTransfer!.type === 'mount' && afterTransfer!.component.kind).toBe('ExplainBackPrompt');
      return probedItemId;
    }

    it('routes a raw explain_back_recording_ended through the rubric, logs a verdict, and re-mounts on a precondition fail (AC#7, AC#8)', async () => {
      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      const targetItemId = await driveToExplainBackPrompt(sessionId);

      // A too-short transcript (< 10 words) fails precondition #3. No judge runs.
      // The rubric must (a) persist a verdict row and (b) re-mount ExplainBackPrompt.
      const [verdictAction] = await driveSequence(sessionId, [
        {
          kind: 'explain_back_recording_ended',
          sessionId,
          targetItemId,
          transcript: 'um the AND gate',
          durationMs: 6000,
        },
      ]);
      // (b) A precondition fail loops back to a retry ExplainBackPrompt (AC#8).
      expect(verdictAction!.type).toBe('mount');
      if (verdictAction!.type === 'mount') {
        expect(verdictAction!.component.kind).toBe('ExplainBackPrompt');
        if (verdictAction!.component.kind === 'ExplainBackPrompt') {
          expect(verdictAction!.component.targetItemId).toBe(targetItemId);
        }
      }

      // (a) The verdict row is persisted with full precondition status (AC#7), and
      // the verdict failed CLOSED (no key in this run → judge never reached because
      // the precondition tripped first; reasons name the precondition).
      await new Promise((r) => setTimeout(r, 300));
      const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
        events: {
          kind: string;
          payload: {
            explainBackVerdict?: { passed: boolean; reasons: string[] };
            validation?: { layer?: number; status?: string; detail?: { reasons?: string[] } };
          };
        }[];
      };
      const verdictRow = replay.events.find((e) => e.kind === 'explain_back_recording_ended');
      expect(verdictRow, 'an explain-back verdict row is persisted').toBeTruthy();
      expect(verdictRow!.payload.explainBackVerdict?.passed).toBe(false);
      expect(verdictRow!.payload.explainBackVerdict?.reasons).toContain('too_few_words');
      expect(verdictRow!.payload.validation?.layer).toBe(4);
      expect(verdictRow!.payload.validation?.status).toBe('reject');
    });

    it('clamps the recording window server-side: an over-cap durationMs cannot extend it (AC#9)', async () => {
      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      const targetItemId = await driveToExplainBackPrompt(sessionId);

      // A manipulated client claims a 14s recording (under the 15s cap) but with a
      // transcript that is empty — the clamp + preconditions both reject it. More
      // importantly, a client claiming a HUGE durationMs cannot satisfy #2 by lying:
      // the server clamps to maxDurationSec*1000 before the preconditions read it.
      await driveSequence(sessionId, [
        {
          kind: 'explain_back_recording_ended',
          sessionId,
          targetItemId,
          transcript: '',
          durationMs: 9_999_999, // absurd over-cap value — must be clamped, not trusted
        },
      ]);
      await new Promise((r) => setTimeout(r, 300));
      const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
        events: {
          kind: string;
          payload: { explainBackVerdict?: { passed: boolean }; validation?: { detail?: { effectiveDurationMs?: number } } };
        }[];
      };
      const verdictRow = replay.events.find((e) => e.kind === 'explain_back_recording_ended');
      expect(verdictRow!.payload.explainBackVerdict?.passed).toBe(false);
      // The effective duration was clamped to the 15s window, never the lie.
      expect(verdictRow!.payload.validation?.detail?.effectiveDurationMs).toBeLessThanOrEqual(15_000);
    });

    it('caps judge invocations: a 3rd attempt short-circuits to escalation WITHOUT running the rubric (anti-farming, AC#8)', async () => {
      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      const targetItemId = await driveToExplainBackPrompt(sessionId);

      // Two failing attempts (precondition fail; no judge). The 2nd hits the cap and
      // escalates AFTER running the rubric. A 3rd frame must NOT run the rubric at
      // all — it short-circuits to escalation (a client can't farm judge calls by
      // replaying preconditions-passing frames).
      const frame = {
        kind: 'explain_back_recording_ended',
        sessionId,
        targetItemId,
        transcript: 'um the AND gate', // < 10 words → precondition fail
        durationMs: 6000,
      };
      const a1 = (await driveSequence(sessionId, [frame]))[0];
      expect(a1!.type).toBe('mount'); // attempt 1 → retry mount
      const a2 = (await driveSequence(sessionId, [frame]))[0];
      expect(a2!.type).toBe('no_action'); // attempt 2 (cap) → escalate
      const a3 = (await driveSequence(sessionId, [frame]))[0];
      expect(a3!.type).toBe('no_action'); // attempt 3 → short-circuit, no rubric

      await new Promise((r) => setTimeout(r, 300));
      const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
        events: { kind: string; payload: { explainBackVerdict?: { passed: boolean; reasons: string[] } } }[];
      };
      const ebRows = replay.events.filter((e) => e.kind === 'explain_back_recording_ended');
      expect(ebRows.length).toBe(3);
      // Exactly one row is the short-circuit (the 3rd attempt): its verdict carries
      // `attempt_cap_reached`, proving the rubric/judge never executed for it. The
      // other two carry the precondition reason (`too_few_words`).
      const capped = ebRows.filter((r) => r.payload.explainBackVerdict?.reasons.includes('attempt_cap_reached'));
      const tripped = ebRows.filter((r) => r.payload.explainBackVerdict?.reasons.includes('too_few_words'));
      expect(capped.length).toBe(1);
      expect(tripped.length).toBe(2);
    });

    it('an unsolicited explain_back_recording_ended (no prompt mounted) fails closed', async () => {
      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      // No transfer pass → no ExplainBackPrompt mounted. A forged event must not
      // produce a pass; the window is treated as 0 → precondition #1 trips.
      await driveSequence(sessionId, [
        {
          kind: 'explain_back_recording_ended',
          sessionId,
          targetItemId: 'L1-01-and',
          transcript: 'I used the AND gate on the variables A and B to get the output here today',
          durationMs: 8000,
        },
      ]);
      await new Promise((r) => setTimeout(r, 300));
      const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
        events: { kind: string; payload: { explainBackVerdict?: { passed: boolean; reasons: string[] } } }[];
      };
      const verdictRow = replay.events.find((e) => e.kind === 'explain_back_recording_ended');
      expect(verdictRow!.payload.explainBackVerdict?.passed).toBe(false);
      expect(verdictRow!.payload.explainBackVerdict?.reasons).toContain('duration_too_short');
    });
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

/**
 * F-11 PASS-PATH reachability: the single most important assertion that was missing.
 * The main suite boots the server with NO judge, so every explain-back resolves to a
 * precondition-fail or `judge_unavailable` — the entire PASS→derived-state chain was
 * never driven through `handleClientFrame`. This boots a server WITH an injected
 * passing judge (the production seam) and a server-side transcript provider (the
 * bridge seam), drives a raw `explain_back_recording_ended` through the real fold,
 * and asserts: (a) the persisted row carries `explainBackVerdict.passed === true`,
 * and (b) projecting that real persisted verdict through the real `deriveState`
 * flips `explainBackPassed` to true (the F-12 mastery-gate input).
 *
 * This guards against the I1 inert-subgraph trap on the PASS path specifically: a
 * green precondition-fail suite hid that no learner could ever pass end-to-end.
 */
describe.skipIf(!canRunPg)('F-11 explain-back PASS path through the real fold', () => {
  let pdb: Db;
  let ppool: { end: () => Promise<void> };
  let pserver: PolymathServer;
  let pBaseUrl: string;
  let pWsUrl: string;

  // A deterministic judge that always passes — the production seam, injected.
  const passingJudge: ExplainBackJudge = {
    judge: () =>
      Promise.resolve({
        passed: true,
        subScores: { itemSpecific: true, itemSpecificReasoning: true, prosodyThinking: true, overall: true },
      }),
  };
  // The server-side authoritative transcript (the bridge seam): a genuine, fluent
  // item-specific explanation that clears all 5 preconditions for the AND item.
  const bridgeTranscript =
    'For this AND gate the output is true only when both A and B are true, so I marked the bottom row true and the other three false in the truth table.';

  beforeAll(async () => {
    const POSTGRES_URL = await ensureTestPg();
    await runMigrations(POSTGRES_URL);
    ({ db: pdb, pool: ppool } = createDb(POSTGRES_URL));
    pserver = createServer({
      db: pdb,
      agent: new StubAgentClient(),
      explainBackJudge: passingJudge,
      explainBackTranscriptFor: () => bridgeTranscript,
    });
    await new Promise<void>((resolve) => pserver.httpServer.listen(0, resolve));
    const { port } = pserver.httpServer.address() as AddressInfo;
    pBaseUrl = `http://localhost:${port}`;
    pWsUrl = `ws://localhost:${port}/agent`;
  }, 60000);

  afterAll(async () => {
    await pserver.close();
    await ppool.end().catch(() => {});
  });

  async function drive(sessionId: string, frames: Record<string, unknown>[]): Promise<Action[]> {
    const ws = new WebSocket(pWsUrl);
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

  it('a raw explain_back_recording_ended → passing judge → persisted PASS verdict → derived explainBackPassed true', async () => {
    const { sessionId } = (await (await fetch(`${pBaseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    // Drive the gate to a transfer-pass so the server mounts ExplainBackPrompt.
    const actions = await drive(sessionId, [
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 5000 },
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 6000 },
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 4000 },
    ]);
    const probe = actions.find((a) => a.type === 'mount' && a.component.kind === 'TransferProbe');
    const probedItemId = probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.itemId : '';
    const probedExpr = probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.expression : '';
    const [afterTransfer] = await drive(sessionId, [
      { kind: 'transfer_submitted', sessionId, itemId: probedItemId, submission: probedExpr },
    ]);
    expect(afterTransfer!.type === 'mount' && afterTransfer!.component.kind).toBe('ExplainBackPrompt');

    // Now send the explain-back completion signal. The client transcript is empty
    // (the bridge supplies the authoritative one server-side); durationMs within the
    // window. With the passing judge wired, this MUST pass end-to-end.
    const [verdictAction] = await drive(sessionId, [
      { kind: 'explain_back_recording_ended', sessionId, targetItemId: probedItemId, transcript: '', durationMs: 9000 },
    ]);
    // F-11 stops at the verdict on a pass → no_action (F-12 owns the transition).
    expect(verdictAction!.type).toBe('no_action');

    await new Promise((r) => setTimeout(r, 300));
    const replay = (await (await fetch(`${pBaseUrl}/api/session/${sessionId}/replay`)).json()) as {
      events: { kind: string; payload: { explainBackVerdict?: { passed: boolean; reasons: string[] } } }[];
    };
    const verdictRow = replay.events.find((e) => e.kind === 'explain_back_recording_ended');
    // (a) the persisted verdict is a PASS — driven through the real route + judge.
    expect(verdictRow, 'an explain-back verdict row is persisted').toBeTruthy();
    expect(verdictRow!.payload.explainBackVerdict?.passed).toBe(true);
    expect(verdictRow!.payload.explainBackVerdict?.reasons).toEqual([]);

    // (b) projecting the REAL persisted verdict through the REAL deriveState flips
    // explainBackPassed — exactly the projection toLoggedEvent does server-side
    // (kind + explainBackVerdict.passed). This is the F-12 mastery-gate input.
    const logged: LoggedEvent[] = replay.events.map((e) => ({
      kind: e.kind,
      explainBackPassed: e.payload.explainBackVerdict?.passed,
    }));
    const lesson = loadLesson(1);
    const derived = deriveState(logged, lesson.content, lesson.masteryConfig);
    expect(derived.explainBackPassed).toBe(true);
    expect(toLearnerState(derived, lesson.masteryConfig).explainBackPassed).toBe(true);
  });
});
