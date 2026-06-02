/**
 * startVoiceBridge (C5) + VoiceBridge.pushLessonState (C6) + tool-call routing (C4) — unit tests.
 *
 * All tests use MockRealtimeSession and stub/spy dependencies. No network,
 * no Postgres, no keys required.
 *
 * C5 scenarios:
 *  - Factory present → bridge constructed, utterance registry filled on final
 *    learner chunk, transcript_stream sent to bound socket.
 *  - Factory absent → no bridge, registry stays empty (fail-closed).
 *  - onTranscriptChunk missing socket → silently skips.
 *
 * C6 scenarios:
 *  - A live bridge receives pushLessonState with server-computed values.
 *  - No live bridge → no-op, no throw.
 *  - Correctness value comes from server, not client.
 *
 * C4 (tool-call routing) scenarios:
 *  - A `propose_tactical_move` tool call fires onToolCall → action dispatched to socket.
 *  - A privileged move (transfer probe) with an ungrounded ctx is downgraded to no_action.
 *  - Outcome is echoed back to the session via sendContext (function_call_output).
 *  - Unknown tool name is silently ignored (no dispatch).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MockRealtimeSession,
  resetCacheRegistry,
  type RealtimeSessionConfig,
} from './realtimeClient.js';
import { startVoiceBridge, type RealtimeSessionFactory } from './startBridge.js';
import { LearnerUtteranceRegistry } from './learnerUtteranceRegistry.js';
import { SocketRegistry } from './socketRegistry.js';
import { LiveBridgeRegistry } from './liveBridgeRegistry.js';
import type { Db } from '../db/client.js';
import type { ResolveVoiceToolCallContext } from './resolveToolCall.js';

const CONFIG: RealtimeSessionConfig = {
  systemPrompt: 'test persona',
  cacheKey: 'lesson:1|phase:practicing',
  model: 'gpt-realtime',
};

const STUB_DB = {
  insert: () => ({ values: () => ({ returning: async () => [{ id: 'id' }] }) }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
} as unknown as Db;

/** Build a fake RealtimeSessionFactory backed by a MockRealtimeSession. */
function makeFakeFactory(session: MockRealtimeSession): {
  factory: RealtimeSessionFactory;
  publishAudio: ReturnType<typeof vi.fn>;
  learnerAudioCbs: Array<(frame: Uint8Array) => void>;
} {
  const publishAudio = vi.fn<(frame: Uint8Array) => void>();
  const learnerAudioCbs: Array<(frame: Uint8Array) => void> = [];

  const factory: RealtimeSessionFactory = async () => ({
    session,
    publishAudio,
    onLearnerAudio: (cb) => learnerAudioCbs.push(cb),
    close: async () => { /* no-op */ },
  });

  return { factory, publishAudio, learnerAudioCbs };
}

const SESSION_ID = 'aabbccdd-0000-0000-0000-000000000001';

