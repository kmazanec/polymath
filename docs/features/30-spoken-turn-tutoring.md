# Feature: Spoken responses as first-class tutoring input

**ID:** F-30 · **Iteration:** I7 · **Status:** Not started

## What this delivers (before → after)
**Before:** The student's spoken feedback is used nowhere outside the explain-back gate — the "Ask the tutor" voice channel opens but no general spoken turn is transcribed, fed to the agent, or shown anywhere.
**After:** A student can speak to the tutor mid-lesson; their utterance is captured + transcribed server-side, fed to the LLM tutor as a question, answered in text (confirming understanding or giving more instruction), and **both the spoken turn and the reply appear in the conversation transcript** — all without trusting any client-sent transcript.

## How it fits the roadmap
I7 feature realizing [ADR-016](../adrs/ADR-016-spoken-turns-and-tablet-touch.md). It extends the shipped `VoiceBridge`/`RealtimeSession` voice path (F-10/F-11) with a general-utterance capture seam beside the explain-back registry, and routes the captured utterance through the existing `learner_question → answer_question` flow.

## Requirements traced (from the PRD)
ADR-004's "conversational Q&A with the inner agent" (voice) — anticipated but never built; the brief's *"the interface itself is part of the tutoring"* and the front-line-tutor role (hear the student, confirm or re-instruct).

## Dependencies (must exist before this starts)
- Shipped voice path (F-10 LiveKit/Realtime, F-11 explain-back capture) — extends its seam. (Hard in the sense that the `VoiceBridge`/registry must exist; they shipped in I2.)
- Soft: F-27 (transcript surface) renders the spoken turn; F-30 emits the turn data, F-27 displays it. F-30 builds against the frozen ADR-015 surface.

## Unblocks (what waits on this)
- F-32 (agent eval) — F-30 contributes the spoken-turn labeled scenarios (utterance → expected answer properties); F-30 is "done" only when those cases are green.

