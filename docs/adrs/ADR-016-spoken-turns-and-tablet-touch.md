# ADR-016: Spoken responses are first-class tutoring input (server-captured, fed to the LLM tutor, in the transcript), and the surface is tablet-first / touch-native

**Status:** Accepted · **Date:** 2026-05-31 · **Stretch:** no
**Supersedes:** the *Inputs* and *Multi-device* clauses of [ADR-004](./ADR-004-modalities-and-sensors.md) · **Refines:** [ADR-006](./ADR-006-voice-and-agent-llm-stack.md), [ADR-008](./ADR-008-frontend-and-client-architecture.md), [ADR-012](./ADR-012-stretch-features-for-nerdy.md) · **Related:** [ADR-015](./ADR-015-coherent-learning-surface-transcript.md) · **Superseded by:** none
**Contract:** yes — adds a server-captured general-utterance transcript seam (mirrors the explain-back registry) and a touch-target design contract; no client-sent transcript, no reshaped wire payload.

## Context

[ADR-004](./ADR-004-modalities-and-sensors.md) scoped voice to **three uses** — the explain-back gate, the anti-cheat integrity signal, and conversational Q&A — and chose **mouse/keyboard as the primary input** with **multi-device out of scope**. In the shipped product the first two are wired (the `VoiceBridge` + `ExplainBackCaptureRegistry`) but the third — *conversational Q&A by voice* — was never connected: the "Ask the tutor" voice button opens a realtime channel, the tutor *hears* the learner, but **nothing transcribes a general spoken turn and feeds it to the agent**, and nothing puts the spoken turn into the conversation. The student's spoken feedback is, today, used nowhere outside the explain-back window.

Two things have also changed in intent since ADR-004:

1. **The LLM is the front-line tutor.** Its job is to help the student learn — to *hear* what they say, confirm understanding, and re-instruct when they're not getting it. A tutor that can't use the student's spoken response is not a tutor. ADR-004's "voice for conversational Q&A" clause anticipated this; it was simply never built, and it must become a first-class input, not an afterthought.
2. **The target surface is a tablet.** The product is now meant to be used touch-first: everything draggable, tappable, with finger-sized targets. ADR-004's "mouse/keyboard primary, multi-device out of scope" is no longer the design center. This is a genuine change of direction, so it gets a superseding ADR rather than a silent edit.

## Decision

### 1. Spoken responses are first-class tutoring input — captured server-side, fed to the LLM, and recorded in the transcript

