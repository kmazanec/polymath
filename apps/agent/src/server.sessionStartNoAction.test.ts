import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Action } from '@polymath/contract';
import { createDb, type Db } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { canRunPg, ensureTestPg } from './db/testPg.js';
import type { AgentClient, AgentInput } from './agent/client.js';
import { createServer, type PolymathServer } from './server.js';

/**
 * REGRESSION (idle intro replaced by a fabricated practice item): the learner
 * loads a lesson, the WEB CLIENT already shows the intro card, and then the AGENT
 * — with NO learner action — mounts a TruthTablePractice on top of it. Observed
 * live: production runs the LLM provider (OPENAI_API_KEY set), `session_start`
 * (a connection handshake, NOT user input) was routed straight to the LLM, which
 * freely mounted a practice item ~3s after connect.
 *
 * Invariant under test (the server TRUST BOUNDARY, provider-independent — the
 * server never trusts the agent): a bare `session_start` (no learner-chosen
 * `startRep`) must produce `no_action`. The agent does nothing until the learner
 * takes a real action. This must hold even against an ADVERSARIAL provider that
 * always tries to mount a practice item — so it cannot be satisfied by the
 * heuristic provider's politeness alone (that is exactly the test-vs-prod gap
 * that let this ship: every suite ran the heuristic StubAgentClient, production
 * ran the LLM).
 *
 * The one carve-out: a `session_start` carrying `startRep` is a DELIBERATE learner
 * choice ("Start in code/circuit" / `?rep=`), so it still deterministically mounts
 * the first item — and that path never touches the (adversarial) provider.
 */

/** An agent that ALWAYS tries to mount a practice item — the worst case for the
 *  "do nothing on session_start" guard. If the guard works, the server never even
 *  asks this agent on a bare session_start; if it does ask, the test fails loud. */
class AlwaysMountAgent implements AgentClient {
  propose(_input: AgentInput): Promise<Action> {
    return Promise.resolve({
      type: 'mount',
      component: {
        kind: 'TruthTablePractice',
        expression: 'A AND B',
        // MSB-first (A = most significant): rows 00,01,10,11 → AND = 0,0,0,1.
        // A VALID claimedTruthTable so the mount survives Zod + Layer-2 recompute —
        // otherwise the test would pass for the wrong reason (a malformed-action
        // downgrade), not because session_start was guarded.
        claimedTruthTable: [0, 0, 0, 1],
        visibleReps: ['truth_table'],
        prompt: 'adversarial: fabricated practice item',
      },
      rationale: 'adversarial agent — always mounts',
    } as Action);
  }
}

let db: Db;
let pool: { end: () => Promise<void> };
let server: PolymathServer;
let baseUrl: string;
let wsUrl: string;

describe.skipIf(!canRunPg)('session_start never lets the agent act without learner input', () => {
  beforeAll(async () => {
    const POSTGRES_URL = await ensureTestPg();
    await runMigrations(POSTGRES_URL);
    ({ db, pool } = createDb(POSTGRES_URL));
    server = createServer({ db, agent: new AlwaysMountAgent() });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
    wsUrl = `ws://localhost:${port}/agent`;
  }, 60000);

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  /** Send one frame, collect the first server `action` (or null after a quiet window). */
  async function firstActionFor(frame: Record<string, unknown>): Promise<Action | null> {
    const { sessionId } = (await (await fetch(`${baseUrl}/api/session`, { method: 'POST' })).json()) as {
      sessionId: string;
    };
    return await new Promise<Action | null>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let settled = false;
      const finish = (a: Action | null): void => {
        if (settled) return;
        settled = true;
        ws.close();
        resolve(a);
      };
      ws.on('open', () => ws.send(JSON.stringify({ ...frame, sessionId })));
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.kind === 'action') finish(Action.parse(msg.action));
      });
      ws.on('error', reject);
      // No action within the window → treat as "agent stayed silent".
      setTimeout(() => finish(null), 4000);
    });
  }

  it('a bare session_start yields no_action (agent must not act on a handshake)', async () => {
    const action = await firstActionFor({ kind: 'session_start', lessonId: 1 });
    // The server must NOT have mounted anything. Either it sent an explicit
    // no_action, or it sent nothing at all — never a mount.
    if (action !== null) {
      expect(action.type).toBe('no_action');
    }
    // Belt-and-suspenders: it is definitely not a fabricated practice mount.
    expect(action?.type === 'mount').toBe(false);
  });

  it('a session_start WITH startRep still deterministically mounts the first item (deliberate skip-to-rep)', async () => {
    const action = await firstActionFor({ kind: 'session_start', lessonId: 1, startRep: 'circuit' });
    expect(action?.type).toBe('mount');
    // It is the DETERMINISTIC authored first item (circuit), not the adversarial
    // provider's truth-table mount — proving the carve-out bypasses the provider.
    if (action?.type === 'mount') {
      expect(action.component.kind).toBe('CircuitBuilder');
    }
  });
});