## Contracts touched
- **Voice capture seam** (source of truth: ADR-006 / **ADR-016**) — adds a general-utterance getter (e.g. `latestLearnerUtteranceFor(sessionId)`) backed by the `VoiceBridge`, beside the explain-back registry. **Does NOT reshape the `RealtimeSession` interface** (add a getter, don't change the boundary).
- **WebSocket protocol** (source of truth: ADR-005) — a spoken-turn *trigger* only; **no `transcript` field the server trusts** (the answered text is the server-captured utterance). No reshaped payload.
- **Learning surface** (source of truth: ADR-015) — the spoken turn + reply are transcript turns.
- The topic guardrail (ADR-003) bounds spoken Q&A as it does typed.

## Acceptance criteria (product behavior)
1. With voice configured, a student can speak a question/comment mid-lesson and receive a relevant **text** answer from the tutor that confirms their understanding or gives further instruction.
2. The answered question is the **server-captured** transcript of the utterance — a client cannot cause the agent to answer a transcript it POSTs (no client-trusted transcript field; fails closed to "no utterance" if the server captured none).
3. Both the student's spoken turn (transcribed) and the tutor's reply render as turns in the conversation transcript, interleaved in order.
4. The explain-back capture path is unchanged and still airtight (its registry, preconditions, judge untouched); the general seam is a sibling.
5. An off-topic spoken question folds into the same uncapped off-topic guardrail counter as a typed one.
6. With voice **not** configured (no LiveKit env), the feature degrades to the honest "voice unavailable" state — no crash, text Q&A still works.

## Testing requirements
- Unit: the general-utterance seam returns the latest captured learner text per session and fails closed (empty) when none; it is keyed by session, scoped outside explain-back.
- Integration (agent suite): a captured spoken turn routes through `learner_question → answer_question`; the answered text is the server-captured utterance, never a client frame; off-topic folds into the guardrail.
- Integrity (adversarial): a client frame carrying a `transcript`/`question` it did not earn cannot make the agent answer a forged spoken turn (the seam ignores client text).
- The explain-back integrity tests still pass unchanged (no regression to the gated seam).
- **Eval contribution (F-32):** add spoken-turn scenarios to the golden set (topic classification, deterministic, 100% offline) and the live bank (answer groundedness ≥90%). These cases gate F-30 "done" per [ADR-017](../adrs/ADR-017-agent-eval-policy-golden-set.md).

## Manual setup required
LiveKit env (`LIVEKIT_API_KEY`/`SECRET`/`URL`) + `OPENAI_API_KEY` for the live voice + LLM path; on-device tablet mic test (a human must verify real capture — the realtime round-trip is mocked in tests per ADR-006). No keys in MR pipelines.

## Build plan (kmaz-plan-iteration, I7 — one opus pass; verified against code 2026-05-31)

**Tier: Sonnet** + standard Opus review pass (the integrity boundary is fully specified by the explain-back precedent — checklist, not open design). Builds against the **frozen F-27 surface** (soft dep) and the shipped voice path (F-10/F-11).

**Core decisions (resolved):**
- **Seam:** new `LearnerUtteranceCapture` + `LearnerUtteranceRegistry` (in `apps/agent/src/voice/`) — direct copies of `ExplainBackCapture`/`ExplainBackCaptureRegistry`, keyed by **sessionId only** (no targetItemId), prosody stripped. Injected into `createServer` via a `latestLearnerUtteranceFor(sessionId)` getter, mirroring `explainBackTranscriptFor`.
- **FILL THE SEAM (the CLAUDE.md half-bug):** the `VoiceBridge` gains an injected `onLearnerUtterance?(text)` callback fired from `handleTranscript` on each `role==='learner'` chunk; `createServer` wires it to `utteranceRegistry.setLatest(sessionId, text)`. The production wiring is half the feature and gets its own first-class test — a fail-closed input nothing fills is a gate nobody can pass.
- **Trigger:** NEW append-only `ClientEvent` kind `spoken_turn { sessionId }` — **NO transcript/question field** (reusing `learner_question` is rejected: its required `question` string IS the forbidden client-trusted path). The server reads `latestLearnerUtteranceFor(boundSessionId)`; empty → honest no-op (`ack`), never answer a client string.
- **Routing:** the trigger builds a synthetic in-process `learner_question` event and runs it through the **same** generic turn (`proposeWithTimeout` → `answer_question`), so off-topic folding + topic classification + the text reply come for free. **NO new ServerMessage** — `answer_question` already carries `question`+`answer` and `actionAdapter.ts` already surfaces both. Add append-only optional `spoken: true` on the `answer_question` Action so F-27 renders the learner side as a spoken bubble (fail-safe default = typed).
- **WS binding:** thread `boundSessionId` into `FrameOptions` (it currently lives only in the `ws.on('message')` closure); the trigger keys off the bound id, not the frame's `sessionId` (the MR !8 deletion-scheduling rule).
- **Not-configured degrade:** no LiveKit env → registry stays empty → `spoken_turn` fails closed to "voice unavailable"; no crash; typed Q&A intact (AC#6).
- Explain-back seam UNCHANGED (sibling). voice_turn: NOT double-logged (the spoken Q&A persists as an `answer_question` row; `voice_turn` stays the bridge's concern).

**Frozen signatures** (see BUILD-PLAN-i7 §Frozen contracts): `LearnerUtteranceCapture`/`LearnerUtteranceRegistry`; `ServerDeps.learnerUtteranceRegistry?` + `ServerDeps.latestLearnerUtteranceFor?`; `VoiceBridgeOpts.onLearnerUtterance?`; `FrameOptions.boundSessionId?`; `ClientEvent` `spoken_turn { sessionId }`; `answer_question` optional `spoken`.

**Ordered checklist (integrity/adversarial tests first-class):**
- [ ] 1. (test) `LearnerUtteranceCapture`: learner chunks → `transcript()` latest; tutor chunks ignored; empty before any chunk.
- [ ] 2. Implement `learnerUtteranceCapture.ts` (copy/strip `explainBackCapture.ts`).
- [ ] 3. (test) `LearnerUtteranceRegistry`: `setLatest`/`latestFor` per session; sessionId-only key; unknown → undefined; empty string → undefined; no cross-session leak.
- [ ] 4. Implement `learnerUtteranceRegistry.ts` (copy/strip `explainBackRegistry.ts`).
- [ ] 5. **[CONTRACT — append-only, coordinate w/ F-27 wire add]** Add `spoken_turn` to `ClientEvent` + optional `spoken` to `answer_question`. Tests: `spoken_turn` parses with `{sessionId}` only and REJECTS any `transcript`/`question`; `answer_question` parses with/without `spoken`.
- [ ] 6. (test) VoiceBridge feed: a learner chunk fires `onLearnerUtterance(text)`; tutor chunks don't; absent callback no-ops. (The fill-the-seam guard.)
- [ ] 7. Implement `onLearnerUtterance` in `VoiceBridge.handleTranscript` (learner branch).
- [ ] 8. Thread `boundSessionId` into `FrameOptions`, set from `ws.on('message')`; document the WS-binding rationale.
- [ ] 9. **(integrity, adversarial)** `spoken_turn` with `sessionId` ≠ bound id does NOT answer the bound session's utterance; junk fields Zod-stripped, no client text reaches the answer.
- [ ] 10. **(integrity, adversarial)** No server capture → fails closed (`ack`/no-op), never an `answer_question` with client text; no row persisted.
- [ ] 11. Implement `handleSpokenTurnTurn`: read `latestLearnerUtteranceFor(boundSessionId)`; empty → `ack`+return; else synthetic `learner_question` through the generic turn, mark the action `spoken:true`. Dispatch before the generic block.
- [ ] 12. **(integration, agent suite, serialized)** A captured turn + `spoken_turn` routes through `learner_question → answer_question`; answered `question` = server-captured text; reply is TEXT; `spoken:true` crosses the wire.
- [ ] 13. **(integration)** An off-topic captured spoken question → `answer_question{off_topic}` persisted `app IS NULL`, increments `countOffTopicAnswers` identically to typed (AC#5).
- [ ] 14. End-to-end production-wiring test in `createServer`: `MockRealtimeSession` → bridge feed → `spoken_turn` → agent answers the captured text (the legitimate-path-fills-the-seam proof).
- [ ] 15. **(AC#6)** No LiveKit env → `spoken_turn` fails closed, no crash, typed Q&A still answers.
- [ ] 16. **(regression)** Explain-back integrity suite passes unchanged (registry/preconditions/judge untouched).
- [ ] 17. **(web, against frozen F-27)** `actionAdapter`/App test — `answer_question{spoken:true}` appends a `spokenTurn{speaker:'learner'}` + a tutor turn, interleaved; `spoken` absent → typed bubble.
- [ ] 18. **(F-32 contribution)** Add spoken-turn golden cases (topic classification, 100% offline) + live groundedness ≥90% bank per ADR-017. F-32 owns the harness.

**Open questions for Keith:** (1) trigger kind name `spoken_turn` — confirm (no collision with F-27's `intro_advance`). (2) reach the web transcript via optional `spoken` flag on `answer_question` (recommended) vs F-27 always rendering an `answer_question`'s `question` as a learner turn? (3) persist spoken Q&A as a `voice_turn` too, or is the `answer_question` row sufficient? (recommended: sufficient). (4) empty-capture no-op = quiet `ack` (recommended) vs visible "voice unavailable"? (5) does F-32 or F-30 own the `OpenAISpokenGroundednessJudge`?

**Invariants:** server-captured only, never the client frame; fail closed to empty; the legitimate path actually fills the seam; explain-back untouched (sibling); off-topic folds into the uncapped `countOffTopicAnswers`; `events.app IS NULL`; WS bound-session; append-only wire; TTS-out stays explain-back-only (reply is TEXT); `RealtimeSession` interface unchanged (add a getter).

## Implementation notes (filled in by the building agent)

### Resolved decisions

**D9 (spoken flag):** `answer_question.spoken` is forwarded through `actionAdapter.ts` in the `AdapterResult.answer` shape. App.tsx calls `appendSpokenTurn(prev, 'learner', question)` before `applyMount(answerSpec)` when `r.answer.spoken` is true — this gives the learner-bubble-then-agent-reply interleaving in order. Absent `spoken` → no learner bubble (typed path unchanged).

**D10 (trigger kind):** `spoken_turn { sessionId }` with NO transcript/question field. The Zod schema strips any junk fields a client attaches. The server Zod parse test + adversarial integration test both verify no client string survives.

**WS binding (item 8):** `boundSessionId` threaded through `FrameOptions` from the `ws.on('message')` closure. `handleSpokenTurnTurn` uses `effectiveSessionId = boundId` for ALL DB operations (utterance lookup, events insert, reply). A frame with a forged `sessionId` gets no row written under the victim session.

**Empty-capture no-op:** quiet `ack` (recommended) — the client knows the trigger was received without an error surfacing.

**Persist kind:** `spoken_turn` (not `learner_question`) with `capturedQuestion` field in the payload event so the replay shows the server-captured text.

### Assumptions

- The `learner_question` synthetic event reuses the full generic turn (BKT fold, learnerState update, proposeWithTimeout). This means a spoken Q&A DOES update `learner_state` — this is intentional (a spoken question is a legitimate turn).
- Off-topic spoken questions increment `countOffTopicAnswers` identically to typed ones because the synthetic `learner_question` is processed by the same fold. Confirmed by the integration test (item 13).
- The `appendSpokenTurn` for the learner side uses the server-captured question (from `r.answer.question`), which equals `action.question` since the stub sets `question: ev.question`. In production with a real LLM, the `action.question` will echo the captured text (the LLM receives it as the `learner_question` event).

### What downstream features inherit

- `PolymathServer.learnerUtteranceRegistry` is exposed for the production VoiceBridge to call `setLatest(sessionId, text)` via its `onLearnerUtterance` callback.
- `VoiceBridgeOpts.onLearnerUtterance?` is the callback slot. The production wiring in `createServer` would inject `(text) => utteranceRegistry.setLatest(sessionId, text)` when spinning up a VoiceBridge per session.
- The `SpokenTurn` shape in `surfaceState.ts` (from F-27) is what the transcript renders; F-30 calls `appendSpokenTurn` to produce it.
- F-32 owns `OpenAISpokenGroundednessJudge` + the live bank. F-30 contributed 3 topic-classification golden cases to `scenarios.json`.

### Blockers / deferred items

- The production VoiceBridge-to-registry wiring (connecting a live LiveKit session to `utteranceRegistry.setLatest`) is the deferred cross-platform device smoke — the same pattern as the explain-back seam. The seam EXISTS and the unit test proves the bridge fires the callback; binding a live session awaits real keys + devices.
- `TTS-out stays explain-back-only` per spec: the spoken-Q&A reply is TEXT (`answer_question`), not synthesized speech. This is intentional.
- `voice_turn` double-logging: spoken Q&A does NOT produce a `voice_turn` row — only a `spoken_turn` row. The spec confirmed "the `answer_question` row is sufficient."
