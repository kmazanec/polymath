# ADR-003: Macro statechart owns lesson boundaries and mastery transitions; a bounded inner agent owns intra-lesson tactics

**Status:** Accepted · **Date:** 2026-05-27 · **Stretch:** no
**Supersedes:** none · **Superseded by:** none

## Context

The brief is unusually demanding about *when* the UI changes and *what the interface refuses to change automatically*. A weak submission, per the brief, is "a chat app that occasionally swaps in a chart" or "a content path with a flashy adaptive wrapper." A strong submission "makes us believe the interface itself is part of the tutoring."

This forces an architectural commitment: *something* must own the rules of UI change and be defensible to a CTO. The choices range from "the LLM decides everything" (chaotic, brief explicitly penalises) through "a state machine decides everything" (rigid, fails the brief's "feels alive" requirement) to various hybrids.

[ADR-001](./ADR-001-learning-domain-boolean-logic.md) commits to Boolean logic with a curriculum arc; [ADR-002](./ADR-002-curriculum-scope-and-mvp-cut.md) commits to the MVP+stretch+capstone cut. This ADR locks the control structure that makes those decisions enforceable.

## Options considered

**A — Pure generative UI: LLM emits component trees each turn.** The brief explicitly rejects this. Weak submission territory. Unstable, unsafe (a11y, XSS), unauditable, untestable.

**B — Pure rule-based / state-machine UI.** Statechart owns every transition; LLM only fills slot content; no agent reasoning at runtime. Maximum defensibility, minimum felt-alive-ness. Would handle the brief's "interface refuses to change automatically" beautifully but fail the "feels alive, anticipatory" requirement. Also makes the inner-loop adaptive remediation hand-coded — every "if the learner is stuck on NAND, do X" becomes a hand-tuned rule, which scales badly across lessons and is exactly the kind of thing modern LLMs do better than hand-coded heuristics.

**C — LLM-as-co-equal: agent and state machine both have authority.** The agent can override the state machine; the state machine can override the agent. Ill-defined; will result in fights at runtime. Rejected.

**D — Statechart-owns-when, LLM-owns-what — simple split.** Statechart decides phase transitions; LLM decides component choice within a phase and writes content. Cleaner than C but the LLM's authority over component choice is still a place chaos can enter — the brief penalises gratuitous UI churn, and a freeform "pick a component" decision is exactly the failure mode that produces churn.

**E — Macro-statechart + bounded inner agent with a fixed action menu + conversational Q&A on-topic (chosen).**
- The macro-statechart owns lesson-to-lesson transitions, intra-lesson phase transitions (`introducing`/`practicing`/`hint`/`assessed`/`transferring`/`mastered`), and *all* mastery decisions. Statechart guards are the truth-maker for any transition.
- An inner agent, scoped to a single lesson at a time, has authority to *propose* moves from a constrained menu: `next_practice_item`, `worked_example`, `rephrase`, `simpler_item`, `alt_representation`, `propose_mastery_transition`, `propose_transfer_probe`, `answer_question` (on-topic Q&A).
- Statechart guards veto invalid proposals. The agent cannot bypass mastery rules. The agent cannot mount components outside the curated registry. The agent cannot leave the topic.
- The agent's Q&A authority is bounded by a *topic guardrail*: questions about Boolean logic, the current lesson's content, prior lesson recall, and clarification of the workspace are answered; off-topic questions are deflected with a stock response and a redirect.

## Decision

**The control structure is option E.** Concretely:

```
Macro statechart (XState):
  states: lesson_1 -> lesson_2 -> lesson_3 -> lesson_4 -> playground
  Each lesson is a sub-statechart with phases:
    introducing -> practicing -> {hint_ladder, transferring} -> assessed -> {mastered, remediating}

  Transitions between states are GUARDED by mastery rules:
    - lesson_N -> lesson_N+1 requires mastery_gate_satisfied(lesson_N)
    - practicing -> mastered requires rule_gate AND transfer_probe_passed
    - mastered -> next_lesson is automatic after a "lesson_complete" UI moment

Inner agent (per-lesson, stateless per turn):
  Inputs: learner's recent attempts, hints used, response times, behavioral signals,
          BKT estimate for current KC, voice/explain-back transcript, current phase,
          last 3 turns of conversation history.
  Output: one structured action from the menu:
    | next_practice_item(difficulty_tier)
    | worked_example(form)
    | rephrase(target: current_item)
    | simpler_item(target: current_item)
    | alt_representation(target: current_item, rep: 'circuit' | 'symbolic' | 'pseudocode')
    | propose_mastery_transition()
    | propose_transfer_probe(held_out_rep: 'circuit' | 'symbolic' | 'pseudocode')
    | answer_question(question: str)  -- bounded by topic guardrail
  The agent's action goes through the statechart's transition layer.
  Statechart's guard evaluates the action against rules; accepts or rejects.

Topic guardrail (LLM-based classifier with deterministic fallback):
  Classify each incoming question as on-topic (Boolean logic, current lesson,
  workspace usage) or off-topic. On-topic -> agent answers. Off-topic -> deflect
  with a stock response and a redirect to the current task.
```

The agent is **instantiated fresh per turn** with only the structured state and recent history — no long-running session memory beyond what the statechart and the learner-model store explicitly. This is deliberate: it makes the agent's decisions reproducible (we can replay) and makes the responsibility split clean (no hidden agent state).

The agent has access to the curated component registry as a *menu of actions*, not as a *render API*. The agent picks an action; the statechart-driven renderer mounts the corresponding component. The agent never emits JSX, HTML, or a component name as a string — it picks from a typed enum.

## Rationale

This split lines up exactly with the brief's explicit demands and rejections.

1. **"What your interface refuses to change automatically"** — the statechart's guards are the literal answer. We can put the statechart diagram on slide 2 of the demo deck and point at the refusals. *Refuses* to leave a lesson mid-practice without mastery. *Refuses* to declare mastery without transfer + explain-back. *Refuses* to bring back a scaffold during a transfer probe even if the learner asks. Each refusal is a guard in code we can show.

2. **"How the system anticipates learner needs"** — the inner agent is the answer. Bounded by a menu so it cannot wander; informed by behavioral signals (response time, hint usage, BKT estimate) so it adapts; structured so we can log every decision and play it back.

3. **"Hyperresponsive but not chaotic"** — chaos is impossible because the agent's output space is finite and typed. Hyperresponsiveness comes from the agent's per-turn re-evaluation against fresh signals. The bounded menu makes "the UI changed for a reason we can name" structurally true.

4. **Defensible to Dalmia specifically.** An ex-Amazon/Google VP Eng who values "ownership and craftsmanship" will recognise this as the engineering-discipline answer to a problem that lazy submissions will hand to the LLM. The statechart is the contract; the agent is the inference. Separation of contract and inference is FAANG-engineering vocabulary.

5. **Conversational Q&A with topic guardrails** preserves the felt-alive tutor relationship without opening the system to off-topic drift or hallucinated content. The deflection-on-off-topic move is itself a *visible* affordance in the demo ("I can answer Boolean-logic questions; for help with your essay, here are Nerdy's other tools") that signals product judgment.

6. **The architecture extends past Boolean logic.** Swap the curated component library, swap the content validator, swap the held-out transfer bank — the statechart and inner-agent abstraction work for any domain. This is what makes the architecture itself the artifact, independent of the chosen domain.

## Tradeoffs & risks

- **The agent's bounded menu may miss situations the menu didn't anticipate.** A learner could be stuck in a way that needs an action not in the menu (e.g., "show a video," "switch to a real-world analogy I haven't catalogued"). Mitigation: the menu is versioned; we will instrument "agent wanted an action not in menu" as a logged event and use that to grow the menu deliberately between iterations. Initial menu has 8 actions; this is enough for Lessons 1+2.
- **Conversational Q&A is a hallucination risk** if the agent answers Boolean-logic questions incorrectly. Mitigation: the content validator (Boolean equivalence checker) runs on any factual claim the agent makes that involves equivalence; misconception-prone topics (NAND universality, De Morgan's halfway application) have a hand-curated FAQ that the agent retrieves from rather than generates.
- **Topic guardrail false-negatives** (an on-topic question classified as off-topic) hurt the felt-alive-ness; false-positives (off-topic question answered) hurt the on-task-ness. Mitigation: defaults bias toward false-negative (deflect when uncertain), with a manual override affordance for the learner ("I think this is on-topic, please answer").
- **Statechart authoring cost.** A real XState statechart for the curriculum + intra-lesson phases is several hundred lines. Mitigation: invest in the statechart in week 1; treat it as the architectural spine; reuse the intra-lesson sub-statechart across lessons by parameterisation.
- **The agent's inference latency** (~500ms per turn for a structured-output call) could feel slow if every turn calls the agent. Mitigation: most turns *don't* need agent inference — only phase boundaries, hint requests, and transitions do. The high-frequency interactions (toggle a truth-table input, drag a gate) are pure-client, no LLM call.
- **Reproducibility:** the agent is non-deterministic. Mitigation: log every input and every action; provide a replay tool that re-runs the statechart against a captured action sequence. We test the statechart deterministically; we test the agent's behaviour statistically (eval suite over labelled scenarios).

## Consequences for the build

- **XState is the source of truth for the statechart** ([Round 4 — frontend & client] inherits this). Statecharts are visualisable via Stately Studio — this enables the "diagram on slide 2 of the demo deck" promise above.
- **The bounded action menu must be typed** (Zod schema or TypeScript discriminated union); structured-output from the agent must conform; runtime validation rejects malformed actions.
- **The agent runs server-side** (don't ship API keys to the browser). Action proposals come back over a WebSocket or SSE stream, mounted into the statechart's `send` interface.
- **Reproducibility infra is MVP**: every learner interaction is logged with enough context to replay. This becomes the basis for the demo's "baseline comparison" telemetry.
- **The curated component registry is a typed Map** from action-kind → React component, defined in one place; no string-keyed lookups; no dynamic imports.
- **The topic guardrail is a small classifier** — likely the same LLM call as the agent, with a `topic_classification` field in the structured output. The deflection text is templated, not generated.
- **All later UI/voice/vision ADRs inherit "bounded action menu" as the integration contract** — voice intents flow into the menu; vision OCR results flow into the menu; nothing bypasses the statechart.
