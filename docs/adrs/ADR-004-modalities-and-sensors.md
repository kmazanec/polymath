# ADR-004: Input modalities = mouse/keyboard + voice; Output modalities = three live representations + spoken tutor TTS + a learner-triggered pulse-through-the-circuit; skip multi-device for MVP

**Status:** Accepted · **Date:** 2026-05-27 · **Stretch:** no
**Supersedes:** none · **Superseded by:** none

## Context

The brief requires at least two input modes and two output modes, with a defended position on which signals are educationally meaningful versus gimmicks. It also calls out direct manipulation as non-negotiable and offers an optional multi-device path that must be defended if used.

[ADR-001](./ADR-001-learning-domain-boolean-logic.md) commits to Boolean logic with mastery defined as fluency across symbolic, circuit, and pseudocode representations. That domain has direct manipulation built into it (drag gates, toggle truth-table inputs, edit code). It does *not* have the strong handwriting workflow that physics or chemistry domains have — digital-logic learners typically work on screen.

This ADR locks the modality choices and articulates why each is meaningful rather than gimmicky for this specific domain.

## Options considered

### Inputs

**A — Mouse/keyboard only.** Minimum viable. Loses the felt-alive tutor presence the brief asks for; explain-back becomes typed-only (still a valid signal per Chi 1994, but weaker for hesitation/disfluency capture).

**B — Mouse/keyboard + voice in (chosen).** Voice drives conversational Q&A with the inner agent and the explain-back rubric step in the mastery transfer probe. Hesitation, retries, and verbal self-explanation are documented mastery signals (Chi 1994; Aleven & Koedinger 2002). With an audio-native model (see [Round 3 — realtime AI infra]), disfluency cues are captured directly rather than synthesized from STT.

**C — Mouse/keyboard + voice + phone-camera handwriting companion.** Adds the multi-device flex via a phone-as-document-camera. *Real* benefit for physics or chemistry sketching workflows; *weak* benefit for digital logic, where the natural workspace is the screen. Costs ~1 week of build time (pairing UX, capture UI, vision parsing, graceful-degradation, cross-platform testing).

**D — Mouse/keyboard + voice + stylus on iPad.** iPad-as-sketch-surface with Apple Pencil. Doesn't require phone-camera vision (native ink), but adds a device-pairing burden similar to C without addressing a real workflow gap for Boolean logic.

**E — Add facial-affect / eye-tracking via webcam.** Rejected upfront: privacy hostile (Nerdy sells into K-12, FERPA-adjacent), brief explicitly warns against "camera or sensors without a clear learning benefit," and the educational signal is unproven for this domain.

### Outputs

**F — Three live representations + tutor TTS + restrained motion (≤300ms, no animation during transfer probes).** Baseline output strategy.

**G — Three live representations + tutor TTS + restrained motion + learner-triggered "pulse through the circuit" animation on Test (chosen).** Adds an explicit test-action that animates signal propagation through the circuit: inputs evaluate in order, gates light up in propagation sequence, the corresponding truth-table row pulses simultaneously, and the pseudocode highlights the lines executing. The pulse is causal (traces actual execution) rather than decorative.

**H — Three live representations + text-only tutor (no TTS).** Cheaper, faster, less felt-alive. Voice in stays possible for explain-back; tutor response is text. Loses the "tutor presence" demo moment.

### Multi-device

**I — Single-device only for MVP and stretch (chosen).** Skip phone/tablet/peripheral devices. Boolean logic doesn't have a workflow that single-device meaningfully fails at.

**J — Single-device-primary + optional phone-camera companion with graceful degradation.** Keep as documented future direction in the Limitations memo, not built.

## Decision

**Inputs:** Mouse / trackpad / keyboard (primary direct manipulation) + voice in (conversational Q&A and explain-back).

**Outputs:** Three live representations (truth-table with togglable inputs, draggable gate circuit, syntax-highlighted pseudocode) + **a narrowly-scoped TTS channel used only for the explain-back prompt** + restrained motion + **a learner-triggered "pulse through the circuit" animation on Test**. All other system communication (hints, item intros, agent answers, celebrations) is text. The asymmetry — voice for the *prompt*, voice for the *response*, text everywhere else — reinforces the anti-cheat thesis: a learner cannot productively paste an LLM-generated response in the explain-back window because the input modality is voice and the timer is short, and the prompt itself is delivered audibly so the fastest path to a response is to start speaking.

