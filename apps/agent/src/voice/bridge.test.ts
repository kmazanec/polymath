/**
 * VoiceBridge behavior, driven by the in-memory MockRealtimeSession.
 *
 * Happy path + persistence assertions run against a real Postgres (skip cleanly
 * with no DB). The barge-in path is a pure unit test: it drives the bridge with a
 * stub db whose insert is a no-op, so the interrupt/no-further-frames behavior is
 * verified even without a database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { events, sessions } from '../db/schema.js';
import { canRunPg, ensureTestPg } from '../db/testPg.js';
import {
  MockRealtimeSession,
  resetCacheRegistry,
  type RealtimeSessionConfig,
} from './realtimeClient.js';
import { VoiceBridge, type VoiceBridgeOpts } from './bridge.js';
import { VoiceTurnPayload } from './voiceTurn.js';

const CONFIG: RealtimeSessionConfig = {
  systemPrompt: 'persona...',
  cacheKey: 'lesson:3|phase:practicing',
  model: 'gpt-realtime',
};

function bridgeOpts(
  session: MockRealtimeSession,
  db: Db,
  sessionId: string,
  overrides: Partial<VoiceBridgeOpts> = {},
): VoiceBridgeOpts {
  return {
    session,
    db,
    sessionId,
    learnerId: 'learner-7',
    lessonId: 3,
    lessonTitle: 'AND, OR, NOT',
    phase: 'practicing',
    modelVersion: 'gpt-realtime',
    publishAudio: vi.fn(),
    ...overrides,
  };
}

describe('VoiceBridge — barge-in (no DB needed)', () => {
  beforeEach(() => resetCacheRegistry());

  it('interrupts a responding tutor and stops further frames; marks bargeIn', async () => {
    // A db stub whose insert is a no-op (returns a fake row id) so we can exercise
    // the interrupt path without a database.
    const insertedPayloads: unknown[] = [];
    const stubDb = {
      insert: () => ({
        values: (v: { payload: unknown }) => {
          insertedPayloads.push(v.payload);
          return { returning: async () => [{ id: 'fake-row-id' }] };
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    } as unknown as Db;

    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'Keep going.', audioFrames: 3 },
    });
    const publishAudio = vi.fn<(f: Uint8Array) => void>();
    const bridge = new VoiceBridge(
      bridgeOpts(session, stubDb, 'sess-1', { publishAudio }),
    );
    await bridge.start();

    session.pushLearnerUtterance('Tell me about AND.');
    // tick() once: emits the learner final transcript; tutor is now "responding".
    session.tick();
    expect(session.isResponding()).toBe(true);

    const interruptSpy = vi.spyOn(session, 'interrupt');
    bridge.onLearnerAudioActivity();

    expect(interruptSpy).toHaveBeenCalledTimes(1);
    expect(session.isResponding()).toBe(false);

    // No tutor frames should reach the room: interrupt dropped the unemitted queue.
    const framesBefore = publishAudio.mock.calls.length;
    session.flush();
    expect(publishAudio.mock.calls.length).toBe(framesBefore);
    expect(publishAudio).not.toHaveBeenCalled();
  });
});

describe.skipIf(!canRunPg)('VoiceBridge — persistence (DB-backed)', () => {
  let db: Db;
  let pool: pg.Pool;
  let sessionId: string;

  beforeAll(async () => {
    const connectionString = await ensureTestPg();
    await runMigrations(connectionString);
    const client = createDb(connectionString);
    db = client.db;
    pool = client.pool;
    const [session] = await db.insert(sessions).values({}).returning({ id: sessions.id });
    sessionId = session!.id;
  }, 60000);

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(() => resetCacheRegistry());

  async function voiceTurnRows(sid: string) {
    const rows = await db.select().from(events).where(eq(events.sessionId, sid));
    return rows.filter((r) => r.kind === 'voice_turn');
  }

  it('happy path: publishes tutor audio and persists a voice_turn with correct attrs', async () => {
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'What happens when both are true?', audioFrames: 2 },
      cacheHit: false,
    });
    const publishAudio = vi.fn<(f: Uint8Array) => void>();
    const bridge = new VoiceBridge(
      bridgeOpts(session, db, sessionId, { publishAudio }),
    );
    await bridge.start();

    session.pushLearnerUtterance('When is A AND B true?');
    session.flush();
    // Let the async completeTurn persistence settle.
    await vi.waitFor(async () => {
      expect((await voiceTurnRows(sessionId)).length).toBeGreaterThan(0);
    });

    // Tutor audio was forwarded to the room (2 frames).
    expect(publishAudio).toHaveBeenCalledTimes(2);

    const rows = await voiceTurnRows(sessionId);
    expect(rows).toHaveLength(1);
    const payload = VoiceTurnPayload.parse(rows[0]!.payload);
    expect(payload.transcript.learner).toBe('When is A AND B true?');
    expect(payload.transcript.tutor).toBe('What happens when both are true?');
    expect(payload.modelVersion).toBe('gpt-realtime');
    expect(payload.cacheHit).toBe(false);
    expect(payload.bargeIn).toBe(false);
    expect(payload.transcriptLogId).toBe(rows[0]!.id);
    // ttft = first tutor transcript at (2) - learner final at (1) = 1 (mock clock).
    expect(payload.ttftMs).toBe(1);
  });

  it('barge-in: persisted turn records bargeIn:true and no further tutor frames', async () => {
    const [s] = await db.insert(sessions).values({}).returning({ id: sessions.id });
    const sid = s!.id;

    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'Consider the rows.', audioFrames: 3 },
      cacheHit: false,
    });
    const publishAudio = vi.fn<(f: Uint8Array) => void>();
    const bridge = new VoiceBridge(
      bridgeOpts(session, db, sid, { publishAudio }),
    );
    await bridge.start();

    session.pushLearnerUtterance('Explain OR.');
    // tick() emits the learner final transcript; tutor is now responding.
    session.tick();
    expect(session.isResponding()).toBe(true);

    bridge.onLearnerAudioActivity();
    expect(session.isResponding()).toBe(false);

    // Drain anything left (interrupt cleared the queue, so nothing emits).
    session.flush();
    expect(publishAudio).not.toHaveBeenCalled();

    // The interrupt finalized the barged-in turn; it persists with bargeIn:true.
    await vi.waitFor(async () => {
      const rows = await db.select().from(events).where(eq(events.sessionId, sid));
      expect(rows.filter((r) => r.kind === 'voice_turn').length).toBe(1);
    });
    const rows = await db.select().from(events).where(eq(events.sessionId, sid));
    const turn = rows.find((r) => r.kind === 'voice_turn')!;
    const payload = VoiceTurnPayload.parse(turn.payload);
    expect(payload.bargeIn).toBe(true);
    expect(payload.transcript.learner).toBe('Explain OR.');
  });

  it('stop() closes the session and is idempotent', async () => {
    const session = new MockRealtimeSession(CONFIG);
    const closeSpy = vi.spyOn(session, 'close');
    const bridge = new VoiceBridge(bridgeOpts(session, db, sessionId));
    await bridge.start();

    await bridge.stop();
    await bridge.stop();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
