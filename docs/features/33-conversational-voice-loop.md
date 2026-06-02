# Feature: Conversational Voice Loop

**Status:** Building · **Date:** 2026-06-02 · **ADR:** [ADR-018](../adrs/ADR-018-conversational-voice-loop.md)

## What this delivers (before → after)

**Before:** Clicking the mic "connects" a LiveKit room, but the server only mints a token — no one listens server-side, the utterance registry stays empty, `spoken_turn` fails closed, and the only visible change is button text. No transcript, no reply, no conversation.

**After:** A learner talks to the tutor and hears it talk back; their words and the tutor's stream into the chat live; and the tutor can move the lesson forward — mount the next item, offer a hint, walk into a transfer probe — by *proposing* tactical moves the existing guards still gate. The lesson tiles and the spoken conversation coexist on one surface.

## Requirements & acceptance criteria

Locked with Keith (brainstorming + the kmaz-feature lock gate). All voice behavior is **env-gated and fails closed**: with LiveKit/OpenAI unconfigured, the system behaves exactly as today (mic unavailable / 503), and every offline test below runs against `MockRealtimeSession` + a fake room.

**AC-1 (production realtime session).** *Given* LiveKit + OpenAI are configured, *when* a learner starts a voice session, *then* the server joins the room as a participant, opens an OpenAI Realtime session, and constructs a `VoiceBridge` whose `onLearnerUtterance` fills `LearnerUtteranceRegistry.setLatest(sessionId, text)` — **only on finalized (`t.final`) learner segments.**

**AC-2 (fail-closed unchanged).** *Given* LiveKit/OpenAI are unconfigured (or partially configured), *when* a learner tries voice, *then* `/api/realtime/session` returns `503`, no bridge is constructed, and `spoken_turn` still acks-without-answering — identical to current behavior. *Given* an empty capture, *when* `spoken_turn` arrives, *then* the server sends `ack`, never an answer.

**AC-3 (spoken reply, audible + transcript).** *Given* a live session, *when* the learner asks an on-topic question by voice, *then* the tutor answers in **audio** AND every learner/tutor turn is emitted as a `transcript_stream` `ServerMessage` (`{ speaker, text, final }`).

**AC-4 (streaming transcript UI).** *Given* `transcript_stream` chunks arrive, *when* `final === false`, *then* the UI shows a single live, visually-distinct in-progress bubble for that speaker; *when* `final === true`, *then* it commits a durable `spokenTurn` to the append-only transcript and clears the in-progress bubble.

**AC-5 (model drives UI via gated tool calls).** *Given* a live session, *when* the realtime model emits a tool call mirroring a tactical move, *then* it resolves to a `TacticalMove` → `compileMove` → `validateOutboundAction` → Layer-2 recompute → `rejectUnauthorizedAction` → guards, and reaches the client as the **same** `action` `ServerMessage` a text-agent move would. *Given* a forged/premature `propose_transfer_probe` or `propose_mastery_transition`, *when* it is unearned, *then* it is downgraded to `no_action` (never mounts/transitions).

**AC-6 (model informed of score, never scores).** *Given* a `submit` is folded during a live session, *when* the server has updated BKT/streak/phase/hint-level, *then* it pushes a compact lesson-state context update into the realtime session; the model's reply/tool-call may reflect it. Correctness and BKT are still computed exactly as today (no trust-boundary change).

**AC-7 (mic visual feedback).** *Given* a live session, *then* the mic button shows a distinct red/pulsing **listening** state (≠ idle/connecting/connected); a **mic audio-level meter** reflects live input; an **agent-speaking** indicator shows while tutor audio plays; and a **thinking** state shows between the learner finishing and the tutor starting. Pulse/animation is gated behind `prefers-reduced-motion: no-preference`.

**AC-8 (contract is append-only).** *Then* `transcript_stream` is the only contract change: one new `ServerMessage` variant; no existing payload reshaped; no new wire `Action` variant; web renderer/parser exhaustiveness preserved.

## Approach

How it fits the existing codebase, following established patterns. Locked decisions each carry their one-line WHY; the full reasoning is in ADR-018.

### Contract (the one new surface)
- **`packages/contract/src/wire.ts`** — append `transcript_stream` to the `ServerMessage` discriminated union: `{ kind: 'transcript_stream', sessionId, speaker: 'learner'|'agent', text: z.string().max(MAX_SOURCE_LEN), final: z.boolean() }`. *WHY append-only:* the wire contract is append-only (ROADMAP); a new outbound kind doesn't break existing senders. *WHY app WS not LiveKit data channel:* the data channel is unwired on both ends; the app WS is one Zod-validated seam (ADR-018 §2).

