# ADR-005: Hand-rolled typed component registry (~10–12 components) + agent emits structured Actions with logged rationales + LLM is called only at phase boundaries

**Status:** Accepted · **Date:** 2026-05-27 · **Stretch:** no
**Supersedes:** none · **Superseded by:** none

## Context

[ADR-003](./ADR-003-statechart-plus-bounded-inner-agent.md) commits to a macro statechart plus a bounded inner agent. This ADR locks the runtime contract that makes that architecture executable and defensible:

1. The shape of the typed component registry the agent picks from.
2. The agent's structured-output schema for proposing actions.
3. The concrete stability policy — what the interface explicitly refuses to do, and how each refusal is enforced.
4. The boundary between deterministic client-side interactions (high frequency, instant) and LLM-mediated decisions (phase boundaries, ~500ms tolerated).

The brief is explicit that "the interface refuses to change automatically" is a thing we must defend. The runtime contract is what makes those refusals enforceable rather than aspirational.

## Options considered

### Component registry

**A — Use Thesys or tambo as the rendering runtime.** Faster start; less code. Vendor takes responsibility for the schema/registry/validator pipeline. *Cost*: the policy of "when and why the UI changes" lives partially inside a vendor. The brief's most important defense becomes co-owned. Also: lock-in on the rendering layer, styling boundaries we don't control, pricing that scales per render.

**B — Hand-rolled typed registry with 10–12 components (chosen).** A TypeScript discriminated union for `ComponentSpec`, validated at runtime via Zod. Every legal UI state is something we designed and named; the LLM picks `kind` and fills slots from a typed schema; nothing else is mountable.

**C — Hand-rolled but minimal — 6–8 components.** Smaller surface area, faster initial build. Risk: too rigid to express the adaptive remediation menu the inner agent needs (rephrase, simpler item, alternative representation, worked example all need distinct components).

### Agent's structured-output contract

**D — Free-form natural-language proposals, parsed loosely.** Brittle. Schema-violation retry storms. Rejected upfront.

**E — Structured Action emit (chosen).** The agent emits exactly one typed `Action` per turn, validated server-side against a Zod schema. Malformed actions are retried once, then rejected silently to a no-op. Every action carries a `rationale: string` field that is logged.

### Stability policy — refusals

**F — One refusal: don't declare mastery without the gate.** Minimal. Misses the load-bearing transfer-probe refusal.

**G — Three explicit refusals (chosen).** (1) Interface refuses to end a practice item mid-attempt without explicit learner skip. (2) Interface refuses to bring hidden representations back during a transfer probe, even on learner request. (3) Interface refuses to declare mastery without all four conditions met. Each is a statechart guard, each is demo-able by "trying to break it."

**H — Four refusals (G + "interface refuses to reveal the answer").** Adds an integrity layer (no "give up and see"). Possibly worth it; risks feeling adversarial. Deferred — can be added in a later ADR.

### LLM scope

**I — LLM on every interaction.** Instant chaos, latency disaster, cost explosion. Rejected.

**J — LLM only at phase boundaries (chosen).** All high-frequency interactions (toggle inputs, drag gates, edit code, run pulse) are pure deterministic client-side. LLM is called at submit, hint request, item completion, learner question, explain-back recording end, mastery proposal. ~5–10 LLM calls per lesson, not per second.

**K — Add background "whispered" LLM calls** (e.g., periodic BKT-from-LLM probability updates, ambient sentiment). Adds cost and architectural complexity; pure-statistical BKT update is cheaper and more defensible. Rejected for MVP; documented as a stretch direction.

## Decision

### Component registry

A hand-rolled TypeScript discriminated union, ~10–12 components, validated at runtime with Zod:

```typescript
type Rep = 'truth_table' | 'circuit' | 'pseudocode';
type Gate = 'AND' | 'OR' | 'NOT' | 'NAND' | 'NOR' | 'XOR' | 'XNOR';

type ComponentSpec =
  | { kind: 'LessonIntro';          lessonId: 1 | 2 | 3 | 4; title: string; body: string }
  | { kind: 'IntroExplanation';     topic: string; body: string; visibleReps: Rep[] }
  | { kind: 'TruthTablePractice';   expression: string; visibleReps: Rep[] }
  | { kind: 'CircuitBuilder';       targetExpression: string; allowedGates: Gate[]; visibleReps: Rep[] }
  | { kind: 'PseudocodeChallenge';  targetExpression: string; visibleReps: Rep[] }
  | { kind: 'WorkedExample';        expression: string; steps: Step[]; visibleReps: Rep[] }
  | { kind: 'HintCard';             level: 1 | 2 | 3; body: string }
  | { kind: 'TransferProbe';        expression: string; hiddenReps: Rep[]; targetRep: Rep; itemId: string }
  | { kind: 'ExplainBackPrompt';    targetItemId: string; promptBody: string; maxDurationSec: number }
  | { kind: 'ConfidenceCheck';      targetItemId: string; scale: 1 | 2 | 3 | 4 | 5 }
  | { kind: 'MasteryCelebration';   conceptsMastered: string[]; nextLessonId?: number }
  | { kind: 'AgentAnswer';          question: string; answer: string; topicClassification: 'on_topic' | 'off_topic' }
```

