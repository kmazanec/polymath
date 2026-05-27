# ADR-007: XState owns the UI-side statechart (browser); LangGraph owns the server-side multi-step agent flow; LangChain is a thin provider-abstraction layer

**Status:** Accepted · **Date:** 2026-05-27 · **Stretch:** no
**Supersedes:** none · **Superseded by:** none

## Context

[ADR-003](./ADR-003-statechart-plus-bounded-inner-agent.md) commits to a macro statechart plus a bounded inner agent.
[ADR-005](./ADR-005-adaptive-ui-runtime-contract.md) commits to a typed Action schema as the interface between the agent and the statechart.
[ADR-006](./ADR-006-voice-and-agent-llm-stack.md) commits to OpenAI Realtime via LiveKit Agents for voice and GPT-5 + GPT-5-mini for the inner agent.

The Nerdy challenge portal lists **LangChain** as a required AI/ML framework. We can either treat that as a check-the-box obligation or use it where it earns its keep.

In 2026, the LangChain ecosystem has split into three meaningful tools:
- **LangChain** (the original chain library) — provider abstraction, prompt management, callbacks.
- **LangGraph** (graph-based agent orchestration) — durable, replayable multi-step agent flows with conditional edges.
- **LangSmith** (eval + tracing) — chosen in [ADR-006](./ADR-006-voice-and-agent-llm-stack.md).

This ADR locks how those plug into the architecture, and how they coexist with XState (the UI-side state machine that has already been committed to as the source of truth for "when does the UI change").

## Options considered

**A — LangGraph owns *everything* including UI-side state.** A single graph with both server and client nodes. Conceptually clean. Loses XState's browser ergonomics, Stately Studio visualisation, and the ability to visualise the *UI* statechart on the demo deck (a high-value artifact for the brief's "what the interface refuses to change" requirement).

**B — Skip LangGraph entirely; LangChain only as a provider abstraction.** Minimal LangChain footprint, hand-coded agent multi-step reasoning. Lowest framework lock-in. The inner agent's multi-step rubric evaluation, transfer-probe construction, and explain-back judging would all be hand-rolled — feasible but reinventing what LangGraph is good at.

**C — Two state machines, one typed interface: XState (UI) + LangGraph (server-side agent) + LangChain (provider abstraction) + LangSmith (eval) (chosen).** XState owns the browser-side statechart that gates UI transitions. LangGraph owns the server-side multi-step agent flow — taking learner state in, running multi-step LLM reasoning, emitting a typed `Action`. The Action schema is the interface between them. Both state machines are independently visualisable.

## Decision

The orchestration is **split into two state machines with one typed interface**:

### XState — UI-side statechart (browser)

- Lives in the React app.
- Source of truth for the macro lesson arc (Lesson 1 → 2 → 3 → 4 → playground) and intra-lesson phases (introducing / practicing / hint / assessed / transferring / mastered).
- Visualised in Stately Studio. The diagram is a demo-deck artifact.
- Owns the three explicit refusals from [ADR-005](./ADR-005-adaptive-ui-runtime-contract.md) as guard predicates.
- Receives `Action` objects from the server; accepts or rejects each based on guards; sends `Event` objects to itself to drive transitions.
- All high-frequency UI interactions (toggle truth-table inputs, drag gates, edit pseudocode, run pulse) dispatch XState events directly; no server round-trip.

### LangGraph — server-side inner-agent flow

- Lives in the Node/TS backend (or a Python service if we hit ecosystem gaps).
- Source of truth for the multi-step reasoning each agent turn requires. Each agent turn is a LangGraph run.
- Typical graph nodes for a single agent turn:
  - **Snapshot** — read learner state, last 3 interactions, BKT estimate, behavioral signals.
  - **Classify** — what kind of turn is this? (mastery proposal, hint request, next item, question, no-op)
  - **Branch** — conditional edge to the appropriate subgraph.
  - **Subgraphs** (each is a small LangGraph): mastery rubric evaluation, transfer-probe constructor, hint generator, next-item picker, explain-back judger, topic classifier+answerer.
  - **Action emit** — assemble the final `Action` payload conforming to the [ADR-005](./ADR-005-adaptive-ui-runtime-contract.md) schema. Validate with Zod. Log to LangSmith.
- LangGraph's checkpoint feature is used for replayability — every agent run can be re-run against the same snapshot.
- The mastery rubric subgraph in particular benefits from LangGraph's multi-step structure: transcribe → classify the explanation → check for item-specific references → judge prosody disfluency → score against rubric → emit verdict. Six steps, each independently testable.

### LangChain — thin provider-abstraction layer

- Used **only** as the `LLM` interface for LangGraph nodes (`ChatOpenAI`, `ChatAnthropic`).
- Provides a uniform structured-output interface across providers, which matches the provider-agnostic abstraction committed to in [ADR-006](./ADR-006-voice-and-agent-llm-stack.md).
- *Not* used for prompt-template management, chains, agent loops, memory, retrievers, or any of the heavy framework features. Those are either handled by LangGraph (multi-step flow) or hand-rolled (prompts are small and benefit from being explicit TypeScript strings).
- This satisfies the Nerdy portal's "LangChain required" line honestly: LangChain is *in* the stack, doing the job it does best, not forced into a role it's no longer the right tool for.