### Server (the previously-deferred live path)
- **`apps/agent/src/voice/realtimeClient.ts`** — keep the frozen `RealtimeSession` interface + `MockRealtimeSession`; add a production implementation file (`liveRealtimeSession.ts`) implementing `RealtimeSession` against the OpenAI Realtime API. *WHY a new file, interface unchanged:* the interface is the frozen seam (ADR-006/F-10); production *implements*, never reshapes.
- **Server-side LiveKit room participant** — receives the learner mic track, publishes tutor audio. *WHY new dep:* `livekit-server-sdk` (installed) mints tokens but cannot receive audio; needs `@livekit/rtc-node` + `openai`. Both must build under Node 22 in the agent Docker image — verify with a real image build (native bindings; CLAUDE.md Dockerfile-COPY/native-dep discipline).
- **`apps/agent/src/server.ts` `handleRealtimeSession`** — after minting the token (unchanged), construct the room participant + `liveRealtimeSession` + `VoiceBridge` with `onLearnerUtterance: (text) => server.learnerUtteranceRegistry.setLatest(sessionId, text)` and `start()` it; guard the whole block behind `voiceConfigured()` so it stays fail-closed. Reuse `buildVoiceSystemPrompt`/`voiceCacheKey` (`persona.ts`).
- **Realtime tool calls → tactical moves** — define a realtime tool schema mirroring `F26_MENU` (lockstep with `menu.ts`'s `TacticalMove` and `openaiClient.ts`'s enum, per CLAUDE.md). A tool call resolves to a `TacticalMove`, then runs the **identical** chokepoint a text move does: `compileMove` → `validateOutboundAction` → Layer-2 `claimedTruthTable` recompute → `rejectUnauthorizedAction` → guards → emitted as an `action` `ServerMessage`. *WHY:* ADR-005 preserved — the model proposes, the guards decide; a privileged unearned move downgrades to `no_action`.
- **Lesson-state context push** — on a folded `submit` during a live session, send a compact state summary (correct, BKT, streak, phase, hint level) into the realtime session as context. *WHY:* the model reacts conversationally and picks its next tool against the real state; it never scores (AC-6).
- **`transcript_stream` emission** — the `VoiceBridge` transcript pipeline (already accumulating interim+final learner/tutor chunks) emits a `transcript_stream` message per chunk over the bound socket. Interim from non-final chunks; `final` on `t.final`.

### Web (the conversational UI)
- **`apps/web/src/voice/client.ts`** — expose the local mic `MediaStream` (a `get stream()` getter or `onStreamAcquired` callback) for an `AnalyserNode` level meter; hook `onRemoteAudio` for the agent-speaking indicator. *WHY callback/getter:* `_stream` is private; the state machine is tested — additive exposure is lower-risk than new states.
- **`apps/web/src/voice/AskTutorButton.tsx`** — add voice-activity visuals via a `data-voice-activity` attribute (`listening`/`agent-speaking`/`thinking`) driven from bridge/stream signals, leaving the tested `VoiceState` machine intact; render the audio-level meter. *WHY attribute not new state:* mirrors the existing `data-voice-state` CSS hook.
- **`apps/web/src/components/surfaceState.ts`** — add optional `partial?: boolean` to `SpokenTurn`; keep the transcript append-only by holding the single in-progress (interim) turn in a separate App state slot, committing via `appendSpokenTurn` on final. *WHY:* preserves the append-only transcript design (F-27).
- **`apps/web/src/App.tsx`** — handle `transcript_stream` in the WS router **before** the `if (msg.kind !== 'action') return` gate: non-final → set/replace the interim bubble; final → `appendSpokenTurn` + clear interim. *WHY:* non-action messages are dropped after that gate today.
- **`apps/web/src/ws/client.ts`** — no code change beyond the contract (the new kind flows through `ServerMessageSchema.safeParse` once added to the union).
- **`apps/web/src/components/TranscriptLog.tsx`** + **`styles/global.css`** — render the interim bubble distinctly (greyed/italic); add red-pulse listening, waveform/meter, and agent-speaking styles using `--desk-*` tokens (composer bar is fixed-dark), animations behind `prefers-reduced-motion`.

## Build plan

Test-first, ordered; each chunk names the ACs it satisfies and the test(s) that prove it. Built in an isolated worktree under `.claude/worktrees/`. Run only impacted tests per chunk; full suite once at the end (isolated-run discipline for agent DB tests per CLAUDE.md).