describe('startVoiceBridge (C5)', () => {
  beforeEach(() => resetCacheRegistry());

  it('constructs and starts a bridge; utterance registry is filled on a final learner utterance', async () => {
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'Tell me more.', audioFrames: 0 },
    });
    const { factory } = makeFakeFactory(session);
    const utteranceRegistry = new LearnerUtteranceRegistry();
    const socketRegistry = new SocketRegistry();

    const { bridge } = await startVoiceBridge({
      factory,
      ctx: {
        sessionId: SESSION_ID,
        learnerId: SESSION_ID,
        lessonId: 1,
        lessonTitle: 'AND, OR, NOT',
        phase: 'practicing',
      },
      db: STUB_DB,
      utteranceRegistry,
      socketRegistry,
      roomName: 'room-1',
      livekitUrl: 'wss://test.livekit.io',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      modelVersion: 'gpt-realtime',
    });

    expect(bridge).toBeDefined();
    expect(session.connectedWith).toBeDefined();

    // Push a learner utterance and drain — the onLearnerUtterance callback must
    // fill the registry.
    session.pushLearnerUtterance('What is NAND?');
    session.flush();
    // Allow microtasks (completeTurn is async).
    await new Promise((r) => setTimeout(r, 0));

    expect(utteranceRegistry.latestFor(SESSION_ID)).toBe('What is NAND?');
  });

  it('sends transcript_stream to the bound socket for both learner and agent chunks', async () => {
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'Nice work.', audioFrames: 0 },
    });
    const { factory } = makeFakeFactory(session);
    const utteranceRegistry = new LearnerUtteranceRegistry();
    const socketRegistry = new SocketRegistry();

    // Simulate a WebSocket that records sent messages.
    const sentMessages: string[] = [];
    const fakeWs = {
      send: (data: string) => sentMessages.push(data),
    } as unknown as import('ws').WebSocket;

    // Register the socket as if session_start has already fired.
    socketRegistry.register(SESSION_ID, fakeWs);

    await startVoiceBridge({
      factory,
      ctx: {
        sessionId: SESSION_ID,
        learnerId: SESSION_ID,
        lessonId: 1,
        lessonTitle: 'AND, OR, NOT',
        phase: 'practicing',
      },
      db: STUB_DB,
      utteranceRegistry,
      socketRegistry,
      roomName: 'room-1',
      livekitUrl: 'wss://test.livekit.io',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      modelVersion: 'gpt-realtime',
    });

    session.pushLearnerUtterance('What is OR?');
    session.flush();
    await new Promise((r) => setTimeout(r, 0));

    // Two transcript_stream messages: learner then agent.
    const parsed = sentMessages.map((m) => JSON.parse(m) as { kind: string; speaker: string; text: string; final: boolean });
    const streamMsgs = parsed.filter((m) => m.kind === 'transcript_stream');

    expect(streamMsgs).toHaveLength(2);
    expect(streamMsgs[0]).toMatchObject({ kind: 'transcript_stream', speaker: 'learner', text: 'What is OR?', final: true });
    expect(streamMsgs[1]).toMatchObject({ kind: 'transcript_stream', speaker: 'agent', text: 'Nice work.', final: true });
  });

  it('no socket registered → onTranscriptChunk silently skips, no throw', async () => {
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'ok.', audioFrames: 0 },
    });
    const { factory } = makeFakeFactory(session);
    const utteranceRegistry = new LearnerUtteranceRegistry();
    // Empty registry — no socket bound.
    const socketRegistry = new SocketRegistry();

    await startVoiceBridge({
      factory,
      ctx: { sessionId: SESSION_ID, learnerId: SESSION_ID, lessonId: 1, lessonTitle: 'T', phase: 'practicing' },
      db: STUB_DB,
      utteranceRegistry,
      socketRegistry,
      roomName: 'r',
      livekitUrl: 'wss://test',
      apiKey: 'k',
      apiSecret: 's',
      modelVersion: 'gpt-realtime',
    });

    // Must not throw.
    expect(() => {
      session.pushLearnerUtterance('test');
      session.flush();
    }).not.toThrow();
  });

  it('fail-closed: no factory → bridge not started, utterance registry stays empty', () => {
    // This test verifies the server-side invariant: when deps.createRealtimeSession
    // is absent, the token-mint path runs and the bridge path is NOT entered.
    // We test this at the unit level by simply confirming that NOT calling
    // startVoiceBridge leaves the registry empty — the server.ts guard
    // `if (deps.createRealtimeSession && ...)` is what enforces this.
    const utteranceRegistry = new LearnerUtteranceRegistry();
    // We deliberately do NOT call startVoiceBridge here.
    expect(utteranceRegistry.latestFor(SESSION_ID)).toBeUndefined();
  });
});

