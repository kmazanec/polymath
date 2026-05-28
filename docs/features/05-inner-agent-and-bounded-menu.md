# Feature: Inner agent loop + bounded action menu

**ID:** F-05 · **Iteration:** I1 — Lesson 1 cross-rep gym · **Status:** Not started

## What this delivers (before → after)

**Before:** The agent service emits `no_action` for every event. The bounded action menu from [ADR-003](../adrs/ADR-003-statechart-plus-bounded-inner-agent.md) is declared but not wired. The learner can do a single item but the system has no inner loop — no "the agent proposes the next thing."

**After:** The agent's LangGraph flow takes a learner-state snapshot (recent submits, hints used, BKT estimate stub, current phase) and emits one typed `Action` per turn from the L1-active menu: `next_practice_item(tier)`, `worked_example`, `rephrase`, `simpler_item`, `alt_representation(rep)`. Calls GPT-5-mini for routing turns (most cases); GPT-5 for ambiguous ones. Layer 2 validation ([ADR-010](../adrs/ADR-010-content-correctness-and-validation.md)) confirms every agent-generated item's `claimedTruthTable` before the Action ships to the client. Schema-violation retries once, falls back to `no_action`. Every Action is logged with rationale.

After F-05 merges, the learner does an L1 practice item, sees a correct verdict, and within ~500ms the agent mounts the next item — *the inner loop exists*.

## How it fits the roadmap

I1, **on the critical path.** Gated by all three rep features landing (the agent must be able to propose mounts for at least the L1-active representations). Single sub-agent feature — internal file-edit parallelism is high-friction because every menu addition touches the same `packages/contract/src/action.ts`, `apps/agent/src/agent/menu.ts`, and LangGraph branch node.

**The single biggest single-feature risk in MVP.** See ROADMAP.md § Critical Path bottleneck risk 1.

## Dependencies (must exist before this starts)

- **F-01** — Action schema; LangGraph stub; WebSocket protocol; learner-state shape; provider abstraction (`AgentClient` interface).
- **F-02, F-03, F-04** — at least one rep landed so the agent's `mount` Action has a rendered target. (Strictly: F-03 is sufficient; F-02 and F-04 can land in any order.)

External: OpenAI API key with GPT-5 and GPT-5-mini access. LangSmith API key.

## Unblocks (what waits on this)

- **F-06** — Hint ladder extends the menu with `propose_hint(level)`.
- **F-07** — Transfer probe extends the menu with `propose_transfer_probe(held_out_rep)`.
- **F-09** — BKT + rule-gate consume the agent's emit log.
- **F-11** — Mastery proposal turn (extended menu) is gated by F-12 but built on F-05's flow.
- **F-14** — Cross-lesson recall is an additional menu item.

## Contracts touched

- **`Action` schema** — extends the union with the 5 menu variants. Locked at file-edit level: this is the only feature touching `packages/contract/src/action.ts` in I1 unless coordinated.
- **WebSocket message protocol** — consumes events from the client (`submit`, `learner_question`); emits Actions. No protocol change.
- **`ComponentSpec`** — consumes the existing variants; does not extend.
- **LangGraph flow** — introduces the multi-step inner-agent graph: snapshot → classify → branch → subgraph → emit. Lives in `packages/graph/inner-agent/`.
- **Provider abstraction (`AgentClient`)** — implemented for OpenAI (GPT-5 + GPT-5-mini). Anthropic implementation deferred.
- **LangSmith integration** — every agent run is traced; project = `polymath-dev` (or `polymath-eval` during CI).
- **Layer 2 validator** ([ADR-010](../adrs/ADR-010-content-correctness-and-validation.md)) — server-side check on `claimedTruthTable` before forwarding the Action. Introduced here, extended by F-22/F-23 with NAND/De Morgan gates.

## Sub-tasks

1. **T-05a — `AgentClient` provider abstraction + OpenAI structured-output impl** `[parallel]`
   - `interface AgentClient { propose(input: AgentInput): Promise<Action> }`.
   - `OpenAIAgentClient` uses `response_format: { type: 'json_schema', strict: true }` with the `Action` Zod-derived JSON schema.
   - Single retry on schema violation; persistent malformation returns `no_action`.
   - Model routing: GPT-5-mini by default; GPT-5 for mastery/transfer/explain-back turns (only `propose_mastery_transition` is in scope for F-05; rest land in F-07/F-11).
2. **T-05b — LangGraph inner-agent graph** `[parallel after T-05a]`
   - Nodes: snapshot (read learner state from DB), classify (what kind of turn?), branch (conditional edge), subgraph-per-turn-kind (next-item, rephrase, simpler-item, alt-rep, worked-example), emit (assemble + validate + log).
   - LangGraph checkpointer wired to Postgres for replay.