- [ ] **C1 — Contract: `transcript_stream`.** Add the variant to `ServerMessage`; export type. *Tests:* `packages/contract` — valid `transcript_stream` parses; junk field stripped; existing kinds unaffected. (AC-8)
- [ ] **C2 — Tool schema ↔ tactical menu lockstep.** Define the realtime tool schema mirroring `F26_MENU` + a `toTacticalMove` mapping. *Tests:* every `F26_MENU` move has a tool and round-trips to a `TacticalMove`; a typecheck-level exhaustiveness guard (mirrors `openaiClient.ts`). (AC-5)
- [ ] **C3 — Tool call → gated action path.** Resolve a tool call → `compileMove` → `validateOutboundAction` → Layer-2 → `rejectUnauthorizedAction`. *Tests:* an on-topic `answer_question` tool → `action`; a forged `propose_transfer_probe` with `ruleGatePassed=false` → `no_action`; a premature `propose_mastery_transition` with `gate.passed=false` → `no_action`. (AC-5)
- [ ] **C4 — Production `RealtimeSession` (live) impl, mock-backed tests.** `liveRealtimeSession.ts implements RealtimeSession`; unit-test the event mapping (OpenAI Realtime events → `VoiceTranscript`/audio/`isResponding`) with a fake socket; `MockRealtimeSession` still satisfies the interface. *Tests:* interface conformance; `t.final` gating; interrupt→`response.cancel`. (AC-1)
- [ ] **C5 — Server bridge construction, fail-closed.** `handleRealtimeSession` constructs room-participant + session + `VoiceBridge` behind `voiceConfigured()`; wires `onLearnerUtterance → setLatest`. *Tests:* configured → bridge constructed + registry filled on final (fake room); unconfigured/partial → `503`, no bridge; empty capture → `spoken_turn` acks. (AC-1, AC-2)
- [ ] **C6 — Lesson-state context push.** On a folded `submit` in a live session, push the compact state summary into the session. *Tests:* a `submit` fold triggers one context push carrying server-computed BKT/streak/phase/hint; correctness path unchanged (no re-derivation from the frame). (AC-6)
- [ ] **C7 — `transcript_stream` emission.** Bridge emits per-chunk `transcript_stream` over the bound socket; binds to the `session_start` session id only. *Tests:* interim+final learner/tutor chunks produce ordered `transcript_stream` messages; a frame naming a different session id is not honored. (AC-3, AC-2)
- [ ] **C8 — Web: interim/final transcript rendering.** `SpokenTurn.partial`; App interim slot; router branch before the action gate; `appendSpokenTurn` on final. *Tests:* `App`/`TranscriptLog` jsdom — non-final renders a greyed in-progress bubble; final commits a durable turn and clears interim; ordering preserved. (AC-4)
- [ ] **C9 — Web: mic visuals.** Expose mic stream; `AnalyserNode` meter; `data-voice-activity` listening/speaking/thinking; styles + reduced-motion gating. *Tests:* `AskTutorButton` jsdom — activity attribute flips with signals; meter mounts when stream present; existing `VoiceState` behavior unchanged. (AC-7)
- [ ] **C10 — E2E + build verification.** Extend `apps/web/e2e/voice.spec.ts` (fake media) to assert listening state + a streamed transcript bubble render over the **built** app (web DCE/artifact discipline, CLAUDE.md). `docker build` the agent image to prove `@livekit/rtc-node`/`openai` native deps resolve under Node 22. *Tests:* the e2e spec; a successful agent image build + `/api/health`. (AC-7, AC-1)

## Quality bars

- **Security / trust boundary:** No new client trust. Transcript stays **server-captured** (the room participant is server-side); the client only triggers, never sends transcript text. `transcript_stream` is server→client (outbound) only. Tool-call actions traverse the same `validateOutboundAction`/Layer-2/`rejectUnauthorizedAction` gates as the text agent; privileged moves downgrade when unearned. Socket binds session from `session_start` only. Distinct-variable cap applies on any new server-side `equivalent()`/`truthTable()` call site. Integrity reads scope `events.app IS NULL`. Env fails closed (all of `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` + OpenAI required). No secret in process argv for any key-gated CI step.
- **Non-functional:** Live audio targets (TTFT ~1s, barge-in <300ms, transcript ≤2s) are verifiable only against real keys — asserted in the live smoke, not offline. Interim transcript rendering must not thrash React (single interim slot, not an append per ASR partial). Prompt-cache key reused (`voiceCacheKey`) to keep realtime cost down.
- **Observability:** `VoiceBridge` already logs `voice_turns` + OTel spans (TTFT, barge-in, cache-hit) — production wiring lights these up; no new metric needed. `transcript_stream` is ephemeral UI transport (the durable record is the logged voice turn + the committed `spokenTurn`).
- **Simplicity:** One new contract kind; one new server impl file + a tool-schema module; additive web exposure (no `VoiceState` machine changes, transcript stays append-only). No speculative abstraction over providers beyond the existing `RealtimeSession` seam.

## Decisions, assumptions & blockers

*(filled in during/after the build)*
