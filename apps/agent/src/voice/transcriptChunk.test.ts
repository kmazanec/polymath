/**
 * VoiceBridge — onTranscriptChunk callback (C7).
 *
 * Verifies that `onTranscriptChunk` fires for BOTH learner and tutor chunks,
 * for BOTH interim (final:false) and final (final:true) segments, that role is
 * mapped correctly ('tutor'→'agent'), that the callback fires BEFORE the
 * final-only `onLearnerUtterance`, and that an absent callback silently no-ops.
 *
 * All tests use the MockRealtimeSession + a stub db — no network, no Postgres.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MockRealtimeSession,
  resetCacheRegistry,
  type RealtimeSessionConfig,
  type VoiceTranscript,
} from './realtimeClient.js';
import { VoiceBridge, type VoiceBridgeOpts } from './bridge.js';
import type { Db } from '../db/client.js';

const CONFIG: RealtimeSessionConfig = {
  systemPrompt: 'test persona',
  cacheKey: 'lesson:1|phase:practicing',
  model: 'gpt-realtime',
};

const STUB_DB = {
  insert: () => ({ values: () => ({ returning: async () => [{ id: 'id' }] }) }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
} as unknown as Db;

function opts(
  session: MockRealtimeSession,
  overrides: Partial<VoiceBridgeOpts> = {},
): VoiceBridgeOpts {
  return {
    session,
    db: STUB_DB,
    sessionId: 'sess-chunk',
    learnerId: 'learner-1',
    lessonId: 1,
    lessonTitle: 'AND, OR, NOT',
    phase: 'practicing',
    modelVersion: 'gpt-realtime',
    publishAudio: vi.fn(),
    ...overrides,
  };
}

describe('VoiceBridge — onTranscriptChunk (live transcript streaming)', () => {
  beforeEach(() => resetCacheRegistry());

  it('emits learner chunk then agent chunk when a learner utterance is pushed and flushed', async () => {
    const chunks: Array<{ speaker: string; text: string; final: boolean }> = [];
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'Good question.', audioFrames: 0 },
    });
    const bridge = new VoiceBridge(
      opts(session, {
        onTranscriptChunk: (c) => chunks.push({ ...c }),
      }),
    );
    await bridge.start();

    session.pushLearnerUtterance('What is AND?');
    session.flush();

    // Learner final chunk arrives first, then tutor final chunk.
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ speaker: 'learner', text: 'What is AND?', final: true });
    expect(chunks[1]).toEqual({ speaker: 'agent', text: 'Good question.', final: true });
  });

  it('maps role "tutor" to speaker "agent" — internal naming never leaks', async () => {
    const chunks: Array<{ speaker: string; text: string; final: boolean }> = [];
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'Correct!', audioFrames: 0 },
    });
    const bridge = new VoiceBridge(
      opts(session, { onTranscriptChunk: (c) => chunks.push({ ...c }) }),
    );
    await bridge.start();

    session.pushLearnerUtterance('OK');
    session.flush();

    const tutorChunk = chunks.find((c) => c.text === 'Correct!');
    expect(tutorChunk).toBeDefined();
    expect(tutorChunk!.speaker).toBe('agent');
  });

  it('fires for interim (final:false) learner chunks as well as final ones', async () => {
    // The MockRealtimeSession only emits final chunks; inject an interim via the
    // captured transcript callback so we can test the interim branch directly.
    const chunks: Array<{ speaker: string; text: string; final: boolean }> = [];
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'ok', audioFrames: 0 },
    });
    let capturedCb: ((t: VoiceTranscript) => void) | undefined;
    const orig = session.onTranscript.bind(session);
    vi.spyOn(session, 'onTranscript').mockImplementation((cb) => {
      capturedCb = cb;
      orig(cb);
    });

    const bridge = new VoiceBridge(
      opts(session, { onTranscriptChunk: (c) => chunks.push({ ...c }) }),
    );
    await bridge.start();

    // Inject an interim learner partial.
    capturedCb!({ role: 'learner', text: 'what is', at: 1, final: false });
    // Then inject the final learner segment.
    capturedCb!({ role: 'learner', text: 'what is NAND?', at: 2, final: true });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ speaker: 'learner', text: 'what is', final: false });
    expect(chunks[1]).toEqual({ speaker: 'learner', text: 'what is NAND?', final: true });
  });

  it('fires for interim (final:false) tutor chunks too', async () => {
    const chunks: Array<{ speaker: string; text: string; final: boolean }> = [];
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'ok', audioFrames: 0 },
    });
    let capturedCb: ((t: VoiceTranscript) => void) | undefined;
    const orig = session.onTranscript.bind(session);
    vi.spyOn(session, 'onTranscript').mockImplementation((cb) => {
      capturedCb = cb;
      orig(cb);
    });

    const bridge = new VoiceBridge(
      opts(session, { onTranscriptChunk: (c) => chunks.push({ ...c }) }),
    );
    await bridge.start();

    capturedCb!({ role: 'tutor', text: 'Well', at: 1, final: false });
    capturedCb!({ role: 'tutor', text: 'Well, consider the truth table.', at: 2, final: false });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ speaker: 'agent', text: 'Well', final: false });
    expect(chunks[1]).toEqual({ speaker: 'agent', text: 'Well, consider the truth table.', final: false });
  });

  it('fires BEFORE onLearnerUtterance — interim chunks reach the stream before the final fires the seam', async () => {
    // This ordering matters: the live speech bubble must light up on the first
    // ASR partial, but the learner-utterance seam only fills on final.
    const order: string[] = [];
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'ok', audioFrames: 0 },
    });
    let capturedCb: ((t: VoiceTranscript) => void) | undefined;
    const orig = session.onTranscript.bind(session);
    vi.spyOn(session, 'onTranscript').mockImplementation((cb) => {
      capturedCb = cb;
      orig(cb);
    });

    const bridge = new VoiceBridge(
      opts(session, {
        onTranscriptChunk: ({ text, final: f }) => order.push(`chunk:${text}:${f}`),
        onLearnerUtterance: (text) => order.push(`utterance:${text}`),
      }),
    );
    await bridge.start();

    capturedCb!({ role: 'learner', text: 'partial', at: 1, final: false });
    capturedCb!({ role: 'learner', text: 'partial complete', at: 2, final: true });

    // chunk fires first (unconditional), utterance fires second (final-only).
    expect(order).toEqual([
      'chunk:partial:false',
      'chunk:partial complete:true',
      'utterance:partial complete',
    ]);
  });

  it('onLearnerUtterance still fires ONLY on final learner chunks (unchanged invariant)', async () => {
    const utterances: string[] = [];
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'ok', audioFrames: 0 },
    });
    let capturedCb: ((t: VoiceTranscript) => void) | undefined;
    const orig = session.onTranscript.bind(session);
    vi.spyOn(session, 'onTranscript').mockImplementation((cb) => {
      capturedCb = cb;
      orig(cb);
    });

    const bridge = new VoiceBridge(
      opts(session, {
        onLearnerUtterance: (text) => utterances.push(text),
      }),
    );
    await bridge.start();

    // Interim must NOT fire.
    capturedCb!({ role: 'learner', text: 'what is', at: 1, final: false });
    expect(utterances).toHaveLength(0);

    // Final fires once.
    capturedCb!({ role: 'learner', text: 'what is NAND?', at: 2, final: true });
    expect(utterances).toEqual(['what is NAND?']);
  });

  it('absent onTranscriptChunk callback — silently no-ops, no throw', async () => {
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'ok', audioFrames: 0 },
    });
    // No onTranscriptChunk injected.
    const bridge = new VoiceBridge(opts(session));
    await bridge.start();

    expect(() => {
      session.pushLearnerUtterance('test');
      session.flush();
    }).not.toThrow();
  });

  it('tutor transcript does NOT fire onLearnerUtterance (unchanged invariant)', async () => {
    const utterances: string[] = [];
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'Tutor only.', audioFrames: 0 },
    });
    let capturedCb: ((t: VoiceTranscript) => void) | undefined;
    const orig = session.onTranscript.bind(session);
    vi.spyOn(session, 'onTranscript').mockImplementation((cb) => {
      capturedCb = cb;
      orig(cb);
    });

    const bridge = new VoiceBridge(
      opts(session, { onLearnerUtterance: (t) => utterances.push(t) }),
    );
    await bridge.start();

    capturedCb!({ role: 'tutor', text: 'Tutor reply.', at: 1, final: true });
    expect(utterances).toHaveLength(0);
  });
});
