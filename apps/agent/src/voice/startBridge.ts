/**
 * Bridge-construction entry point: connects a `RealtimeSession` (real or mock)
 * to a `VoiceBridge` and starts both.
 *
 * Extracted from `handleRealtimeSession` so the wiring can be tested without
 * driving an HTTP request. In production `handleRealtimeSession` calls this
 * immediately after minting the LiveKit token; in tests a fake factory and a
 * `MockRealtimeSession` replace both the network and the room.
 *
 * The function is async but does NOT retain a reference to anything — it
 * returns the constructed `VoiceBridge` (and the factory's `close` teardown)
 * so the caller can register them in whatever lifecycle it owns. This keeps
 * the module free of global state and easy to test in isolation.
 *
 * Fail-closed design: if `createRealtimeSession` throws, the error propagates;
 * the caller (handleRealtimeSession) catches it and logs. The token was already
 * minted before this is called, so a bridge-start failure degrades gracefully:
 * the client can still join the LiveKit room, but the server-side bridge
 * (transcript streaming, learner-utterance capture) won't be active. The
 * production invariant — absent factory → no bridge → spoken_turn fails closed
 * — is therefore also satisfied when the factory throws.
 */
import type { Db } from '../db/client.js';
import type { ServerMessage } from '@polymath/contract';
import { noAction } from '@polymath/contract';
import { VoiceBridge } from './bridge.js';
import type { RealtimeSession } from './realtimeClient.js';
import type { LearnerUtteranceRegistry } from './learnerUtteranceRegistry.js';
import type { SocketRegistry } from './socketRegistry.js';
import { resolveVoiceToolCall, type ResolveVoiceToolCallContext } from './resolveToolCall.js';

/** Minimal session context the bridge needs from the HTTP/DB layer. */
export interface BridgeSessionContext {
  sessionId: string;
  learnerId: string;
  lessonId: number;
  lessonTitle: string;
  /** Current statechart phase (drives persona + cache key). */
  phase: string;
}

/**
 * Factory shape for the server-side realtime session + room plumbing.
 *
 * The bridge needs:
 *  - A `RealtimeSession` (OpenAI-Realtime via LiveKit in prod; a mock in tests).
 *  - A `publishAudio` sink that writes tutor audio frames to the room track.
 *  - An `onLearnerAudio` subscription so learner mic frames reach the model and
 *    the bridge's `onLearnerAudioActivity()` barge-in hook is called on VAD.
 *  - A `close()` to tear down room membership + the underlying session.
 *
 * The real implementation (a later chunk) uses the LiveKit Node SDK to join the
 * room, open the audio tracks, and wrap an OpenAI-Realtime WebSocket as a
 * `RealtimeSession`. This seam keeps ALL that network code out of the agent
 * package until it ships.
 */
export interface RealtimeSessionFactory {
  (args: {
    sessionId: string;
    roomName: string;
    livekitUrl: string;
    apiKey: string;
    apiSecret: string;
    model: string;
    systemPrompt?: string;
  }): Promise<{
    session: RealtimeSession;
    publishAudio: (frame: Uint8Array) => void;
    onLearnerAudio: (cb: (frame: Uint8Array) => void) => void;
    close: () => Promise<void>;
  }>;
}

export interface StartBridgeArgs {
  factory: RealtimeSessionFactory;
  ctx: BridgeSessionContext;
  db: Db;
  utteranceRegistry: LearnerUtteranceRegistry;
  socketRegistry: SocketRegistry;
  roomName: string;
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  modelVersion: string;
  /**
   * Server-derived gate context supplier for tool-call routing (C4).
   *
   * When the model emits a `propose_tactical_move` tool call, the bridge calls
   * this getter to obtain the latest server-computed mastery / learner snapshot
   * before running `resolveVoiceToolCall`. The getter is called at tool-call time
   * (not at bridge construction) so it always reflects the most recent submit fold.
   *
   * Fail-closed default: when absent OR when the getter returns `undefined`, the
   * bridge synthesises a MINIMAL context with `ruleGatePassed:false` /
   * `gate.passed:false` so `rejectUnauthorizedAction` rejects all privileged moves
   * (transfer probe, mastery). A `no_action` is sent to the model as its
   * function_call_output. This is intentionally conservative — a voice turn that
   * arrives before any submit has been folded should not be able to mint a
   * privileged surface. (ADR-018; CLAUDE.md "privileged-action FAMILY" invariant.)
   *
   * The server wires this in `handleRealtimeSession` by capturing the latest
   * `learnerDerived` / `gateEvaluation` snapshot from the liveBridgeRegistry's
   * companion gate-context map (updated on each `submit` fold).
   */
  getGateContext?: () => ResolveVoiceToolCallContext | undefined;
}

export interface LiveBridgeHandle {
  bridge: VoiceBridge;
  /** Tear down the room membership + underlying session. */
  close: () => Promise<void>;
}

/**
 * Construct + start a `VoiceBridge` for a live voice session.
 *
 * Wires:
 *  - `onLearnerUtterance` → `utteranceRegistry.setLatest` so a finalized
 *    learner utterance is available when a `spoken_turn` frame arrives.
 *  - `onTranscriptChunk` → sends a `transcript_stream` WS message to the
 *    session's bound socket (looked up from `socketRegistry` at emit time,
 *    so a socket not yet bound or already closed is a no-op).
 *
 * Returns the bridge + the factory's `close` so the caller can register both
 * in its session-lifecycle map.
 */