### LangSmith — eval and tracing

- Already chosen in [ADR-006](./ADR-006-voice-and-agent-llm-stack.md).
- Native integration with LangGraph runs and LangChain LLM calls — every agent turn is automatically traced.
- Evals run against labelled scenario sets stored alongside the code in `evals/`.

## Rationale

This separation is the answer to a real tension. The brief demands a defensible, visualisable statechart for the UI side — "what the interface refuses to change automatically" needs a picture. LangGraph would not naturally produce that picture (its graphs are agent-flow graphs, not UI-state graphs). XState does, and Stately Studio makes it shareable.

At the same time, the agent's multi-step reasoning (especially the explain-back rubric, which has the most steps and the most need for replay) is exactly what LangGraph was built for. Hand-rolling it would be reinventing checkpointing, conditional edges, and trace integration for no gain.

**The two state machines do different jobs.** That distinction is itself defensible engineering — the UI's "when do I change" is a different problem from the agent's "what do I decide to propose." Combining them collapses two clean abstractions into one muddy one.

**The LangChain dependency is satisfied honestly.** We're not adopting LangChain to check a portal box; we're using its provider-abstraction layer because that's its 2026 sweet spot and it lines up with [ADR-006](./ADR-006-voice-and-agent-llm-stack.md)'s provider-agnostic recommendation.

**Defensibility for Nerdy specifically.** Dalmia (VP Eng) will recognise the dual-state-machine pattern from Amazon's internal frontend/backend separation; he'll respect the deliberate division and the explicit interface contract. Hunigan (VP AI) will recognise LangGraph as the production-grade agent orchestration choice — anyone shipping serious AI products in 2026 is using either LangGraph, Inngest agents, or a hand-rolled equivalent.

## Tradeoffs & risks

- **Two frameworks to learn and maintain.** Mitigation: the responsibility boundary is clear (UI ↔ Action ↔ server). Onboarding cost is paid once.

- **LangGraph in TypeScript vs. Python.** LangGraph-py is more mature; LangGraph-js exists and is improving but lags. Mitigation: start with LangGraph-js for stack uniformity (TypeScript everywhere); fall back to a Python LangGraph service if we hit ecosystem gaps for the mastery rubric subgraph.

- **LangChain's reputation in some engineering circles is over-abstracted and brittle.** Mitigation: we use the *minimum* surface — `ChatOpenAI` and `ChatAnthropic` with structured outputs. We don't use chains, prompts-as-objects, memory abstractions, retrievers, or vector stores from LangChain. Surface area we adopt is small enough that bugs in LangChain proper don't reach us.

- **Two state machines could disagree in subtle ways.** Mitigation: the Action schema is the only legal interface; both state machines are tested in isolation against schema-conformant inputs; we have an integration test that drives end-to-end scenarios.

- **Stately Studio is a paid product for non-trivial usage.** Mitigation: the free tier is sufficient for a 4-lesson statechart visualisation; the Stately team has historically been generous with educational/demo usage; worst case we screenshot the diagrams.

- **LangGraph's `checkpoint` requires durable storage** (typically Postgres or Redis). Mitigation: for prototype scale, SQLite-backed checkpointer is built-in and free; production migration is straightforward.

- **LangSmith vendor lock for traces** is real if we go off LangChain. Mitigation: OpenTelemetry traces ([ADR-006](./ADR-006-voice-and-agent-llm-stack.md)) cover the voice loop independently; LangSmith covers the LLM call layer; we can export LangSmith data if needed.

## Consequences for the build

- **`apps/web`** — Next.js app with React + XState. Owns the visible UI. Receives `Action` objects via WebSocket from the agent service.
- **`apps/agent`** — Node + LangGraph + LangChain (thin) + LangSmith (auto-tracing). Owns the inner-agent flow. Exposes a WebSocket endpoint for the web app to push learner-state snapshots and receive Actions.
- **`packages/contract`** — Shared TypeScript package with the `ComponentSpec` and `Action` Zod schemas, type-exported to both apps. Single source of truth for the interface.
- **`packages/statechart`** — XState statechart definitions; exported for the web app and also used in isolation for the Stately Studio visualisation.
- **`packages/graph`** — LangGraph definitions (snapshot, classify, branch, subgraphs, emit). Exported to the agent app.
- **`evals/`** — LangSmith scenario sets, run as part of CI; labelled cases for De Morgan's halfway application, NAND universality misconception, off-topic question deflection, explain-back rubric pass/fail, transfer-probe item construction, hint-ladder progression.
- **`docs/diagrams/`** — Exported XState diagrams (Stately Studio screenshots) and LangGraph mermaid renderings, both linked from [ARCHITECTURE.md].
- **The Action schema lives in `packages/contract`** and is imported by both `apps/web` and `apps/agent` — version-locked together. Any Action schema change is a coordinated PR across both apps.
- **The agent service exposes a `replay(sessionId, fromTurn)` endpoint** that re-runs the LangGraph graph against a checkpointed snapshot. This is the basis of the "agent rationale" demo artifact.
- **CI gate**: LangSmith eval suite must pass at >95% on the labelled scenario set before any merge to main.