Defining `Rep` and `Gate` as union types makes the cross-representation gym thesis enforceable at the type level — `visibleReps` and `hiddenReps` cannot be arbitrary strings. The renderer enforces visibility at mount time.

### Agent's structured-output contract

```typescript
type Action =
  | { type: 'mount';            component: ComponentSpec; rationale: string }
  | { type: 'transition';       to: PhaseName;            rationale: string }
  | { type: 'answer_question';  question: string; answer: string; topicClassification: 'on_topic' | 'off_topic'; rationale: string }
  | { type: 'no_action';        reason: 'wait_for_learner' | 'thinking' | 'agent_unsure'; rationale: string }
```

Every Action carries `rationale`. Every Action is logged with `(timestamp, learnerStateSnapshot, agentInput, agentOutput, statechartDecision, statechartReason)`. The full per-session replay is a deliverable artifact — see [Round 7 — evaluation & mastery instrumentation].

> **Clarification (F-01):** these four are the **wire** Action variants — the only shapes that cross the agent↔statechart boundary. The tactical menu in [ADR-003](./ADR-003-statechart-plus-bounded-inner-agent.md) (`rephrase`, `simpler_item`, `alt_representation`, `propose_transfer_probe`, …) is the agent's *internal decision vocabulary*; each such decision **resolves into** a `mount` or `transition` Action. The menu is not a competing union, and menu verbs must not be added to the wire `Action` type. (`sessionId` on the wire protocol is a server-minted UUID — validated as such at the contract boundary.)

Schema validation is enforced server-side using Zod. The LLM is prompted with the schema (via OpenAI structured outputs / Anthropic tool-use / equivalent), and any malformed response is retried once; persistent malformed output falls back to `no_action`.

### Three explicit refusals (the stability policy)

1. **Mid-item refusal.** The interface will not end a practice item until the learner has explicitly submitted, skipped, or requested a hint. Statechart guard: `canEndItem = learnerAction.kind in ('submit' | 'skip' | 'request_hint')`. The agent cannot propose advancing past an item the learner hasn't acted on.

2. **Transfer-probe refusal.** During a `TransferProbe` phase, any attempt to mount or transition to a representation listed in `hiddenReps` is rejected. The agent cannot bring back a hidden rep even if the learner explicitly asks. The learner sees a stock acknowledgement: *"During the transfer check, I'm keeping the circuit view off so you're showing me you can do this yourself. We can review it together right after."*

3. **Mastery-without-conditions refusal.** A transition to `mastered` requires all of: (a) rule-gate satisfied (3 consecutive correct at hardest tier, 0 hints on last 3 items, median response time 2–60s), (b) transfer probe passed from held-out bank, (c) explain-back rubric pass OR confidence-check pass with calibration, (d) topic-guardrail clean for the session. The agent can *propose* mastery; the statechart guard is the truth-maker.

Each refusal is a named guard predicate, named in the statechart, demonstrable in the demo as "watch what happens if I try to do X."

### LLM-only-at-phase-boundaries

| Interaction | Latency requirement | LLM involved? |
|-------------|---------------------|---------------|
| Toggle truth-table input | <50ms | No — pure JS |
| Drag a gate / connect a wire | <50ms | No — pure JS |
| Edit pseudocode | <50ms | No — pure JS (Monaco editor or similar) |
| Press "Test it" (pulse animation) | <50ms to start; ~1s animation | No — propagation schedule computed client-side from circuit topology |
| Submit answer | <500ms verdict | No for correctness (Z3/truth-table on client or server); Yes for agent's next-action proposal |
| Request hint | <500ms | Yes — agent proposes hint level + body |
| Item complete | <500ms | Yes — agent proposes next item or transition |
| Learner asks a question (voice or text) | <800ms | Yes — agent classifies topic + answers |
| Explain-back recording ends | <2s | Yes — rubric evaluation |
| Mastery proposal | <500ms | Yes — agent proposes; statechart gates |

The LLM is on the critical path roughly 5–10 times per lesson, not per second. The high-frequency loop (toggle, drag, test) is pure client-side. **This is what makes the system feel alive without making the LLM the bottleneck.**

## Rationale

This contract directly answers the brief's three hardest questions:

