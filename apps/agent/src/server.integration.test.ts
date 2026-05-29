import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Action } from '@polymath/contract';
import { createDb, type Db } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { events, learnerState, sessions } from './db/schema.js';
import { canRunPg, ensureTestPg } from './db/testPg.js';
import { StubAgentClient } from './agent/stubClient.js';
import type { AgentClient } from './agent/client.js';
import { createServer, currentLessonId, type PolymathServer } from './server.js';
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

// CLUSTER D thread 6: the synthetic test seams (`?testForce=mastered`,
// `?testExplainBackVerdict=…`) are gated behind this explicit opt-in env (default OFF,
// always off in production). The integration harness opts in; a real deploy never does.
process.env['POLYMATH_ENABLE_TEST_SEAMS'] = 'true';

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

    // CLUSTER A/D: the synthetic PASS seam now also requires a non-empty SERVER
    // transcript that clears the preconditions (it can never fold with an empty
    // transcript). Populate the server-side capture registry — the production
    // integrity source — with a genuine item-specific transcript for the PROBED item
    // (the one the ExplainBackPrompt was mounted for; its tokens drive precondition #5).
    server.explainBackCaptureRegistry.setTranscript(
      sessionId,
      probedItemId,
      'For this AND gate the output is true only when both A and B are true across every row of the truth table.',
    );

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
            targetItemId: probedItemId,
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
   * F-15 helper: drive a fresh session through L1 to a mounted MasteryCelebration,
   * reusing the exact PASS path above (rule gate → transfer probe → pass →
   * server-side transcript → synthetic explain-back PASS). Returns the sessionId of a
   * session whose L1 mastery gate has passed server-side and whose celebration mounted.
   */
  async function driveToL1Mastery(): Promise<{ sessionId: string; celebration: Action }> {
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
    if (!probedItemId) throw new Error('no transfer probe fired');

    await driveSequence(sessionId, [
      { kind: 'transfer_submitted', sessionId, itemId: probedItemId, submission: probedExpr },
    ]);
    server.explainBackCaptureRegistry.setTranscript(
      sessionId,
      probedItemId,
      'For this AND gate the output is true only when both A and B are true across every row of the truth table.',
    );
    const wsEb = new WebSocket(`${wsUrl}?testExplainBackVerdict=pass`);
    const celebration = await new Promise<Action>((resolve, reject) => {
      wsEb.on('open', () =>
        wsEb.send(
          JSON.stringify({
            kind: 'explain_back_recording_ended',
            sessionId,
            targetItemId: probedItemId,
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
    return { sessionId, celebration };
  }

  /**
   * F-15 AC#2/AC#6 — the celebration's "continue to Lesson 2" affordance is REAL: the
   * server-minted MasteryCelebration carries `nextLessonId:2` (guarded by the non-fatal
   * `loadLesson(2)` existence check; the placeholder L2 makes it load). Without a next
   * lesson the field is absent and the client keeps the button disabled.
   */
  it('mounts a MasteryCelebration carrying nextLessonId=2 once L1 mastery is earned (AC#2)', async () => {
    const { celebration } = await driveToL1Mastery();
    expect(celebration.type).toBe('mount');
    if (celebration.type === 'mount' && celebration.component.kind === 'MasteryCelebration') {
      expect(celebration.component.nextLessonId).toBe(2);
    } else {
      throw new Error('expected a MasteryCelebration mount');
    }
  });

  /**
   * F-15 AC#3 + the F-14 ENABLER — the data-path proof. After L1 mastery, an
   * `advance_lesson` reflex (i) writes `sessions.lessonProgress.currentLessonId=2` on the
   * SAME session, (ii) leaves the L1 KC `learner_state` rows intact under that same
   * session (so F-14's regression detector can read them), (iii) deterministically mounts
   * L2's first item server-side (NOT the LLM), and (iv) a subsequent L2 `submit` folds
   * against L2 content (currentLessonId now resolves to 2).
   */
  it('advance_lesson advances to L2 on the SAME session, preserves L1 learner_state, mounts L2 item[0] (AC#2,#3,#5)', async () => {
    const { sessionId } = await driveToL1Mastery();

    // L1 learner_state rows exist before the advance (the BKT the F-14 detector reads).
    const l1Rows = await db.select().from(learnerState).where(eq(learnerState.sessionId, sessionId));
    expect(l1Rows.length).toBeGreaterThan(0);
    const l1Kcs = new Set(l1Rows.map((r) => r.kc));

    // Fire the advance reflex.
    const [advanceAction] = await driveSequence(sessionId, [
      { kind: 'advance_lesson', sessionId, toLessonId: 2 },
    ]);

    // AC#2: the reflex deterministically mounts L2's first item (a TruthTablePractice).
    expect(advanceAction!.type).toBe('mount');
    if (advanceAction!.type === 'mount') {
      expect(advanceAction!.component.kind).toBe('TruthTablePractice');
      if (advanceAction!.component.kind === 'TruthTablePractice') {
        // L2 item[0] expression — F-13's canonical lessons/2 content (reconciled at the
        // I3 merge sink; F-15 was built against a placeholder before F-13's content landed).
        expect(advanceAction!.component.expression).toBe('(A AND B) OR (NOT C)');
      }
    }

    // AC#5: the durable binding flipped to lesson 2 on the SAME session.
    expect(await currentLessonId(db, sessionId)).toBe(2);
    const sessRows = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect((sessRows[0]!.lessonProgress as { currentLessonId: number }).currentLessonId).toBe(2);

    // AC#3 / F-14 enabler: the L1 KC learner_state rows survive under the SAME session.
    const afterRows = await db.select().from(learnerState).where(eq(learnerState.sessionId, sessionId));
    for (const kc of l1Kcs) {
      expect(afterRows.some((r) => r.kc === kc)).toBe(true);
    }

    // A subsequent L2 submit now binds to lesson 2 (currentLessonId resolves to 2) and
    // round-trips an action without error — the lesson-binding read sees the advance.
    const [l2Action] = await driveSequence(sessionId, [
      { kind: 'submit', sessionId, itemId: 'l2-and-or-c', submission: '(A AND B) OR (NOT C)', correct: true, responseTimeMs: 5000 },
    ]);
    expect(l2Action!.type).toBeTruthy();
  });

  /**
   * F-15 AC#4 — the REAL server guard (fail-closed). An `advance_lesson` from a session
   * that has NOT earned L1 mastery is REFUSED with `no_action` (no lesson change, no
   * mount) — the server re-derives L1 mastery from the event log; it never trusts the
   * client frame. This is the macro-transition guard's real enforcement (the server runs
   * no XState; this branch is the truth-maker, like the mastery earned-it rejection).
   */
  it('refuses advance_lesson with no_action when L1 mastery is not earned, and does NOT change the lesson (AC#4)', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    // A single correct submit is nowhere near the mastery gate.
    await driveSequence(sessionId, [
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 5000 },
    ]);
    const [refused] = await driveSequence(sessionId, [
      { kind: 'advance_lesson', sessionId, toLessonId: 2 },
    ]);
    expect(refused!.type).toBe('no_action');

    // Fail-closed: the durable binding is unchanged (still lesson 1).
    expect(await currentLessonId(db, sessionId)).toBe(1);

    // The replay records WHY (a reject decision naming the mastery blockers).
    await new Promise((r) => setTimeout(r, 200));
    const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
      events: { kind: string; payload: { statechartDecision?: string; statechartReason?: string } }[];
    };
    const advanceTurn = replay.events.find((e) => e.kind === 'advance_lesson');
    expect(advanceTurn?.payload.statechartDecision).toBe('reject');
    expect(advanceTurn?.payload.statechartReason).toContain('mastery_gate_failed');
  });

  /**
   * F-15 — a non-adjacent / non-existent target is REFUSED (no skipping lessons; a
   * forged `toLessonId` is block, never a half-valid advance). Even from a mastered L1
   * session, advancing to lesson 3 (which doesn't exist) yields no_action and no change.
   */
  it('refuses advance_lesson to a non-adjacent/non-existent lesson even when L1 is mastered', async () => {
    const { sessionId } = await driveToL1Mastery();
    const [refused] = await driveSequence(sessionId, [
      { kind: 'advance_lesson', sessionId, toLessonId: 3 },
    ]);
    expect(refused!.type).toBe('no_action');
    expect(await currentLessonId(db, sessionId)).toBe(1);
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
    // The explain-back transcript clears the preconditions (server-side integrity
    // source) so the synthetic PASS is honored — but the guardrail is dirty, so
    // mastery is still blocked (the point of this test).
    server.explainBackCaptureRegistry.setTranscript(
      sessionId,
      probedItemId,
      'For this AND gate the output is true only when both A and B are true across every row of the truth table.',
    );
    // Now the explain-back passes — but the guardrail is dirty, so mastery is blocked.
    const wsEb = new WebSocket(`${wsUrl}?testExplainBackVerdict=pass`);
    const after = await new Promise<Action>((resolve, reject) => {
      wsEb.on('open', () =>
        wsEb.send(
          JSON.stringify({
            kind: 'explain_back_recording_ended',
            sessionId,
            targetItemId: probedItemId,
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
    // CLUSTER F: a passing explain-back blocked by the guardrail mounts an explicit
    // blocker-remediation (HintCard) — NOT a bare no_action — so the learner has a path.
    expect(after.type).toBe('mount');
    if (after.type === 'mount') {
      expect(after.component.kind).toBe('HintCard');
      if (after.component.kind === 'HintCard') {
        expect(after.component.body.toLowerCase()).toContain('off-topic');
      }
    }

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
   * CLUSTER E — the topic-guardrail must NOT age out of the bounded fold window. A
   * learner who tripped the off-topic budget (>3 off-topic answers) and then pushes
   * those rows past the newest-500 fold window with benign frames must STILL be
   * blocked: the guardrail is counted with a separate, uncapped session-wide query.
   *
   * We insert the history directly (driving 500+ real WS turns would be slow): 4
   * off-topic `answer_question` rows, then >500 benign rows so the off-topic rows fall
   * outside the MAX_SESSION_EVENTS fold window, then a passing explain-back turn —
   * asserting mastery is still blocked with `topic_guardrail_exceeded`.
   */
  it('the off-topic guardrail does not age out past the fold window (>500 events)', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    // 4 off-topic answers (budget is 3 → exceeded), inserted oldest-first.
    const offTopicRows = Array.from({ length: 4 }, () => ({
      sessionId,
      kind: 'learner_question',
      payload: {
        event: { kind: 'learner_question', sessionId, question: 'off-topic' },
        action: { type: 'answer_question', topicClassification: 'off_topic', rationale: 'deflect' },
      },
    }));
    await db.insert(events).values(offTopicRows);
    // 600 benign rows so the off-topic rows are pushed outside the newest-500 window.
    const benign = Array.from({ length: 600 }, (_, i) => ({
      sessionId,
      kind: 'learner_question',
      payload: {
        event: { kind: 'learner_question', sessionId, question: `benign ${i.toString()}` },
        action: { type: 'answer_question', topicClassification: 'on_topic', rationale: 'answer' },
      },
    }));
    // Insert in chunks to keep statements reasonable.
    for (let i = 0; i < benign.length; i += 100) {
      await db.insert(events).values(benign.slice(i, i + 100));
    }

    // A submit turn now reads the learner state: the windowed fold sees ZERO off-topic
    // rows (they aged out), but the uncapped count sees 4 → guardrail dirty.
    const [action] = await driveSequence(sessionId, [
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 5000 },
    ]);
    expect(action!.type).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
      events: { payload: { gateEvaluation?: { passed: boolean; blockers: string[] } } }[];
    };
    const lastGate = replay.events
      .map((e) => e.payload.gateEvaluation)
      .filter((g): g is { passed: boolean; blockers: string[] } => g !== undefined)
      .at(-1);
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

  // ── F-13 Lesson 2 — composition: the lesson-binding READ wiring ───────────────
  // The load-bearing F-13 fix: a `?lesson=2` session must fold against L2 content on
  // EVERY turn, not just the first. The barrier wired `currentLessonId` to read the
  // durable `sessions.lessonProgress`; F-13 persists that binding on `session_start`
  // (the read-wiring; F-15 owns the mid-session advance write). The pre-barrier bug
  // hardcoded lessonId=1 for every non-session_start event, silently folding an L2
  // session against L1 after the first frame.
  describe('F-13 Lesson 2 lesson-binding (?lesson=2 dev seam)', () => {
    const L1_EXPRESSIONS = new Set(['A AND B', 'A OR B', 'NOT A']);
    const L2_EXPRESSIONS = new Set(
      loadLesson(2).content.items.map((i) => i.targetExpression),
    );

    function mountExpression(action: Action): string | undefined {
      if (action.type !== 'mount') return undefined;
      const c = action.component;
      if (c.kind === 'TruthTablePractice') return c.expression;
      if (c.kind === 'CircuitBuilder' || c.kind === 'PseudocodeChallenge') return c.targetExpression;
      return undefined;
    }

    /** Drive frames over a WS URL carrying the given query (so the server's dev
     *  seam sees `?lesson=2`); collect each Action. Mirrors `driveSequence`. */
    async function driveWithQuery(
      query: string,
      frames: Record<string, unknown>[],
    ): Promise<Action[]> {
      const ws = new WebSocket(`${wsUrl}${query}`);
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
        setTimeout(() => reject(new Error('L2 sequence timed out')), 8000);
      });
      ws.close();
      return actions;
    }

    it('binds the session to L2 on session_start and persists lessonProgress (the read-wiring)', async () => {
      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      await driveWithQuery('?lesson=2', [
        { kind: 'session_start', sessionId, lessonId: 2 },
      ]);
      await new Promise((r) => setTimeout(r, 300));
      const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      expect((rows[0]!.lessonProgress as { currentLessonId: number }).currentLessonId).toBe(2);
    });

    it('an L2 submit turn folds against L2 content (NOT L1) — the pre-barrier bug', async () => {
      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      // session_start mounts L2's first item; the submit advances WITHIN L2 — the
      // heuristic picks the next L2 item. If the turn folded against L1 (the bug),
      // the next item would be an L1 expression.
      const actions = await driveWithQuery('?lesson=2', [
        { kind: 'session_start', sessionId, lessonId: 2 },
        { kind: 'submit', sessionId, itemId: '(A AND B) OR (NOT C)', submission: '(A AND B) OR (NOT C)', correct: true },
      ]);
      const submitAction = actions[1];
      expect(submitAction).toBeDefined();
      const expr = mountExpression(submitAction!);
      expect(expr, 'L2 submit must mount an L2 item').toBeDefined();
      expect(L2_EXPRESSIONS.has(expr!), `mounted ${String(expr)} — expected an L2 expression`).toBe(true);
      expect(L1_EXPRESSIONS.has(expr!), `mounted ${String(expr)} — an L1 expression leaked (the fold-against-L1 bug)`).toBe(false);
    });

    it('FAILS CLOSED: without the ?lesson seam a forged session_start.lessonId=2 is clamped to L1', async () => {
      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      // No `?lesson` query on the WS upgrade → the server does NOT honor a client
      // lessonId > 1 (a learner can't skip L1 by forging the frame). The binding
      // stays L1 (no lessonProgress write, currentLessonId defaults to 1).
      await driveWithQuery('', [
        { kind: 'session_start', sessionId, lessonId: 2 },
      ]);
      await new Promise((r) => setTimeout(r, 300));
      const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      const progress = rows[0]!.lessonProgress as { currentLessonId: number } | null;
      // Either no write happened (null) or it bound to 1 — never 2.
      expect(progress?.currentLessonId ?? 1).toBe(1);
    });

    // The durable-write clamp is NOT enough: the lesson the FORGED turn actually
    // folds against (the mounted item / agent reasoning) must be L1 too. The
    // pre-fix bug clamped only `lessonProgress` while turn 1 still loaded
    // `getLesson(event.lessonId=2)` — leaking a gated L2 item for one turn. This
    // asserts the in-turn fold, not just the DB row (mirror of the seam-on
    // 'folds against L2' test, inverted).
    it('FAILS CLOSED: a forged session_start.lessonId=2 with NO seam mounts an L1 item on turn 1 (not L2)', async () => {
      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      const actions = await driveWithQuery('', [
        { kind: 'session_start', sessionId, lessonId: 2 },
      ]);
      const startAction = actions[0];
      expect(startAction).toBeDefined();
      const expr = mountExpression(startAction!);
      expect(expr, 'session_start must mount a practice item').toBeDefined();
      expect(
        L1_EXPRESSIONS.has(expr!),
        `mounted ${String(expr)} — a forged session_start must fold against L1`,
      ).toBe(true);
      expect(
        L2_EXPRESSIONS.has(expr!),
        `mounted ${String(expr)} — gated L2 content leaked on the forged turn-1 fold`,
      ).toBe(false);
    });

    // RECONNECT NO-DOWNGRADE: a session durably advanced to L2 that reconnects
    // sending session_start{lessonId:1} (the web client re-announces its in-memory
    // lessonId, which on a default-URL reload is 1) must keep folding against L2 —
    // the `max` preserves the durable binding AND `lessonIdForEvent` reads that
    // binding, so the turn does not fold against the lower frame value.
    it('does not downgrade a durably-L2 session when a reconnect sends session_start.lessonId=1', async () => {
      const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
        sessionId: string;
      };
      // Durably advance to L2 via the seam, then submit so the reconnect is not a
      // fresh session (the idempotent guard returns no_action on a started one, so
      // we assert the DURABLE binding rather than a remount).
      await driveWithQuery('?lesson=2', [
        { kind: 'session_start', sessionId, lessonId: 2 },
        { kind: 'submit', sessionId, itemId: '(A AND B) OR (NOT C)', submission: '(A AND B) OR (NOT C)', correct: true },
      ]);
      await new Promise((r) => setTimeout(r, 200));
      // Reconnect WITHOUT the seam, re-announcing the default-URL lessonId=1.
      await driveWithQuery('', [{ kind: 'session_start', sessionId, lessonId: 1 }]);
      await new Promise((r) => setTimeout(r, 300));
      const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      const progress = rows[0]!.lessonProgress as { currentLessonId: number } | null;
      expect(progress?.currentLessonId, 'reconnect must not downgrade L2→L1').toBe(2);
    });
  });

  /**
   * F-14 — cross-lesson recall reflex (server-derived, deterministic). Drives the
   * reflex through the `POLYMATH_ENABLE_TEST_SEAMS`-gated synthetic-L1-BKT seam
   * (`?testL1Bkt=…`) because no real L1 `learner_state` exists in an L2 session until
   * F-15. Asserts: (1) a regressed L1 KC mounts a `CrossLessonRecall` on the next
   * turn (AC#1/AC#2); (2) the per-KC throttle suppresses a SECOND recall for the same
   * KC in the same session (AC#4); (3) a DIFFERENT regressed KC still fires (AC#4);
   * (4) the recall is visible in the replay endpoint (AC#5). The throttle is the
   * UNCAPPED count query, so this exercises the monotonic-counter invariant end-to-end.
   */
  it('mounts CrossLessonRecall once per regressed L1 KC and suppresses repeats (F-14 AC#1,2,4,5)', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    // Synthetic L1 BKT: NOT slipped to 0.72 (regressed), AND held at 0.95 (no recall).
    const seamUrl = `${wsUrl}?testL1Bkt=${encodeURIComponent('NOT:0.72,AND:0.95')}`;

    // Drive frames over ONE socket; each turn re-reads the uncapped throttle. The
    // inter-frame delay lets the async events insert land before the next read.
    const driveOn = (url: string, frames: Record<string, unknown>[]): Promise<Action[]> =>
      new Promise<Action[]>((resolve, reject) => {
        const ws = new WebSocket(url);
        const out: Action[] = [];
        let sent = 0;
        ws.on('open', () => ws.send(JSON.stringify(frames[sent++])));
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.kind === 'action') {
            out.push(Action.parse(msg.action));
            if (sent < frames.length) setTimeout(() => ws.send(JSON.stringify(frames[sent++])), 300);
            else {
              ws.close();
              resolve(out);
            }
          }
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('recall sequence timed out')), 10000);
      });

    const firstTwo = await driveOn(seamUrl, [
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true },
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true },
    ]);
    // AC#1/AC#2: the FIRST turn mounts a CrossLessonRecall naming the regressed KC (NOT).
    const recall0 = firstTwo[0];
    expect(recall0?.type).toBe('mount');
    expect(recall0?.type === 'mount' && recall0.component.kind).toBe('CrossLessonRecall');
    if (recall0?.type === 'mount' && recall0.component.kind === 'CrossLessonRecall') {
      expect(recall0.component.kc).toBe('NOT');
      expect(recall0.component.priorBktAtRegression).toBeCloseTo(0.72, 5);
      expect(recall0.component.reminderBody).toContain('NOT');
    }
    // AC#4: the SECOND turn does NOT re-mount the recall for NOT (per-KC throttle).
    const recall1 = firstTwo[1];
    expect(recall1?.type === 'mount' && recall1.component.kind === 'CrossLessonRecall').toBe(false);

    // A DIFFERENT KC slips (OR → 0.70) on a later turn → fires for OR (AC#4).
    const orSeam = `${wsUrl}?testL1Bkt=${encodeURIComponent('NOT:0.72,OR:0.70')}`;
    const [orTurn] = await driveOn(orSeam, [
      { kind: 'submit', sessionId, itemId: 'l1-or', submission: 'A OR B', correct: true },
    ]);
    expect(orTurn?.type).toBe('mount');
    expect(
      orTurn?.type === 'mount' && orTurn.component.kind === 'CrossLessonRecall' && orTurn.component.kc,
    ).toBe('OR');

    // AC#5: the recall is visible in the replay endpoint (the demo's cross-lesson value).
    await new Promise((r) => setTimeout(r, 300));
    const replay = (await (await fetch(`${baseUrl}/api/session/${sessionId}/replay`)).json()) as {
      events: { payload: { action?: { type: string; component?: { kind: string; kc?: string } } } }[];
    };
    const recallKcs = replay.events
      .map((e) => e.payload.action)
      .filter(
        (a): a is { type: string; component: { kind: string; kc?: string } } =>
          a?.type === 'mount' && a.component?.kind === 'CrossLessonRecall',
      )
      .map((a) => a.component.kc);
    // Exactly one NOT recall (throttled) and one OR recall.
    expect(recallKcs.filter((kc) => kc === 'NOT').length).toBe(1);
    expect(recallKcs.filter((kc) => kc === 'OR').length).toBe(1);
  });

  /**
   * F-14 no-false-positive guard: on a plain L1 session with no synthetic map and no
   * real prior-lesson `learner_state`, the recall reflex never fires — a benign submit
   * returns the normal tactical mount, never a CrossLessonRecall (the production-path
   * default: no trigger until F-15 preserves L1 state in-session).
   */
  it('does NOT fire recall on a plain L1 submit with no synthetic map (F-14 no false-positive)', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    const [action] = await driveSequence(sessionId, [
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true },
    ]);
    expect(action?.type === 'mount' && action.component.kind === 'CrossLessonRecall').toBe(false);
  });

  /**
   * F-14 finding #4 — the recall reflex must NOT swallow a learner's question. Even
   * with a regressed L1 KC in the seam (so a recall WOULD fire on a routine submit),
   * a `learner_question` turn returns the agent's `answer_question` UNTOUCHED — recall
   * is an allow-list reflex (it only supersedes a routine practice/intro mount or a
   * no_action), never an `answer_question`. Otherwise the learner asks a question and
   * gets a recall card instead, their answer discarded.
   */
  it('does NOT supersede an answer_question with a recall, even when an L1 KC is regressed (F-14 finding #4)', async () => {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    // NOT regressed to 0.72 in the seam — a routine submit on this session WOULD mount
    // a recall. But the learner asks a question, so the answer must pass through.
    const seamUrl = `${wsUrl}?testL1Bkt=${encodeURIComponent('NOT:0.72')}`;
    const driveOneOn = (url: string, frame: Record<string, unknown>): Promise<Action> =>
      new Promise<Action>((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.on('open', () => ws.send(JSON.stringify(frame)));
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.kind === 'action') {
            ws.close();
            resolve(Action.parse(msg.action));
          }
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('question turn timed out')), 10000);
      });

    const action = await driveOneOn(seamUrl, {
      kind: 'learner_question',
      sessionId,
      question: 'what does an AND gate output?',
    });
    // The learner's question is answered — NOT replaced by a recall card.
    expect(action.type).toBe('answer_question');
    expect(action.type === 'mount' && action.component.kind === 'CrossLessonRecall').toBe(false);
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
    // F-11/F-12 SERIAL JOIN (Option A — same-turn celebration): the rule gate +
    // transfer + a real passing-judge explain-back all clear on THIS turn, so the full
    // mastery gate clears and the server mints the MasteryCelebration SAME TURN (the
    // old behavior — F-11 stopping at `no_action`, deferring the transition a turn — is
    // exactly what Option A replaces). The persisted PASS verdict + derived-state
    // assertions below remain the load-bearing reachability checks.
    expect(verdictAction!.type).toBe('mount');
    if (verdictAction!.type === 'mount') {
      expect(verdictAction!.component.kind).toBe('MasteryCelebration');
    }

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

