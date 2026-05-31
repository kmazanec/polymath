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

## Implementation notes (filled in by the building agent)