- **The student's spoken turn is captured and transcribed server-side** via the existing realtime path (`RealtimeSession` → `VoiceBridge`), extended with a **general-utterance capture seam** that mirrors the explain-back registry: a per-session getter (e.g. `latestLearnerUtteranceFor(sessionId)`) backed by the bridge, returning the learner's most recent spoken text — **keyed by session, outside the explain-back item scope.**
- **The LLM tutor answers the spoken turn** through the *same* decision path as a typed `learner_question`: the server feeds the server-captured transcript to the agent as the question input, the agent replies in **text** (confirming understanding, or giving more instruction when the learner is struggling), and the reply renders as an `AgentAnswer`.
- **Both the spoken turn and the tutor's reply are transcript turns** ([ADR-015](./ADR-015-coherent-learning-surface-transcript.md)): the conversation the learner scrolls back through is the whole tutoring dialogue, spoken and typed alike.
- **The integrity boundary is preserved exactly.** The transcript that the agent answers is read **only from the server-side capture seam, never from a client frame** — the same rule that protects explain-back (CLAUDE.md: "an integrity input must come from a server-captured source, never the client frame"). The client signals *that* the learner spoke (a trigger), it does **not** send the transcript text. A `ClientEvent` carrying a `transcript` the server trusts is explicitly forbidden — it would recreate the forgery path. General Q&A is lower-stakes than explain-back (it gates nothing), but it uses the same airtight seam so there is one capture discipline, not two.
- **TTS-out stays scoped to the explain-back prompt** (ADR-004's output asymmetry is *not* superseded): the tutor replies to spoken Q&A in **text**, which is also what makes the reply a durable transcript turn. Full-duplex spoken tutor replies were considered and deferred (see Options).

### 2. The surface is tablet-first and touch-native

- **Touch is a primary input**, co-equal with mouse/keyboard (not a secondary afterthought). Every interaction works by touch: toggling truth-table cells, **dragging gates**, wiring the circuit, editing pseudocode, pressing Test, and the new forward affordances.
- **Finger-sized touch targets.** All interactive controls meet a minimum target size of **44×44 px** (the WCAG 2.5.5 / platform HIG floor), with adequate spacing so adjacent targets aren't mis-hit. This extends ADR-012's accessibility posture (which set contrast + keyboard-first) with a *pointer/target-size* standard.
- **Drag is touch-first.** The gate canvas (react-flow) and any draggable element use pointer events that work under touch, with drag handles large enough for a finger and generous hit-slop.
- **Multi-device is still out of scope** — this is single-device, but that single device is now assumed to be a **tablet** (or a touch laptop), not a mouse-only desktop. We are not adding phone-camera/cross-device sensor fusion (ADR-004's deferral of *that* stands).

## Options considered

**Spoken-input source — A: client POSTs the transcribed text** as a normal `learner_question.question`. Simplest, reuses the text path verbatim. *Rejected as the model of record* because it makes the answered text client-supplied — tolerable for ungated Q&A, but it splits capture discipline (explain-back from the server seam, Q&A from the client) and invites the forgery pattern CLAUDE.md warns against. **B: server-captured turn IS the input (chosen)** — one capture discipline, no client-trusted transcript, mirrors explain-back.

**Tutor reply modality — C: text reply (chosen).** Keeps ADR-004's output asymmetry, makes the reply a durable transcript turn, smaller build. **D: full-duplex spoken reply (TTS).** Richer, but broadens the TTS-out surface ADR-004 deliberately kept narrow, is a substantially larger build, and a spoken-only reply leaves no transcript record unless separately transcribed. *Deferred* — a future ADR can revisit once text-back is proven.

**Touch posture — E: responsive tweak only** (let the existing mouse UI reflow). *Rejected* — finger targets and touch-native drag are a design contract, not a media query; a 24px icon button doesn't become tappable by reflowing. **F: tablet-first touch-native design contract (chosen)** — an explicit 44px target floor + touch-first drag, enforced in review.

## Consequences for the build

- **Source of truth:** the general-utterance seam lives beside the explain-back seam in `apps/agent/src/voice/` (extend the `VoiceBridge`/registry; do **not** reshape the `RealtimeSession` interface — add a getter). The agent input assembly in `server.ts` gains a path: a spoken-turn trigger reads the captured utterance and routes it through the existing `learner_question` → `answer_question` flow (no wire reshape; the answered question is the **server-captured** text).
- **Touch design contract:** the 44px target floor + touch-native drag is a cross-cutting UI contract (ROADMAP table), enforced across every interactive component (`apps/web/src/components/*`, the react-flow canvas, the new I7 forward affordances). The axe/accessibility suite extends with target-size checks.
- **Invariants preserved (all unchanged):**
  - **The integrity boundary** — server-captured transcript only, never a client frame; fail-closed to empty. General Q&A gates nothing, but uses the same seam.
  - **Explain-back is untouched** — its registry, preconditions, and LLM judge are exactly as shipped; the general seam is a *sibling*, not a modification.
  - **TTS-out stays explain-back-only** (ADR-004 output clause not superseded).
  - **The topic guardrail** still bounds spoken Q&A (ADR-003) — an off-topic spoken question folds into the same uncapped off-topic counter as a typed one.
  - High-frequency interaction stays client-only; the statechart spine and the locked contract are untouched.
- **What this supersedes in ADR-004:** the *Inputs* clause ("mouse/keyboard primary; voice for Q&A" → now "touch co-primary; spoken Q&A actually wired as first-class input") and the *Multi-device* framing ("mouse-only desktop assumed" → "tablet/touch assumed, still single-device"). ADR-004's voice-rationale, anti-cheat thesis, pulse, and output asymmetry all stand.

## Status note

Accepted as the architectural basis for the I7 voice-Q&A and tablet-touch features (ROADMAP I7). The implementing features carry the build detail; the explain-back integrity seam is the pattern to copy, not modify.