/**
 * CLUSTER C — the concurrency attempt-cap race. Several `explain_back_recording_ended`
 * frames for the SAME session+item, fired concurrently, must not each read the same
 * pre-insert `priorAttempts` and all invoke the paid judge past MAX_ATTEMPTS (=2). The
 * server serializes per session+item; with N concurrent frames whose preconditions all
 * pass (a server transcript clears them), the judge must run AT MOST MAX_ATTEMPTS times.
 */
describe.skipIf(!canRunPg)('CLUSTER C — explain-back attempt-cap under concurrency', () => {
  let cdb: Db;
  let cpool: { end: () => Promise<void> };
  let cserver: PolymathServer;
  let cBaseUrl: string;
  let cWsUrl: string;
  let judgeCalls = 0;

  const countingJudge: ExplainBackJudge = {
    judge: () => {
      judgeCalls++;
      return Promise.resolve({ passed: false, subScores: { overall: false } });
    },
  };
  const passingTranscript =
    'For this AND gate the output is true only when both A and B are true across every row of the truth table here.';

  beforeAll(async () => {
    const POSTGRES_URL = await ensureTestPg();
    await runMigrations(POSTGRES_URL);
    ({ db: cdb, pool: cpool } = createDb(POSTGRES_URL));
    cserver = createServer({
      db: cdb,
      agent: new StubAgentClient(),
      explainBackJudge: countingJudge,
      explainBackTranscriptFor: () => passingTranscript,
    });
    await new Promise<void>((resolve) => cserver.httpServer.listen(0, resolve));
    const { port } = cserver.httpServer.address() as AddressInfo;
    cBaseUrl = `http://localhost:${port}`;
    cWsUrl = `ws://localhost:${port}/agent`;
  }, 60000);

  afterAll(async () => {
    await cserver.close();
    await cpool.end().catch(() => {});
  });

  async function drive(sessionId: string, frames: Record<string, unknown>[]): Promise<Action[]> {
    const ws = new WebSocket(cWsUrl);
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

  it('fires concurrent frames for the same item: judge runs at most MAX_ATTEMPTS times', async () => {
    const { sessionId } = (await (await fetch(`${cBaseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    // Get to a transfer-pass so an ExplainBackPrompt is mounted.
    const actions = await drive(sessionId, [
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 5000 },
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 6000 },
      { kind: 'submit', sessionId, itemId: 'l1-and', submission: 'A AND B', correct: true, responseTimeMs: 4000 },
    ]);
    const probe = actions.find((a) => a.type === 'mount' && a.component.kind === 'TransferProbe');
    const probedItemId = probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.itemId : '';
    const probedExpr = probe?.type === 'mount' && probe.component.kind === 'TransferProbe' ? probe.component.expression : '';
    await drive(sessionId, [{ kind: 'transfer_submitted', sessionId, itemId: probedItemId, submission: probedExpr }]);

    judgeCalls = 0;

    // Fire 5 explain-back frames CONCURRENTLY over separate sockets, each on its own
    // connection so the server handles them in parallel. The preconditions all pass
    // (server transcript clears them), so without serialization each would invoke the
    // judge. With the per-(session,item) lock, the judge runs at most MAX_ATTEMPTS (2).
    const frame = {
      kind: 'explain_back_recording_ended',
      sessionId,
      targetItemId: probedItemId,
      transcript: '',
      durationMs: 9000,
    };
    const fireOnce = (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(cWsUrl);
        ws.on('open', () => ws.send(JSON.stringify(frame)));
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.kind === 'action') {
            ws.close();
            resolve();
          }
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('concurrent frame timed out')), 8000);
      });
    await Promise.all([fireOnce(), fireOnce(), fireOnce(), fireOnce(), fireOnce()]);

    await new Promise((r) => setTimeout(r, 300));
    // The paid judge must not have run more than MAX_ATTEMPTS times despite 5 frames.
    expect(judgeCalls).toBeLessThanOrEqual(2);
    // And exactly one row carries the attempt-cap short-circuit verdict (no judge).
    const replay = (await (await fetch(`${cBaseUrl}/api/session/${sessionId}/replay`)).json()) as {
      events: { kind: string; payload: { explainBackVerdict?: { reasons: string[] } } }[];
    };
    const ebRows = replay.events.filter((e) => e.kind === 'explain_back_recording_ended');
    expect(ebRows.length).toBe(5);
    const capped = ebRows.filter((r) => r.payload.explainBackVerdict?.reasons.includes('attempt_cap_reached'));
    expect(capped.length).toBeGreaterThanOrEqual(3); // frames 3,4,5 short-circuit
  });
});
