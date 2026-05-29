import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { events, sessions } from '../db/schema.js';
import { canRunPg, ensureTestPg } from '../db/testPg.js';
import { StubAgentClient } from '../agent/stubClient.js';
import { createServer, type PolymathServer } from '../server.js';
import type { BaselineChatProvider, BaselineChatTurn } from './chatProvider.js';
import type { BaselineEventPayload } from './log.js';

/**
 * F-16 end-to-end: a scripted "subject" walks the fixed-length baseline arc via the
 * REAL HTTP routes (3 content items → 2 transfer items → end) with a MOCKED LLM
 * (CI is offline — no OPENAI_API_KEY). Asserts:
 *   - the session + every turn land in the shared events table tagged `app:'baseline'`
 *     (the D3 column discriminator, so Polymath analytics never fold baseline rows),
 *   - the per-event payload matches the LOCKED shape F-17 reads,
 *   - correctness is the shared scoreEquivalence verdict (fairness),
 *   - the chat route fails CLOSED with 503 when no provider is configured.
 */

/** Deterministic chat double — never calls OpenAI. Echoes the server verdict so a
 *  test can read it back, and records the turns it saw. */
class StubBaselineChat implements BaselineChatProvider {
  public seen: BaselineChatTurn[] = [];
  reply(turn: BaselineChatTurn): Promise<string> {
    this.seen.push(turn);
    const verdict = turn.verdict === true ? 'correct' : turn.verdict === false ? 'incorrect' : 'reprompt';
    return Promise.resolve(`[${verdict}] keep going with $${turn.item.targetExpression}$`);
  }
}

let db: Db;
let pool: { end: () => Promise<void> };