**Multi-device:** Out of scope for MVP and stretch. Documented in the Limitations memo as a future direction worth ~1 week if the prototype evolves toward physics, chemistry, or geometry domains where handwriting workflows are genuinely native.

## Rationale

### Why voice in is meaningful, not gimmick

Voice serves three specific, brief-aligned purposes for this domain:

1. **The explain-back step in the mastery transfer probe.** When the learner is asked "why did you flip the operator there?" their verbal answer is a documented and citable signal of conceptual understanding versus pattern-matching (Chi et al. 1994; Aleven & Koedinger 2002 on the Geometry Cognitive Tutor's explanation prompts). Typed explain-back works but loses hesitation, restarts, and fluency cues that an audio-native model captures cheaply.

2. **Voice as an LLM-cheating defense.** This is, in 2026, the most novel and arguably the most important defense the modality provides. A learner who *types* an explanation can be reading off ChatGPT or another LLM running in a side panel — that is the dominant integrity threat for take-home and remote learning assessments today (Cotton, Cotton & Shipway 2024 on ChatGPT and academic integrity; Lancaster on contract-cheating's evolution). A learner who *speaks* an explanation, with real-time prosody, hesitation marks, restarts, and self-corrections, is producing the explanation themselves. The audio signal is hard to spoof — pasting an LLM transcript into a TTS produces a recognisably different cadence (Pratap et al. 2023 on synthetic-speech detection signals), and the realtime API can flag pauses-while-reading versus pauses-while-thinking as different prosodic patterns. Combined with a deliberately short explain-back window (e.g., 15 seconds), the learner has no time to consult an external LLM. This converts the explain-back from "a pedagogical signal" into "a pedagogical signal *and* an integrity signal" — which directly addresses the brief's explicit concern that learners might "succeed only while the UI is doing the reasoning for them." The brief's anti-false-positive language is not just about pattern-matching on items — it is about whether the *learner* is the locus of the reasoning. Voice produces evidence of that in a way no other modality does.

3. **Conversational Q&A with the inner agent.** A learner mid-practice can ask "what's the difference between NAND and NOT-AND?" and get an answer without leaving the workspace. Bounded by the topic guardrail (see [ADR-003](./ADR-003-statechart-plus-bounded-inner-agent.md)).

Voice is *not* used for content navigation ("next problem", "show hint") because keyboard/click is faster and more reliable. Voice is *not* the primary input channel — mouse and keyboard are. This is the answer to the brief's "which signals are meaningful, which are gimmicks": voice for explain-back, voice as anti-cheat-integrity-signal, and voice for conversational Q&A. Full stop.

### Why the pulse-through-the-circuit earns its motion budget

The brief penalises "prioritise animation over comprehension" and "generate decorative visuals." The pulse-through is on the right side of that line for three reasons:

1. **It is causal, not aesthetic.** The pulse traces actual signal propagation: inputs evaluate, gates compute in topological order, outputs latch. A learner watching it is reading execution semantics. This is the distinction Ainsworth (2006, DeFT framework) and Norman (1988) draw between informative and decorative motion.

2. **It is a fourth representation in disguise.** Symbolic, circuit, and pseudocode are static. The pulse adds a *temporal* representation — the same Boolean function unfolding in time. This deepens the cross-representation gym thesis (see [ADR-001](./ADR-001-learning-domain-boolean-logic.md)) by making causal order visible across all three views simultaneously (truth-table row pulses, gates light up, pseudocode line highlights).

3. **It is learner-triggered, not auto-playing.** The pulse runs when the learner presses "Test it" — never automatically on every input change. This satisfies the brief's "interface refuses to change automatically" requirement: gratuitous churn is structurally prevented because the learner owns the trigger.

Specific motion rules:

- One pulse per test action. Total propagation 600–1200ms (paced for readability, not snappiness — the pacing *is* the pedagogy).
- Color-blind-safe palette (avoid red/green for true/false; blue for active, gray for inactive, with shape/intensity differences).
- Suppressed during transfer probes (when the circuit view is hidden anyway).
- Reduced-motion toggle switches the pulse to a step-through "next gate →" interaction.
- Screen-reader announcement of propagation in text for accessibility.

### Why skipping multi-device is the right call here

For Boolean logic specifically, the phone-camera companion *does not solve a workflow gap*. Digital-logic learners learn on screens; circuit diagrams are not the kind of thing students sketch on paper as their primary workflow. The brief explicitly penalises "use camera or sensors without a clear learning benefit." Building multi-device for this domain would be doing it for the flex, not for the learner.

The week saved goes to deeper work on the mastery model and the chat-baseline comparison — the parts of the submission the brief most rewards.

The Limitations memo documents that for physics free-body diagrams, chemistry equation balancing, or geometry constructions, the phone-camera path would be defensibly useful. This is a *domain-conditional* decision, not a categorical rejection of multi-device.

### What we reject explicitly

- **Facial affect / eye tracking** — privacy hostile for Nerdy's K-12 audience (FERPA-adjacent), low signal, no domain-specific learning benefit.
- **Device motion / orientation** — no embodied-concept story for Boolean logic.
- **Background music / decorative animation / particle effects** — explicitly penalised by the brief.
- **Voice as the primary input channel** — keyboard/click is faster and more reliable for navigation; voice's role is explanation and Q&A.
- **Multi-device** — for THIS domain, no real workflow benefit; defensible *only* for handwriting-native domains.

## Tradeoffs & risks

- **Loss of multi-device demo flex.** A reviewer comparing our submission against one that demos a phone-camera handoff may see fewer "wow" moments. Mitigation: the pulse-through-the-circuit moment and the explain-back voice rubric are *our* wow moments and they are domain-justified. Lead with them.

- **Voice latency in production conditions.** Hesitation detection and barge-in (interruption) require <500ms turn-around; assembled STT→LLM→TTS stacks struggle here. This is a constraint that flows down to [Round 3 — realtime AI infra] (we will pick an audio-native realtime API).

- **TTS quality / pacing.** Bad TTS pacing reads as condescending or robotic. Mitigation: tune voice and pacing during week 3; consider ElevenLabs or the realtime API's native TTS rather than browser-default speech synthesis.

- **The pulse-through could be misread as decoration if implemented sloppily.** Mitigation: build it on the principle "every pixel of motion answers a question the learner just asked." No idle animation. No looping. No particles. The animation has a beginning, a payoff, and an end.

- **Voice-in adds a microphone-permission friction step.** Mitigation: defer the microphone prompt until the learner first wants to use voice (typically the explain-back step in the mastery flow), not at session start.

- **Voice-as-anti-cheat is imperfect.** A determined cheater could memorise an LLM-generated explanation in advance, or use a synthetic-speech tool. Mitigation: the explain-back window is deliberately short (~15s after a *novel* transfer item the learner has not previously seen), and the prompt asks the learner to explain *their specific work on the item in front of them* ("walk me through how you decided to flip the AND to an OR for THIS expression"), not the concept in general. Memorised general explanations don't fit. The signal isn't perfect, but it raises the cheating cost meaningfully above typed input.

- **Accessibility risk on the pulse animation.** Mitigation: reduced-motion preference is honored; screen-reader announces propagation; keyboard-only learners get a step-through alternative; color-blind-safe palette.

## Consequences for the build

- **Realtime voice stack must support audio-native input** (hesitation, disfluency, barge-in) — flows into [Round 3 — realtime AI infra] as a constraint.
- **The Pulse-through-the-circuit is a first-class component** in the curated registry; not an effects-layer afterthought. It takes a typed `Circuit` input plus a learner-triggered `pulse` action, computes a propagation schedule deterministically from the circuit topology, and renders the timeline.
- **Microphone permission UX** is deferred to first voice-use, not session start.
- **Component motion is governed by an explicit motion budget** — single static rule per component; transfer-probe phases set a `motionAllowed: false` flag on the renderer; reduced-motion preference is honored at the root.
- **The Limitations memo documents** the phone-camera companion as future work, with a one-paragraph defense of why it would be domain-justified for non-Boolean domains.
- **The chat-baseline comparison** (required by the brief as evidence) gets the saved week of build time — invest in a real side-by-side experiment scaffold, not a sketch.
- **No webcam access is requested at any point in the MVP** — verifiable property, recorded in the privacy posture.
- **The explain-back voice rubric is required**, not optional, for the mastery gate. The rubric checks (a) the learner used Boolean-logic vocabulary correctly, (b) the explanation references the *specific item* they just solved (not generic), and (c) the response timing and prosody do not indicate reading-from-elsewhere. This connects voice directly to the mastery gate ([Round 7](#)) as an *integrity* component, not just a pedagogical one.