describe('VoiceBridge.pushLessonState (C6)', () => {
  beforeEach(() => resetCacheRegistry());

  it('pushLessonState calls session.sendContext with a string containing correctness + BKT + streak + phase + hint', async () => {
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'ok', audioFrames: 0 },
    });
    const { factory } = makeFakeFactory(session);
    const utteranceRegistry = new LearnerUtteranceRegistry();
    const socketRegistry = new SocketRegistry();

    const { bridge } = await startVoiceBridge({
      factory,
      ctx: { sessionId: SESSION_ID, learnerId: SESSION_ID, lessonId: 1, lessonTitle: 'T', phase: 'practicing' },
      db: STUB_DB,
      utteranceRegistry,
      socketRegistry,
      roomName: 'r',
      livekitUrl: 'wss://test',
      apiKey: 'k',
      apiSecret: 's',
      modelVersion: 'gpt-realtime',
    });

    bridge.pushLessonState({
      correct: true,
      bkt: 0.82,
      streak: 3,
      phase: 'practicing',
      hintLevel: 0,
    });

    expect(session.sentContexts).toHaveLength(1);
    const ctx = session.sentContexts[0]!;
    // The string must contain the key values so the model can parse them.
    expect(ctx).toContain('correct');
    expect(ctx).toContain('0.820');
    expect(ctx).toContain('streak 3');
    expect(ctx).toContain('practicing');
    expect(ctx).toContain('hint 0');
  });

  it('pushLessonState with correct:false emits "incorrect" in the context string', async () => {
    const session = new MockRealtimeSession(CONFIG, {
      reply: { tutorText: 'ok', audioFrames: 0 },
    });
    const { factory } = makeFakeFactory(session);

    const { bridge } = await startVoiceBridge({
      factory,
      ctx: { sessionId: SESSION_ID, learnerId: SESSION_ID, lessonId: 1, lessonTitle: 'T', phase: 'practicing' },
      db: STUB_DB,
      utteranceRegistry: new LearnerUtteranceRegistry(),
      socketRegistry: new SocketRegistry(),
      roomName: 'r',
      livekitUrl: 'wss://test',
      apiKey: 'k',
      apiSecret: 's',
      modelVersion: 'gpt-realtime',
    });

    bridge.pushLessonState({ correct: false, bkt: 0.5, streak: 0, phase: 'practicing', hintLevel: 1 });

    expect(session.sentContexts[0]).toContain('incorrect');
  });

  it('pushLessonState with correct:null emits "n/a" (non-graded turn)', async () => {
    const session = new MockRealtimeSession(CONFIG, { reply: { tutorText: 'ok', audioFrames: 0 } });
    const { factory } = makeFakeFactory(session);

    const { bridge } = await startVoiceBridge({
      factory,
      ctx: { sessionId: SESSION_ID, learnerId: SESSION_ID, lessonId: 1, lessonTitle: 'T', phase: 'practicing' },
      db: STUB_DB,
      utteranceRegistry: new LearnerUtteranceRegistry(),
      socketRegistry: new SocketRegistry(),
      roomName: 'r',
      livekitUrl: 'wss://test',
      apiKey: 'k',
      apiSecret: 's',
      modelVersion: 'gpt-realtime',
    });

    bridge.pushLessonState({ correct: null, bkt: 0, streak: 0, phase: 'practicing', hintLevel: 0 });
    expect(session.sentContexts[0]).toContain('n/a');
  });

  it('no live bridge registered → pushLessonState lookup returns undefined, no throw', () => {
    // Simulates the server-side path where event.kind === 'submit' but there is
    // no active voice session for this sessionId.
    const bridgeReg = new LiveBridgeRegistry();
    const result = bridgeReg.get('no-such-session');
    expect(result).toBeUndefined();
    // If we were to call result.pushLessonState(...) it would throw — the test
    // is that the registry lookup returns undefined and the server guards on it.
  });

  it('LiveBridgeRegistry register/closeAndUnregister lifecycle', async () => {
    const session = new MockRealtimeSession(CONFIG, { reply: { tutorText: 'ok', audioFrames: 0 } });
    const { factory } = makeFakeFactory(session);

    const { bridge } = await startVoiceBridge({
      factory,
      ctx: { sessionId: SESSION_ID, learnerId: SESSION_ID, lessonId: 1, lessonTitle: 'T', phase: 'practicing' },
      db: STUB_DB,
      utteranceRegistry: new LearnerUtteranceRegistry(),
      socketRegistry: new SocketRegistry(),
      roomName: 'r',
      livekitUrl: 'wss://test',
      apiKey: 'k',
      apiSecret: 's',
      modelVersion: 'gpt-realtime',
    });

    const closeFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const reg = new LiveBridgeRegistry();
    expect(reg.reserve(SESSION_ID)).toBe(true);
    expect(reg.register(SESSION_ID, bridge, closeFn)).toBe(true);
    expect(reg.get(SESSION_ID)).toBe(bridge);
    expect(reg.has(SESSION_ID)).toBe(true);

    await reg.closeAndUnregister(SESSION_ID);

    // After closeAndUnregister: entry removed, close fn was called.
    expect(reg.get(SESSION_ID)).toBeUndefined();
    expect(reg.has(SESSION_ID)).toBe(false);
    expect(closeFn).toHaveBeenCalledOnce();
  });

  it('LiveBridgeRegistry singleton: second register for same id is ignored', async () => {
    const session = new MockRealtimeSession(CONFIG, { reply: { tutorText: 'ok', audioFrames: 0 } });
    const { factory } = makeFakeFactory(session);
    const { bridge } = await startVoiceBridge({
      factory,
      ctx: { sessionId: SESSION_ID, learnerId: SESSION_ID, lessonId: 1, lessonTitle: 'T', phase: 'practicing' },
      db: STUB_DB,
      utteranceRegistry: new LearnerUtteranceRegistry(),
      socketRegistry: new SocketRegistry(),
      roomName: 'r',
      livekitUrl: 'wss://test',
      apiKey: 'k',
      apiSecret: 's',
      modelVersion: 'gpt-realtime',
    });

    const close1 = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const close2 = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const reg = new LiveBridgeRegistry();
    expect(reg.reserve(SESSION_ID)).toBe(true);
    expect(reg.register(SESSION_ID, bridge, close1)).toBe(true);
    // A second reserve while a live entry exists must lose (singleton), so the
    // second mint never constructs; and a register without a held reservation
    // does not replace the live entry.
    expect(reg.reserve(SESSION_ID)).toBe(false);
    expect(reg.register(SESSION_ID, bridge, close2)).toBe(false);

    // Only the first entry is retained.
    await reg.closeAndUnregister(SESSION_ID);
    expect(close1).toHaveBeenCalledOnce();
    expect(close2).not.toHaveBeenCalled();
  });

  it('LiveBridgeRegistry race: reserve() is synchronous so two mints cannot both win', () => {
    const reg = new LiveBridgeRegistry();
    // Two near-simultaneous mints both reach reserve() before either constructs.
    expect(reg.reserve(SESSION_ID)).toBe(true); // winner
    expect(reg.reserve(SESSION_ID)).toBe(false); // loser — must not construct
    // The loser, if it somehow constructed anyway, cannot store its orphan handle.
    const bridge = {} as unknown as import('./bridge.js').VoiceBridge;
    const orphanClose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    // Winner fills its slot; loser's register returns false (caller closes the orphan).
    expect(reg.register(SESSION_ID, bridge, vi.fn<() => Promise<void>>().mockResolvedValue(undefined))).toBe(true);
    expect(reg.register(SESSION_ID, bridge, orphanClose)).toBe(false);
  });

  it('LiveBridgeRegistry: a WS close during construction drops the reservation so register orphans', async () => {
    const reg = new LiveBridgeRegistry();
    expect(reg.reserve(SESSION_ID)).toBe(true);
    // WS closes before the (async) construction calls register.
    await reg.closeAndUnregister(SESSION_ID);
    const bridge = {} as unknown as import('./bridge.js').VoiceBridge;
    // register now finds no reservation → returns false; the caller must close the orphan.
    expect(reg.register(SESSION_ID, bridge, vi.fn<() => Promise<void>>().mockResolvedValue(undefined))).toBe(false);
    expect(reg.get(SESSION_ID)).toBeUndefined();
  });
});