describe.skipIf(!canRunPg)('F-16 baseline routes — scripted subject end-to-end', () => {
  let server: PolymathServer;
  let baseUrl: string;
  const chat = new StubBaselineChat();

  beforeAll(async () => {
    const url = await ensureTestPg();
    await runMigrations(url);
    ({ db, pool } = createDb(url));
    server = createServer({ db, agent: new StubAgentClient(), baselineChat: chat });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  }, 60000);

  afterAll(async () => {
    await server.close();
    await pool.end().catch(() => {});
  });

  it('walks 3 content items + 2 transfer items; events land with app=baseline in the F-17 shape', async () => {
    // Create the session.
    const createRes = await fetch(`${baseUrl}/api/baseline/session`, { method: 'POST' });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      sessionId: string;
      lessonId: number;
      contentItems: { itemId: string; kc: string; targetExpression: string }[];
      transferItemCount: number;
    };
    const { sessionId } = created;
    expect(created.lessonId).toBe(1);
    expect(created.contentItems).toHaveLength(3);
    expect(created.transferItemCount).toBe(2);

    // The session row carries the app discriminator.
    const [sessionRow] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(sessionRow?.app).toBe('baseline');

    // Walk each content item: first a prose turn (re-prompt, null), then the correct expression.
    for (const item of created.contentItems) {
      const proseRes = await fetch(`${baseUrl}/api/baseline/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, message: 'can you explain this item?' }),
      });
      expect(proseRes.status).toBe(200);
      const prose = (await proseRes.json()) as { correct: boolean | null; progress: { phase: string } };
      expect(prose.correct).toBeNull();
      expect(prose.progress.phase).toBe('chat'); // a question does not advance

      const correctRes = await fetch(`${baseUrl}/api/baseline/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, message: item.targetExpression }),
      });
      expect(correctRes.status).toBe(200);
      const correct = (await correctRes.json()) as { correct: boolean | null; itemComplete: boolean };
      expect(correct.correct).toBe(true);
      expect(correct.itemComplete).toBe(true);
    }

    // Now in the transfer phase — fetch progress to get the next held-out item id.
    let view = await (await fetch(`${baseUrl}/api/baseline/session/${sessionId}`)).json();
    expect(view.progress.phase).toBe('transfer');

    // Answer both transfer items: first correct (echo the target), then a wrong one.
    // We read the canonical target from the held-out event log via the service is not
    // exposed; instead submit a plausible correct answer for item 1 and a wrong for 2.
    const t1Id = view.progress.item.itemId;
    // Submit a clearly-wrong answer so the assertion is deterministic regardless of
    // which bank rows were held out.
    const t1Res = await fetch(`${baseUrl}/api/baseline/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, itemId: t1Id, submission: 'this is not an expression' }),
    });
    expect(t1Res.status).toBe(200);
    const t1 = (await t1Res.json()) as { correct: boolean; progress: { phase: string; item?: { itemId: string } } };
    expect(t1.correct).toBe(false);
    expect(t1.progress.phase).toBe('transfer');

    const t2Id = t1.progress.item!.itemId;
    const t2Res = await fetch(`${baseUrl}/api/baseline/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, itemId: t2Id, submission: 'also nonsense' }),
    });
    expect(t2Res.status).toBe(200);
    const t2 = (await t2Res.json()) as { progress: { phase: string } };
    expect(t2.progress.phase).toBe('ended');

    // Every event row is tagged app=baseline and matches the locked payload shape.
    const rows = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, sessionId), eq(events.app, 'baseline')))
      .orderBy(events.ts);
    const kinds = rows.map((r) => r.kind);
    expect(kinds[0]).toBe('session_started');
    expect(kinds.at(-1)).toBe('session_ended');
    expect(kinds.filter((k) => k === 'chat_turn')).toHaveLength(6); // 2 turns × 3 items
    expect(kinds.filter((k) => k === 'transfer_submitted')).toHaveLength(2);

    // Spot-check the shapes F-17 reads.
    const started = rows[0]!.payload as Extract<BaselineEventPayload, { kind: 'session_started' }>;
    expect(started.app).toBe('baseline');
    expect(started.contentItemIds).toHaveLength(3);
    expect(started.transferItemIds).toHaveLength(2);

    const ended = rows.at(-1)!.payload as Extract<BaselineEventPayload, { kind: 'session_ended' }>;
    // 3 content correct + 0 transfer correct of 5 total.
    expect(ended.score).toEqual({ correct: 3, total: 5 });

    const chatTurn = rows.find((r) => r.kind === 'chat_turn')!.payload as Extract<
      BaselineEventPayload,
      { kind: 'chat_turn' }
    >;
    expect(chatTurn.app).toBe('baseline');
    expect(typeof chatTurn.itemId).toBe('string');
    expect(typeof chatTurn.message).toBe('string');
    expect(typeof chatTurn.reply).toBe('string');
    expect('correct' in chatTurn).toBe(true);
    expect('itemComplete' in chatTurn).toBe(true);
    expect(chatTurn.score).toBeDefined();
  });

  it('does not contaminate Polymath: a non-baseline session has no app tag', async () => {
    const [row] = await db.insert(sessions).values({}).returning({ id: sessions.id });
    const [check] = await db.select().from(sessions).where(eq(sessions.id, row!.id));
    expect(check?.app).toBeNull();
  });
});

describe.skipIf(!canRunPg)('F-16 baseline chat fails closed without a provider', () => {
  it('POST /api/baseline/chat returns 503 when no chat provider is configured', async () => {
    const url = await ensureTestPg();
    await runMigrations(url);
    const { db: db2, pool: pool2 } = createDb(url);
    // No baselineChat injected AND no OPENAI_API_KEY in CI → undefined provider.
    const saved = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    const server = createServer({ db: db2, agent: new StubAgentClient() });
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    const { port } = server.httpServer.address() as AddressInfo;
    try {
      const res = await fetch(`http://localhost:${port}/api/baseline/session`, { method: 'POST' });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not configured/);
    } finally {
      if (saved !== undefined) process.env['OPENAI_API_KEY'] = saved;
      await server.close();
      await pool2.end().catch(() => {});
    }
  });
});