1. **"When does the UI change, and when does it refuse?"** — Statechart guards. Three named refusals. Diagrammed. Demo-able.

2. **"How does it adapt without becoming chaotic?"** — Hand-rolled typed registry; agent picks from a typed enum; LLM has no authority to mount anything we didn't design.

3. **"How does it feel alive?"** — High-frequency interactions are pure client-side and instant. LLM is reserved for the moments where judgment is genuinely needed.

For Nerdy's evaluators specifically:

- **Dalmia (VP Eng, ex-Amazon/Google)** will recognise the registry as a typed contract, the agent as a structured-output consumer, and the refusals as guard predicates. This is FAANG-engineering vocabulary — separation of contract and inference; deterministic interactions for hot paths; LLM only where its judgment earns the latency.
- **Hunigan (VP AI)** will see the bounded action menu as the responsible answer to LLM-driven UX — adaptive without abdicating control. Familiar from his AI-in-customer-service background where free-text-LLM products fail in exactly the ways the brief warns against.
- **The logged-rationale demo artifact** is the strongest single piece of evidence: a side-by-side replay of an actual session showing what the agent saw, what it proposed, and what the statechart decided. No other submission will have this.

## Tradeoffs & risks

- **Registry rigidity.** A learner-state we didn't anticipate may have no corresponding component. Mitigation: instrument "agent wanted to mount but no matching component" events; grow the registry deliberately between iterations. Initial 12 components cover Lessons 1+2 comfortably.

- **`rationale` field becomes a signature for prompt-injection or jailbreak attempts.** Mitigation: rationale is logged but never shown to the learner directly; it's a debugging/evaluation artifact. Adversarial prompts in the rationale don't reach the learner UI.

- **Structured-output retry latency.** A malformed Action triggers one retry, then `no_action`. Worst case adds ~500ms once per turn. Mitigation: prompt engineering and schema clarity to keep retry rate <1%.

- **Client-side correctness check** (Z3-in-WASM or truth-table compare in JS) ships ~200KB of validation code to the browser. Mitigation: lazy-load Z3 only when the learner submits something for the first time; truth-table compare alone is a few KB and handles 95% of cases.

- **The "interface refuses" demo moments could feel adversarial if not framed well.** Mitigation: the refusal copy is warm and explanatory ("I'm keeping the circuit view off so you're showing me you can do this yourself"). The refusal *acts in service of the learner*, not against them.

- **LLM-only-at-phase-boundaries means we lose some "ambient awareness" moments** — the agent doesn't know in real time that the learner is struggling until they submit or request help. Mitigation: client-side behavioral signals (cursor idle time, undo count, code edits) accumulate; the *next* LLM call gets a richer state snapshot. We don't need streaming awareness for adaptive remediation in this domain.

- **Registry maintenance cost.** Adding a new lesson means likely 1–2 new components. Mitigation: this is the right cost to pay; the alternative (LLM emits novel components) is what the brief rejects.

## Consequences for the build

- **`ComponentSpec` and `Action` are the central type definitions** — defined in one TypeScript file (likely `src/lib/registry.ts` and `src/lib/actions.ts`), imported everywhere, with Zod schemas auto-generated via `zod-to-typescript` or maintained manually with a single test that round-trips them.
- **The renderer is a switch on `ComponentSpec.kind`** — no dynamic component lookup, no `eval`, no `dangerouslySetInnerHTML`. Each component is a regular React component with typed props matching its branch of the discriminated union.
- **The statechart guards are typed predicates** — `canMountComponent(spec, currentPhase): boolean`, `canTransition(target, learnerState): boolean`, `canDeclareMastery(learnerState): boolean`. Each is unit-testable independently of the statechart.
- **Server-side LLM call layer** uses OpenAI structured outputs (or Anthropic tool-use with the same shape) with the `Action` Zod schema as the constraint. Single retry on schema violation. Cached prompts to minimise audio-token cost (see [Round 3]).
- **Per-session event log** is structured: `(timestamp, eventKind, learnerState, agentInput, agentOutput, statechartDecision, statechartReason)`. This is the basis of the replay tool and the chat-baseline comparison evidence.
- **The cross-representation enforcement** (`visibleReps` and `hiddenReps`) is honored at the component level — the `TransferProbe` component literally does not import or render `CircuitBuilder` when `circuit` is in `hiddenReps`. Compile-time and runtime guarantee.
- **The pulse-through-the-circuit animation** ([ADR-004](./ADR-004-modalities-and-sensors.md)) is computed from circuit topology in pure client-side code — no LLM round-trip — and is suppressed automatically when `circuit` is hidden.
- **The fourth refusal** ("interface refuses to reveal the answer") is *not* added in this ADR but is acknowledged as a future direction; if added later, it becomes a new ADR that supersedes nothing.