/**
 * Minimal fail-closed gate context used when no server-derived state is available
 * (no submit has been folded yet, or getGateContext returned undefined).
 *
 * Every privileged move (transfer probe, mastery) requires `ruleGatePassed:true`
 * and `gate.passed:true`; a context with both false causes `rejectUnauthorizedAction`
 * to refuse all privileged proposals → `no_action`. This is intentionally conservative.
 * (ADR-018; CLAUDE.md "mastery gate fails closed" invariant.)
 */
const UNGROUNDED_GATE_CTX: ResolveVoiceToolCallContext = {
  learner: {
    bktByKc: {},
    hintsUsed: 0,
    consecutiveCorrect: 0,
    ruleGatePassed: false,
    explainBackPassed: false,
    topicGuardrailClean: true,
  },
  gate: {
    passed: false,
    blockers: ['rule_gate_failed'],
  },
  transferCandidates: undefined,
};

export async function startVoiceBridge(args: StartBridgeArgs): Promise<LiveBridgeHandle> {
  const {
    factory,
    ctx,
    db,
    utteranceRegistry,
    socketRegistry,
    roomName,
    livekitUrl,
    apiKey,
    apiSecret,
    modelVersion,
    getGateContext,
  } = args;

  const { session, publishAudio, onLearnerAudio, close: closeFactory } = await factory({
    sessionId: ctx.sessionId,
    roomName,
    livekitUrl,
    apiKey,
    apiSecret,
    model: modelVersion,
  });

  const bridge = new VoiceBridge({
    session,
    db,
    sessionId: ctx.sessionId,
    learnerId: ctx.learnerId,
    lessonId: ctx.lessonId,
    lessonTitle: ctx.lessonTitle,
    phase: ctx.phase,
    modelVersion,
    publishAudio,

    // Fill the learner-utterance seam on every FINALIZED learner segment.
    // The spoken_turn handler reads from here (never the client frame) — this
    // is the "legitimate fill path" half of the fail-closed invariant (CLAUDE.md:
    // "a gate nobody can pass is as broken as a gate anyone can forge").
    onLearnerUtterance: (text) => utteranceRegistry.setLatest(ctx.sessionId, text),

    // Live transcript streaming: look up the bound socket at emit time so we
    // don't need to hold a ws reference here. The socket is registered only after
    // a session_start frame on the WS connection (MR !8 binding rule), so a
    // missing socket during early emit is expected and silently skipped.
    onTranscriptChunk: ({ speaker, text, final: isFinal }) => {
      const ws = socketRegistry.get(ctx.sessionId);
      if (!ws) return;
      const msg: ServerMessage = {
        kind: 'transcript_stream',
        sessionId: ctx.sessionId,
        speaker,
        text,
        final: isFinal,
      };
      ws.send(JSON.stringify(msg));
    },
  });

  // Feed learner room-audio frames into the session + barge-in hook. The factory
  // calls the registered callback whenever its VAD detects audio activity.
  onLearnerAudio((frame) => {
    session.sendAudioFrame(frame);
    bridge.onLearnerAudioActivity();
  });

  // --- Tool-call routing (C4) ---
  //
  // When the model emits a `propose_tactical_move` function call, route it through
  // the SAME validation sequence as the text path (resolveVoiceToolCall: Zod +
  // Layer-2 + earned-it gate). The validated action is dispatched to the learner's
  // socket as an `action` ServerMessage. The function_call_output is sent back to
  // the model so it can narrate the outcome appropriately.
  //
  // Fail-closed: `session.onToolCall` is optional; if absent (old mock, stub) we
  // simply skip the subscription. The gate context defaults to UNGROUNDED_GATE_CTX
  // when no real state is available — all privileged proposals become no_action.
  if (session.onToolCall) {
    session.onToolCall(({ name, args: callArgs, callId }) => {
      // Only route the tool we defined; ignore any unexpected tool names.
      if (name !== 'propose_tactical_move') return;

      // Resolve gate context. Server-derived state from the latest submit fold;
      // falls back to the fail-closed minimal ctx when none is available.
      const gateCtx = getGateContext?.() ?? UNGROUNDED_GATE_CTX;

      // Run the full validation pipeline (ADR-018).
      const action = resolveVoiceToolCall(callArgs, gateCtx);

      // Dispatch the gated action to the learner's socket.
      const ws = socketRegistry.get(ctx.sessionId);
      if (ws) {
        const msg: ServerMessage = {
          kind: 'action',
          sessionId: ctx.sessionId,
          action,
        };
        ws.send(JSON.stringify(msg));
      }

      // Send function_call_output back to the model so it knows the outcome.
      // Keep it short: the model uses this to narrate ("I've queued your next
      // problem" vs "I can't do that yet"). Avoid logging or forwarding the
      // full action payload — it may contain claimedTruthTable arrays the model
      // doesn't need back. (Secrets are never in tool payloads; this is safe.)
      if (session.sendContext) {
        const outcome =
          action.type === 'no_action'
            ? `move refused (not yet earned or malformed)`
            : `move accepted: ${action.type}`;
        // Use sendContext as the lowest-friction way to get the result back to the
        // model's context window. A real function_call_output would need a
        // `conversation.item.create` + `response.create` which re-triggers speech.
        // sendContext injects it without triggering a new spoken response, which is
        // appropriate when the server has already decided the action — the model can
        // incorporate the result on its next VAD turn.
        session.sendContext(`[tool_result call_id=${callId}] ${outcome}`);
      }
    });
  }

  await bridge.start();
  return { bridge, close: closeFactory };
}