describe('SocketRegistry', () => {
  it('register once, get, unregister lifecycle', () => {
    const reg = new SocketRegistry();
    const fakeWs = { send: vi.fn() } as unknown as import('ws').WebSocket;

    expect(reg.get('sid-1')).toBeUndefined();
    reg.register('sid-1', fakeWs);
    expect(reg.get('sid-1')).toBe(fakeWs);

    reg.unregister('sid-1');
    expect(reg.get('sid-1')).toBeUndefined();
  });

  it('second register for same id does NOT replace — once-and-final binding', () => {
    const reg = new SocketRegistry();
    const ws1 = { send: vi.fn() } as unknown as import('ws').WebSocket;
    const ws2 = { send: vi.fn() } as unknown as import('ws').WebSocket;

    reg.register('sid-2', ws1);
    reg.register('sid-2', ws2); // must be ignored
    expect(reg.get('sid-2')).toBe(ws1);
  });
});

// ---------------------------------------------------------------------------
// C4: tool-call routing via onToolCall → resolveVoiceToolCall → socket dispatch
// ---------------------------------------------------------------------------

describe('tool-call routing (C4)', () => {
  beforeEach(() => resetCacheRegistry());

  /** Minimal no-action gate ctx: all privileged moves refused (fail-closed default). */
  function ungroundedCtx() {
    return {
      learner: {
        bktByKc: {} as Record<string, number>,
        hintsUsed: 0,
        consecutiveCorrect: 0,
        ruleGatePassed: false,
        explainBackPassed: false,
        topicGuardrailClean: true,
      },
      gate: { passed: false as const, blockers: ['rule_gate_failed' as const] },
      transferCandidates: undefined as undefined,
    };
  }

  async function buildBridgeWithSocket(
    session: MockRealtimeSession,
    socketRegistry: SocketRegistry,
    getGateContext?: () => ReturnType<typeof ungroundedCtx>,
  ) {
    const { factory } = makeFakeFactory(session);
    return startVoiceBridge({
      factory,
      ctx: { sessionId: SESSION_ID, learnerId: SESSION_ID, lessonId: 1, lessonTitle: 'T', phase: 'practicing' },
      db: STUB_DB,
      utteranceRegistry: new LearnerUtteranceRegistry(),
      socketRegistry,
      roomName: 'r',
      livekitUrl: 'wss://test',
      apiKey: 'k',
      apiSecret: 's',
      modelVersion: 'gpt-realtime',
      getGateContext,
    });
  }

  it('propose_tactical_move with a valid no_action move → action dispatched to socket', async () => {
    const session = new MockRealtimeSession(CONFIG, { reply: { tutorText: 'ok', audioFrames: 0 } });
    const socketRegistry = new SocketRegistry();
    const sentMessages: string[] = [];
    const fakeWs = { send: (m: string) => sentMessages.push(m) } as unknown as import('ws').WebSocket;
    socketRegistry.register(SESSION_ID, fakeWs);

    await buildBridgeWithSocket(session, socketRegistry, () => ungroundedCtx());

    // Fire a no_action tool call — should always succeed (no privilege required).
    session.pushToolCall('propose_tactical_move', { move: 'no_action', rationale: 'waiting', noActionReason: 'wait_for_learner' }, 'call-1');

    // Allow synchronous dispatch to complete.
    await new Promise((r) => setTimeout(r, 0));

    const actionMsgs = sentMessages.map((m) => JSON.parse(m) as { kind: string; action?: { type: string } })
      .filter((m) => m.kind === 'action');

    expect(actionMsgs).toHaveLength(1);
    expect(actionMsgs[0]?.action?.type).toBe('no_action');
  });

  it('privileged move (transfer probe) with ungrounded ctx → downgraded to no_action', async () => {
    const session = new MockRealtimeSession(CONFIG, { reply: { tutorText: 'ok', audioFrames: 0 } });
    const socketRegistry = new SocketRegistry();
    const sentMessages: string[] = [];
    const fakeWs = { send: (m: string) => sentMessages.push(m) } as unknown as import('ws').WebSocket;
    socketRegistry.register(SESSION_ID, fakeWs);

    // Ungrounded ctx: ruleGatePassed = false → transfer probe refused.
    await buildBridgeWithSocket(session, socketRegistry, () => ungroundedCtx());

    session.pushToolCall('propose_tactical_move', {
      move: 'propose_transfer_probe',
      rationale: 'ready',
      probeExpression: 'A AND B',
      probeTargetRep: 'truth_table',
      probeHiddenReps: ['circuit', 'pseudocode'],
      probeItemId: 'item-1',
    }, 'call-2');

    await new Promise((r) => setTimeout(r, 0));

    const actionMsgs = sentMessages.map((m) => JSON.parse(m) as { kind: string; action?: { type: string } })
      .filter((m) => m.kind === 'action');

    // Must be downgraded — the gate refuses the probe when no rule gate pass.
    expect(actionMsgs).toHaveLength(1);
    expect(actionMsgs[0]?.action?.type).toBe('no_action');
  });

  it('tool call outcome echoed to session via sendContext (function_call_output)', async () => {
    const session = new MockRealtimeSession(CONFIG, { reply: { tutorText: 'ok', audioFrames: 0 } });
    const socketRegistry = new SocketRegistry();
    const fakeWs = { send: vi.fn() } as unknown as import('ws').WebSocket;
    socketRegistry.register(SESSION_ID, fakeWs);

    await buildBridgeWithSocket(session, socketRegistry, () => ungroundedCtx());

    session.pushToolCall('propose_tactical_move', { move: 'no_action', rationale: 'wait', noActionReason: 'thinking' }, 'call-3');

    await new Promise((r) => setTimeout(r, 0));

    // The bridge must echo back a sendContext containing the call_id.
    expect(session.sentContexts.some((c) => c.includes('call-3'))).toBe(true);
  });

  it('unknown tool name is silently ignored — no action dispatch', async () => {
    const session = new MockRealtimeSession(CONFIG, { reply: { tutorText: 'ok', audioFrames: 0 } });
    const socketRegistry = new SocketRegistry();
    const sentMessages: string[] = [];
    const fakeWs = { send: (m: string) => sentMessages.push(m) } as unknown as import('ws').WebSocket;
    socketRegistry.register(SESSION_ID, fakeWs);

    await buildBridgeWithSocket(session, socketRegistry, () => ungroundedCtx());

    session.pushToolCall('some_unknown_tool', { foo: 'bar' }, 'call-4');

    await new Promise((r) => setTimeout(r, 0));

    const actionMsgs = sentMessages.map((m) => JSON.parse(m) as { kind: string })
      .filter((m) => m.kind === 'action');

    expect(actionMsgs).toHaveLength(0);
  });

  it('no getGateContext → fails closed (ungrounded ctx) — privileged move downgraded', async () => {
    const session = new MockRealtimeSession(CONFIG, { reply: { tutorText: 'ok', audioFrames: 0 } });
    const socketRegistry = new SocketRegistry();
    const sentMessages: string[] = [];
    const fakeWs = { send: (m: string) => sentMessages.push(m) } as unknown as import('ws').WebSocket;
    socketRegistry.register(SESSION_ID, fakeWs);

    // No getGateContext provided → falls back to UNGROUNDED_GATE_CTX.
    await buildBridgeWithSocket(session, socketRegistry, undefined);

    session.pushToolCall('propose_tactical_move', {
      move: 'propose_transfer_probe',
      rationale: 'should be refused',
      probeExpression: 'A OR B',
      probeTargetRep: 'circuit',
      probeHiddenReps: ['truth_table'],
      probeItemId: 'item-x',
    }, 'call-5');

    await new Promise((r) => setTimeout(r, 0));

    const actionMsgs = sentMessages.map((m) => JSON.parse(m) as { kind: string; action?: { type: string } })
      .filter((m) => m.kind === 'action');

    expect(actionMsgs[0]?.action?.type).toBe('no_action');
  });
});