3. **T-05c — Layer 2 validator** `[parallel]`
   - For any item-generating Action (`mount` of `TruthTablePractice`/`CircuitBuilder`/`PseudocodeChallenge`), parse `targetExpression`, compute truth-table, compare to `claimedTruthTable`. Reject + retry on mismatch.
4. **T-05d — Fallback bank** `[parallel]`
   - `apps/agent/src/fallback_bank/lesson_1.json` — 5 hand-curated practice items per difficulty tier for L1. Used when agent fails twice in a row.
5. **T-05e — Prompt + system prompt with the bounded menu** `[parallel]`
   - System prompt: tutor persona, current lesson context, the menu enumerated, the rationale-field expectation.
   - Per-turn user prompt: learner state snapshot, recent history, classify task.
6. **T-05f — Eval scenarios in LangSmith** `[parallel]`
   - Labelled cases: 10–15 scenarios covering each menu item being the right choice; CI gate at ≥95%.
7. **T-05g — Statechart wiring on the web side** `[parallel after T-05b]`
   - Statechart `send` interface: incoming Action gets validated against the menu (already typed via Zod); guard checks against current phase; mount or reject.
8. **T-05h — Per-Action structured log** `[parallel]`
   - DB write: `(timestamp, eventKind, learnerStateSnapshot, agentInput, agentOutput, statechartDecision, statechartReason, rationale, validation:{layer,status,detail})`.

## Acceptance criteria (product behavior)

1. **After a learner submits a correct truth-table answer**, within 500ms the agent emits a `mount` Action for the next practice item; the new item appears on screen.
2. **The new item's `targetExpression` is one the agent computed**, and the `claimedTruthTable` field passes Layer 2 validation before reaching the browser.
3. **After a learner submits an incorrect answer twice on the same item**, the agent emits a `rephrase` or `simpler_item` Action (not `next_practice_item`), per the menu.
4. **When the learner asks a Boolean-logic question via the (yet-to-be-wired) voice or text channel**, the agent emits `answer_question(question, answer, topicClassification: 'on_topic')`. (Voice channel lands in F-10; for F-05, text-channel hookup is enough — a small textbox affordance for testing.)
5. **When the learner asks an off-topic question**, the agent emits `answer_question(..., topicClassification: 'off_topic')` and the rendered response is a stock deflection text.
6. **A malformed model response triggers exactly one retry**; persistent malformation falls back to `no_action`. Verifiable by mocking the LLM to return invalid JSON.
7. **Every Action emitted is logged with `rationale`** in the `events` table; the rationale is logged but *never displayed in the learner UI*.
8. **The LangSmith eval suite passes at ≥95% on the labelled scenarios** before merge to main (CI gate).
9. **Layer 2 validation rejection with retry then fallback** is demoable: inject a bad `claimedTruthTable` from the agent (test seam), observe one retry, then observe a fallback-bank item used.
10. **The replay endpoint `GET /api/session/:id/replay`** returns the full per-session event log including all Actions and rationales.

## Testing requirements

- Unit tests for Layer 2 validator: every `targetExpression` + `claimedTruthTable` pair in the fallback bank passes.
- LangSmith eval suite: 10–15 labelled scenarios per menu item; CI gate at ≥95%.
- Integration test (agent service in-process): drive a sequence of `submit` events through the WebSocket, assert the Action sequence matches expectation patterns (not exact strings — model nondeterminism).
- Property test: every retry path eventually emits a schema-conforming Action or `no_action`; never a malformed one.

## Manual setup required

- OpenAI API key with model access to `gpt-5` and `gpt-5-mini` (provisioned in F-01's `.env`, just confirm availability).
- LangSmith account + API key + projects created (`polymath-dev`, `polymath-eval`).
- 10–15 labelled eval scenarios hand-authored — this is roughly 1 day of Keith's time, schedulable during F-05 implementation.

## Convergence and expected rework

⚠ **Concentrated file-edit load** in `packages/contract/src/action.ts`, `apps/agent/src/agent/menu.ts`, the LangGraph branch node. Single sub-agent for F-05 to avoid intra-feature merge pain.

⚠ **Forward compatibility with F-06, F-07, F-11, F-14** — each extends the same menu union. F-05's design must leave room: discriminator literal, rationale field, structured-output schema all locked to extensible patterns. Coordinate with the F-06/F-07 sub-agent on the literal naming.

⚠ **LangSmith eval gate** is a CI hard-block. If the eval rate is <95% on first PR, the feature is *not* merged. Mitigation: tune the prompt with the eval bank during implementation; don't open the PR until the gate is green.

⚠ **Replay endpoint** in T-01e is stubbed in F-01 and becomes meaningful in F-05. The replay endpoint's output shape is locked once F-05 ships; downstream evaluators (Keith showing the demo) depend on it.

## Implementation notes (filled in by the building agent)

> Empty.
