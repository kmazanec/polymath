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
import { voiceCacheKey, VOICE_PERSONA } from './persona.js';

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

describe('VoiceBridge — persona config wired into session.connect (no DB needed)', () => {
  beforeEach(() => resetCacheRegistry());

  it('bridge.start() calls session.connect with a config whose cacheKey matches voiceCacheKey and systemPrompt starts with VOICE_PERSONA', async () => {
    const stubDb = {
      insert: () => ({
        values: (v: { payload: unknown }) => ({
          returning: async () => [{ id: 'fake-row' }],
        }),
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    } as unknown as Db;

    const session = new MockRealtimeSession(CONFIG);
    const connectSpy = vi.spyOn(session, 'connect');

    const bridge = new VoiceBridge(
      bridgeOpts(session, stubDb, 'sess-persona'),
    );
    await bridge.start();

    // connect must have been called with a config argument (not no-arg / constructor default).
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(session.connectedWith).toBeDefined();

    const connectedConfig = session.connectedWith!;

    // cacheKey must match what voiceCacheKey produces for the bridge's lesson opts.
    const expectedKey = voiceCacheKey({
      lessonId: 3,        // matches bridgeOpts default
      lessonTitle: 'AND, OR, NOT',
      phase: 'practicing',
    });
    expect(connectedConfig.cacheKey).toBe(expectedKey);

    // systemPrompt must begin with the stable VOICE_PERSONA prefix — this is the
    // byte-identical prefix that provider prompt caches key on.
    expect(connectedConfig.systemPrompt).toContain(VOICE_PERSONA);
    expect(connectedConfig.systemPrompt.startsWith(VOICE_PERSONA)).toBe(true);
  });

  it('getSession() returns the same RealtimeSession the bridge wraps (so the explain-back capture can subscribe to the one conversation stream)', () => {
    const stubDb = { insert: () => ({ values: () => Promise.resolve() }) } as unknown as Db;
    const session = new MockRealtimeSession();
    const bridge = new VoiceBridge(bridgeOpts(session, stubDb, 'sess-getter'));
    expect(bridge.getSession()).toBe(session);
  });
});

describe('VoiceBridge — barge-in (no DB needed)', () => {
  beforeEach(() => resetCacheRegistry());

  it('a late final tutor transcript after barge-in does NOT create a phantom second turn', async () => {
    // After a barge-in, completeTurn() resets the accumulator to a fresh empty turn.
    // A late `{role:'tutor', final:true}` transcript that races the interrupt must
    // NOT trigger a second completeTurn() (the new accumulator has no content).
    // We need to deliver a tutor transcript after interrupt() has cleared the mock's
    // queue; the mock's queue is empty at that point and tick/flush won't emit it.
    // So we capture the bridge's onTranscript callback via a passthrough wrapper and
    // fire it directly — the same signal the bridge would receive from a real provider.
    const insertedPayloads: unknown[] = [];
    const stubDb = {
      insert: () => ({
        values: (v: { payload: unknown }) => {
          insertedPayloads.push(v.payload);
          // Return a resolved promise (not returning is fine; we don't need the id).
          return { returning: async () => [{ id: `fake-row-${insertedPayloads.length}` }] };
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    } as unknown as Db;

    // A passthrough wrapper that lets us inject transcripts directly after the bridge
    // has subscribed. This is the cleanest seam available: the mock's interrupt()
    // clears the queue, so we cannot deliver the late tutor segment via tick/flush.
    let capturedTranscriptCb: ((t: import('./realtimeClient.js').VoiceTranscript) => void) | undefined;
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'Consider the rows.', audioFrames: 3 },
    });
    const origOnTranscript = session.onTranscript.bind(session);
    vi.spyOn(session, 'onTranscript').mockImplementation((cb) => {
      capturedTranscriptCb = cb;
      origOnTranscript(cb);
    });

    const bridge = new VoiceBridge(
      bridgeOpts(session, stubDb, 'sess-phantom'),
    );
    await bridge.start();

    // Drive to a barge-in: learner utterance -> tick() so tutor starts -> barge-in.
    session.pushLearnerUtterance('Explain OR.');
    session.tick(); // emits learner final transcript; tutor queue starts
    expect(session.isResponding()).toBe(true);

    bridge.onLearnerAudioActivity(); // triggers interrupt + completeTurn for the barged-in turn
    expect(session.isResponding()).toBe(false);

    // Let the async completeTurn persist (it's a stub so it resolves instantly).
    await Promise.resolve();
    await Promise.resolve();

    const insertsAfterBargeIn = insertedPayloads.length;
    expect(insertsAfterBargeIn).toBe(1); // exactly the barged-in turn

    // Now deliver the late final tutor transcript that races the interrupt — as if the
    // provider's WebSocket drained this segment slightly after interrupt() fired.
    expect(capturedTranscriptCb).toBeDefined();
    capturedTranscriptCb!({
      role: 'tutor',
      text: 'Consider the rows.',
      at: 99,
      final: true,
    });

    // Allow any queued microtasks to settle.
    await Promise.resolve();
    await Promise.resolve();

    // The late tutor transcript must NOT have triggered a second completeTurn():
    // the fresh accumulator had no learner content (turnHasContent() is false),
    // so no phantom second row should appear.
    expect(insertedPayloads.length).toBe(1);

    // The one stored turn must be the barged-in one.
    const storedPayload = insertedPayloads[0] as { bargeIn: boolean; transcript: { learner?: string } };
    expect(storedPayload.bargeIn).toBe(true);
    expect(storedPayload.transcript.learner).toBe('Explain OR.');
  });

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

// ── F-30: onLearnerUtterance callback (fill-the-seam guard) ──────────────────
// These tests verify the half of F-30 CLAUDE.md warns about:
//   "a fail-closed input nothing fills is a gate nobody can pass"
// The VoiceBridge must fire onLearnerUtterance on a FINALIZED learner transcript
// segment (not interim ASR partials) and MUST NOT fire it on tutor chunks. Absent the
// callback, it silently no-ops. (Final-only gating added in MR !11 review — firing on
// partials let a client answer an incomplete question via an early spoken_turn.)
describe('VoiceBridge — F-30 onLearnerUtterance callback (no DB needed)', () => {
  beforeEach(() => resetCacheRegistry());

  it('fires onLearnerUtterance with the learner text on a learner transcript chunk', async () => {
    const received: string[] = [];
    const stubDb = {
      insert: () => ({ values: () => ({ returning: async () => [{ id: 'id' }] }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    } as unknown as Db;

    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'Good.', audioFrames: 0 },
    });
    const onLearnerUtterance = vi.fn((text: string) => received.push(text));
    const bridge = new VoiceBridge(
      bridgeOpts(session, stubDb, 'sess-f30-learner', { onLearnerUtterance }),
    );
    await bridge.start();

    session.pushLearnerUtterance('what is NAND?');
    session.flush();

    expect(received).toContain('what is NAND?');
    expect(onLearnerUtterance).toHaveBeenCalled();
  });

  it('does NOT fire onLearnerUtterance on a non-final (interim ASR partial) learner chunk; fires on final', async () => {
    // MR !11 regression: firing on every chunk let a client send spoken_turn while the
    // ASR was still streaming and have the server answer an incomplete question.
    const received: string[] = [];
    const stubDb = {
      insert: () => ({ values: () => ({ returning: async () => [{ id: 'id' }] }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    } as unknown as Db;

    const session = new MockRealtimeSession(CONFIG, { reply: { tutorText: 'ok.', audioFrames: 0 } });
    let cb: ((t: import('./realtimeClient.js').VoiceTranscript) => void) | undefined;
    const orig = session.onTranscript.bind(session);
    vi.spyOn(session, 'onTranscript').mockImplementation((c) => {
      cb = c;
      orig(c);
    });
    const onLearnerUtterance = vi.fn((text: string) => received.push(text));
    const bridge = new VoiceBridge(
      bridgeOpts(session, stubDb, 'sess-f30-partial', { onLearnerUtterance }),
    );
    await bridge.start();

    // Interim partial — must NOT fire the seam.
    cb!({ role: 'learner', text: 'what is', at: 1, final: false });
    expect(onLearnerUtterance).not.toHaveBeenCalled();

    // Finalized segment — fires once, with the complete text.
    cb!({ role: 'learner', text: 'what is NAND?', at: 2, final: true });
    expect(received).toEqual(['what is NAND?']);
    expect(onLearnerUtterance).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onLearnerUtterance for tutor transcript chunks', async () => {
    const received: string[] = [];
    const stubDb = {
      insert: () => ({ values: () => ({ returning: async () => [{ id: 'id' }] }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    } as unknown as Db;

    // A session that ONLY emits a tutor transcript (no learner utterance).
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'Tutor only.', audioFrames: 0 },
    });
    let capturedTranscriptCb: ((t: import('./realtimeClient.js').VoiceTranscript) => void) | undefined;
    const origOnTranscript = session.onTranscript.bind(session);
    vi.spyOn(session, 'onTranscript').mockImplementation((cb) => {
      capturedTranscriptCb = cb;
      origOnTranscript(cb);
    });

    const onLearnerUtterance = vi.fn((text: string) => received.push(text));
    const bridge = new VoiceBridge(
      bridgeOpts(session, stubDb, 'sess-f30-tutor', { onLearnerUtterance }),
    );
    await bridge.start();

    // Fire a tutor-role transcript directly.
    capturedTranscriptCb!({ role: 'tutor', text: 'Tutor reply.', at: 1, final: true });

    expect(received).toHaveLength(0);
    expect(onLearnerUtterance).not.toHaveBeenCalled();
  });

  it('absent onLearnerUtterance callback — no-ops silently, no crash', async () => {
    const stubDb = {
      insert: () => ({ values: () => ({ returning: async () => [{ id: 'id' }] }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    } as unknown as Db;

    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'ok.', audioFrames: 0 },
    });
    // NO onLearnerUtterance injected
    const bridge = new VoiceBridge(bridgeOpts(session, stubDb, 'sess-f30-absent'));
    await bridge.start();

    // Pushes a learner utterance — must not throw even without the callback.
    expect(() => {
      session.pushLearnerUtterance('test');
      session.flush();
    }).not.toThrow();
  });
});
// ─────────────────────────────────────────────────────────────────────────────

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