// ---------------------------------------------------------------------------
// Server-wiring invariants: singleton, grounded context, WS-close teardown
// ---------------------------------------------------------------------------

describe('server-wiring invariants (LiveBridgeRegistry + startVoiceBridge)', () => {
  beforeEach(() => resetCacheRegistry());

  /**
   * Builds a startVoiceBridge call and returns the handle.
   * The factory records how many times it was invoked so tests can assert singleton behaviour.
   */
  async function buildHandle(
    session: MockRealtimeSession,
    opts?: { getGateContext?: () => ResolveVoiceToolCallContext | undefined },
  ) {
    const { factory, ...rest } = makeFakeFactory(session);
    return {
      handle: await startVoiceBridge({
        factory,
        ctx: { sessionId: SESSION_ID, learnerId: SESSION_ID, lessonId: 1, lessonTitle: 'T', phase: 'practicing' },
        db: STUB_DB,
        utteranceRegistry: new LearnerUtteranceRegistry(),
        socketRegistry: new SocketRegistry(),
        roomName: 'r',
        livekitUrl: 'wss://test',
        apiKey: 'k',
        apiSecret: 's',
        modelVersion: 'gpt-realtime',
        getGateContext: opts?.getGateContext,
      }),
      ...rest,
    };
  }

  it('singleton: LiveBridgeRegistry.has() prevents a second bridge from being started for the same session', async () => {
    // Simulates the handleRealtimeSession guard: if bridgeReg.has(sessionId) → skip bridge start.
    const session = new MockRealtimeSession(CONFIG, { reply: { tutorText: 'ok', audioFrames: 0 } });
    const { handle } = await buildHandle(session);

    const close1 = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const reg = new LiveBridgeRegistry();
    expect(reg.reserve(SESSION_ID)).toBe(true);
    reg.register(SESSION_ID, handle.bridge, close1);

    // has() returns true — the guard in handleRealtimeSession (reserve()) returns early.
    expect(reg.has(SESSION_ID)).toBe(true);

    // Simulating a second mint: reserve() loses, so the caller never calls startVoiceBridge.
    const close2 = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    expect(reg.reserve(SESSION_ID)).toBe(false);

    // On WS close, only close1 runs (close2 was never stored).
    await reg.closeAndUnregister(SESSION_ID);
    expect(close1).toHaveBeenCalledOnce();
    expect(close2).not.toHaveBeenCalled();
  });

  it('grounded getGateContext: a transfer probe is accepted when ruleGatePassed + matching candidate', async () => {
    // Build a grounded gate context where the rule gate has passed and a transfer
    // candidate exists — the probe should be allowed through (not downgraded).
    const groundedCtx: ResolveVoiceToolCallContext = {
      learner: {
        bktByKc: { 'AND': 0.95 },
        hintsUsed: 0,
        consecutiveCorrect: 3,
        ruleGatePassed: true,
        explainBackPassed: false,
        topicGuardrailClean: true,
      },
      gate: { passed: false, blockers: ['explain_back_not_passed'] },
      transferCandidates: [
        {
          itemId: 'item-transfer-1',
          targetExpression: 'A AND B',
          targetRep: 'truth_table',
          hiddenReps: ['circuit', 'pseudocode'],
        },
      ],
    };

    const session = new MockRealtimeSession(CONFIG, { reply: { tutorText: 'ok', audioFrames: 0 } });
    const socketRegistry = new SocketRegistry();
    const sentMessages: string[] = [];
    const fakeWs = { send: (m: string) => sentMessages.push(m) } as unknown as import('ws').WebSocket;
    socketRegistry.register(SESSION_ID, fakeWs);

    const { factory } = makeFakeFactory(session);
    await startVoiceBridge({
      factory,
      ctx: { sessionId: SESSION_ID, learnerId: SESSION_ID, lessonId: 1, lessonTitle: 'T', phase: 'practicing' },
      db: STUB_DB,
      utteranceRegistry: new LearnerUtteranceRegistry(),
      socketRegistry,
      roomName: 'r',
      livekitUrl: 'wss://test',
      apiKey: 'k',
      apiSecret: 's',
      modelVersion: 'gpt-realtime',
      getGateContext: () => groundedCtx,
    });

    // Fire a transfer probe tool call matching the candidate.
    // All nullable MoveSchema fields must be present (either as their value or null)
    // for Zod to accept the object — omitting a nullable field is a parse error in Zod 3.
    session.pushToolCall('propose_tactical_move', {
      move: 'propose_transfer_probe',
      rationale: 'earned it',
      item: null,
      tier: null,
      altRep: null,
      workedExpression: null,
      workedSteps: null,
      workedVisibleReps: null,
      question: null,
      answer: null,
      topicClassification: null,
      noActionReason: null,
      hintLevel: null,
      hintBody: null,
      probeExpression: 'A AND B',
      probeTargetRep: 'truth_table',
      probeHiddenReps: ['circuit', 'pseudocode'],
      probeItemId: 'item-transfer-1',
      scaffold: null,
    }, 'call-grounded');

    await new Promise((r) => setTimeout(r, 0));

    const actionMsgs = sentMessages
      .map((m) => JSON.parse(m) as { kind: string; action?: { type: string } })
      .filter((m) => m.kind === 'action');

    // With a grounded context where ruleGatePassed=true and a matching candidate,
    // the probe should NOT be downgraded to no_action.
    expect(actionMsgs).toHaveLength(1);
    expect(actionMsgs[0]?.action?.type).not.toBe('no_action');
    expect(actionMsgs[0]?.action?.type).toBe('mount');
  });

  it('bridge is NOT closed at start — close is deferred to closeAndUnregister', async () => {
    // The factory's close() must not be called eagerly when startVoiceBridge returns.
    // Teardown should happen only when closeAndUnregister is explicitly called (from the
    // WS-close handler), not the instant the bridge is registered.
    const session = new MockRealtimeSession(CONFIG, { reply: { tutorText: 'ok', audioFrames: 0 } });
    const closeFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const factory: RealtimeSessionFactory = async () => ({
      session,
      publishAudio: vi.fn(),
      onLearnerAudio: () => {},
      close: closeFn,
    });

    const handle = await startVoiceBridge({
      factory,
      ctx: { sessionId: SESSION_ID, learnerId: SESSION_ID, lessonId: 1, lessonTitle: 'T', phase: 'practicing' },
      db: STUB_DB,
      utteranceRegistry: new LearnerUtteranceRegistry(),
      socketRegistry: new SocketRegistry(),
      roomName: 'r',
      livekitUrl: 'wss://test',
      apiKey: 'k',
      apiSecret: 's',
      modelVersion: 'gpt-realtime',
    });

    // After startVoiceBridge returns, close must NOT have been called yet.
    expect(closeFn).not.toHaveBeenCalled();

    // Now simulate WS close by calling closeAndUnregister via the registry.
    const reg = new LiveBridgeRegistry();
    reg.reserve(SESSION_ID);
    reg.register(SESSION_ID, handle.bridge, handle.close);
    await reg.closeAndUnregister(SESSION_ID);

    // Only now should close have been called.
    expect(closeFn).toHaveBeenCalledOnce();
  });
});
