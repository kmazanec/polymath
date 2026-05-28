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

## Implementation plan (approved)

> **Decision (locked with Keith):** The wire `Action` union stays the 4 locked variants
> (`mount`/`transition`/`answer_question`/`no_action`, append-only per the `action.ts`
> docstring + CLAUDE.md). The tactical menu (`next_practice_item`, `rephrase`, `simpler_item`,
> `alt_representation`, `worked_example`, `propose_mastery_transition`) is the agent's
> **internal** decision vocabulary in `apps/agent/src/agent/menu.ts`; each move *compiles
> down* to one wire Action. The spec's "extend the Action union" language is superseded by the
> shipped contract design.
>
> **Decision (locked with Keith):** No `OPENAI_API_KEY` is set. Build the real
> `OpenAIAgentClient` + LangGraph flow + Layer-2 + fallback bank, fully exercised with a
> **mocked `AgentClient`**. Live GPT-5/GPT-5-mini calls + the LangSmith ≥95% eval gate
> (criterion #8) are wired but run only when a key exists — deferral documented honestly.

- [x] **Internal tactical menu** — `apps/agent/src/agent/menu.ts`: `TacticalMove`
      discriminated union (the ADR-003 menu) + pure `compileMove(move, ctx): Action` mapping
      each move to a wire Action (`next_practice_item`/`rephrase`/`simpler_item`/`worked_example`/
      `alt_representation` → `mount`; `propose_mastery_transition` → `transition`;
      `answer_question` → `answer_question`). Extensible by discriminator literal (F-06
      `propose_hint`, F-07 `propose_transfer_probe`). Unit-tested. *(criteria 1,2,3,4,5)*
- [x] **Widen `AgentClient`** — `apps/agent/src/agent/client.ts`: `propose(input: AgentInput)`
      where `AgentInput = { event, learnerState, lesson, recentHistory }`. Keep
      `StubAgentClient` conforming so F-01's integration test still passes.
- [x] **Layer-2 validator** — `apps/agent/src/agent/layer2.ts`: for a `mount` of an
      item-generating component, recompute `truthTable(targetExpression).out` (map →0/1) and
      compare to `claimedTruthTable`; cap distinct-var count first. Returns ok/mismatch.
      Unit-tested against every fallback item + an injected bad table. *(criterion 2,9)*
- [x] **Fallback bank** — `apps/agent/src/fallback_bank/lesson_1.json`: hand-curated L1 items
      per tier; loader is non-fatal; every item passes Layer 2 (unit test). Dockerfile already
      `COPY apps/agent` wholesale — no extra COPY needed (verified). *(criterion 9)*
- [x] **OpenAI provider** — add `@langchain/openai`; `apps/agent/src/agent/openaiClient.ts`:
      `withStructuredOutput` against the `TacticalMove` Zod schema; model routing (fast default,
      strong for mastery/transfer); reads `INNER_AGENT_*`/`OPENAI_API_KEY`; single retry on
      schema/Layer-2 failure then `no_action`. *(criterion 6)*
- [x] **Prompt** — `apps/agent/src/agent/prompt.ts`: system prompt (persona, enumerated menu,
      rationale expectation, topic guardrail) + per-turn user prompt (snapshot + history).
- [x] **LangGraph flow** — expand `graph.ts`: snapshot → classify → branch → per-move arm →
      emit (compile + Layer-2 + log). Provider injected (mockable). *(criteria 1,3)*
- [x] **Server wiring** — `server.ts` `handleClientFrame`: build `AgentInput` (load lesson via
      `loadLesson`, read `learner_state`), call `propose`, keep `validateOutboundAction`,
      persist structured log (`rationale`, `validation:{layer,status,detail}`, snapshot) into
      `events.payload`. Wrap `propose` in a timeout (F-01 build note). *(criteria 7,10)*
- [x] **Web inner-loop wiring** — `App.tsx`/`ws`: stop discarding `send`; adapter feeds inbound
      `action` into the statechart (`mount`→render proposed spec; `transition`→`send`
      LessonEvent); normalize the 3 reps' `onSubmit` → `submit` `ClientEvent`; question textbox
      → `learner_question`; render `AgentAnswer` (incl. off-topic deflection). Registry threads
      `onSubmit`/`hiddenReps`; real `AgentAnswer` case. *(criteria 1,4,5)*
- [x] **Tests** — Layer-2 unit; `compileMove` unit; property test (every retry path → conforming
      Action or `no_action`, never malformed); in-process WS integration with a **mocked**
      `AgentClient` asserting Action-sequence patterns; web adapter test. *(testing requirements)*
- [x] **LangSmith eval scenarios (data) + skipped-without-key runner** — criterion #8 (≥95%)
      authored as labelled cases; gate runs live only with a key. **Deferred & documented.**

## Implementation notes (filled in by the building agent)

### Architecture as built

- **Two-layer agent seam.** `MoveProvider.proposeMove(input, validationError?)` is the raw
  reasoning step (returns one internal `TacticalMove`); `AgentClient.propose(input)` is the
  *flow* (snapshot → propose → Layer-2 validate → retry once → fallback → compile to a wire
  `Action`). The flow is provider-agnostic and fully tested with a deterministic double, so
  the OpenAI provider is a drop-in. `AgentInput` widened the old bare-`ClientEvent` seam to
  `{ event, lesson, learnerState, recentHistory }`.
- **The wire `Action` union was NOT extended** (locked, append-only). The tactical menu lives
  in `apps/agent/src/agent/menu.ts` as `TacticalMove`; `compileMove` maps each move to one of
  the 4 wire variants. This honored the contract design over the spec's literal "extend the
  union" wording (decision recorded above).
- **Layer 2 (`agent/layer2.ts`)** recomputes `truthTable(targetExpression).out` and compares
  to `claimedTruthTable` for the 3 item-generating `mount` kinds; non-item Actions pass
  trivially. Var-count capped at 10 before enumeration. The retry/fallback contract lives in
  `proposeAction` (graph.ts): one model retry carrying the validation error, then a
  hand-curated `fallback_bank/lesson_1.json` item (re-validated), then `no_action`.
- **Key-free heuristic provider** (`HeuristicMoveProvider`, exported as `StubAgentClient`)
  drives the loop without an LLM: `session_start`→mount first item, `submit`→next item (or
  mastery transition when `ruleGatePassed`), `learner_question`→on/off-topic answer. This is
  what runs in dev, the smoke test, and CI. The OpenAI provider replaces only the *provider*,
  not the flow.
- **Web inner-loop wiring**: `ws/actionAdapter.ts` (pure, node-tested against the real
  statechart) maps a server `Action` → `{ lessonEvent?, mount?, answer? }`; `App.tsx` stops
  discarding `send`, mounts the proposed `ComponentSpec`, normalizes the 3 reps' `onSubmit`
  to a `submit` event, and adds a "ask the tutor" box → `learner_question` → `AgentAnswer`.

### Decisions + their rationale

- **session_start now mounts the lesson's first item** (was `no_action`). Found during the
  smoke test: the intro has no submit affordance, so without a kickoff the learner could
  never reach a workspace through the UI. Mounting item 0 on session start is what makes the
  spec's "the learner does an L1 practice item" true end-to-end.
- **`createServer`'s `allowedOrigins` is now env-driven** (`ALLOWED_WS_ORIGINS` in `index.ts`
  + compose). The CSWSH origin check previously hard-coded `localhost:5173/8080`; the WS
  upgrade returned **401** for any other serving origin (incl. the droplet's
  `https://polymath.biograph.dev`). F-01 never connected the loop so it never surfaced. This
  is a deployment-config fix, not a contract change.
- **Heuristic advance matches itemId OR canonical expression.** The rep `ComponentSpec`s carry
  no `itemId`, so the web names the current item by its expression on submit; the provider
  matches on either so the loop advances regardless of caller.

### Verification (evidence, not assertion)

- **Unit/integration green:** full workspace `pnpm test` → **257 passed, 4 skipped**
  (the 4 skipped are DB-gated seed tests in the unfiltered run); the agent integration suite
  ran its own throwaway Postgres and passed all 6 (incl. the new submit-sequence + Q&A
  patterns). `pnpm typecheck` clean across 5 packages; `pnpm build` succeeded.
- **Layer-2 / retry property (criteria 2,6,9):** `flow.test.ts` proves first-valid (1 call),
  one-retry-on-mismatch (2 calls, error threaded), persistent-malformation→fallback-bank
  item, provider-error→fallback, exhausted-bank→`no_action`, and the property that *every*
  outcome `Action.parse`s regardless of provider behavior.
- **Deploy-packaging lens (CLAUDE.md blind spot):** `docker build` the agent image, then
  `docker run … ls /app/apps/agent/src/fallback_bank/` → `lesson_1.json` present; and
  `@langchain+openai@0.3.17` present in the image `node_modules`. Boot-time bank load is
  non-fatal (degrades to empty).
- **Step-7 smoke (real stack, heuristic agent), `docker compose up` on :8091, driven via
  Chrome DevTools MCP:**
  - On load: `region "Truth table for A AND B"` mounted (the kickoff item) — DOM quoted.
  - Toggled the correct output cell, clicked Submit → `region "Truth table for A OR B"`
    (the loop advanced to the next item) — **criterion 1 verified end-to-end**.
  - Asked "what does an AND gate output?" → `region "Answer"` with an on-topic reply
    (**criterion 4**); asked "can you book me a flight to Paris?" → `region "Off-topic
    redirect"` with the stock deflection (**criterion 5**).
  - No console errors. WS health/session/round-trip all 200/101.
- **Replay (criterion 10):** the integration test asserts `/api/session/:id/replay` returns
  each turn's `action.rationale` and `validation.status === 'pass'`.

### Deferred & documented (no `OPENAI_API_KEY` available)

- **Live GPT-5/GPT-5-mini inference** — `OpenAIMoveProvider` is built, typechecked, and wired
  (structured output + model routing + retry), but never invoked without a key. The flow it
  plugs into is fully tested with a deterministic double.
- **LangSmith ≥95% eval gate (criterion 8)** — labelled scenarios authored in
  `agent/eval/scenarios.json`; `eval.test.ts` asserts the heuristic provider agrees with all
  of them offline and runs the live OpenAI gate **only when a key is present** (skipped here).
  LangSmith tracing itself (env wiring) is F-20.
- **Postgres LangGraph checkpointer** — the graph runs in-memory; no criterion needs durable
  checkpoints in F-05 (replay is reconstructed from the `events` log). Noted for F-11's
  multi-step subgraph.

### Adversarial review (Step 6)

**Wave 1 (Opus × 2):** spec-compliance + security.
- *Spec:* 9/10 criteria MET; **criterion 3 MISSED** — the heuristic always advanced on submit
  and ignored correctness. *Fix:* added an optional append-only `correct` field to the `submit`
  wire event; a wrong submit now re-presents the item (`rephrase`) and a repeated miss on the
  same item drops to `simpler_item`. Re-verified MET (unit + integration + eval scenario + UI).
- *Security:* no high/medium. One low — unbounded learner-text fields — fixed by `.max()` on
  `submit.submission` / `transfer_submitted.submission` / `learner_question.question`.
- Also fixed F-3 (low, defense-in-depth): the wire boundary now downgrades a Layer-2-failing
  mount to `no_action` instead of logging-and-forwarding.

**Wave 2 (Sonnet × 2):** robustness + efficiency.
- *Robustness (important):* the criterion-3 fix was fragile — the web names the mounted item by
  its *expression* (the ComponentSpec carries no itemId), and `currentItem`/`pickLessonItem`
  were matching the *answer* (`submission`) instead, so a wrong answer misidentified the item
  and advanced anyway. Reproduced with a failing test, then fixed: items are identified by
  `itemId` (matched against both the lesson itemId and the targetExpression), never by the
  learner's answer. Verified end-to-end in the browser (a wrong AND submit re-presented
  "A AND B").
- *Efficiency (medium):* the LangGraph graph was recompiled every turn; now compiled once in
  `FlowAgentClient`'s constructor and invoked per turn (removed the now-dead `runAgentTurn`).
  Double-parse in Layer 2 noted as negligible at L1 scale (LLM dominates) — not changed.

### Step 7 smoke (post-fix, real stack via Chrome DevTools MCP)

`docker compose up` on :8091, heuristic agent: load → `region "Truth table for A AND B"`;
correct submit → advanced to `"A OR B"`; **wrong submit → re-presented "A AND B"** (criterion
3 confirmed in the real UI); on-topic question → answer; off-topic → "Off-topic redirect"
deflection. No console errors.

### Retro

1. **Learned about the system (→ propagated to ROADMAP cross-cutting notes):** the `submit`
   wire event gained an **optional append-only `correct: boolean`** field. The agent reads the
   client-computed verdict to decide its next move (wrong → re-present, not advance) without
   re-deriving correctness — consistent with ADR-008 (correctness is client-side). F-09's
   event-consumer should read this for the retry-ratio signal. Propagated to ROADMAP §
   Cross-cutting contracts (WebSocket message protocol row).
2. **Learned that changes the roadmap:** none material — the inner loop landed on the predicted
   contract surface. The one surprise was a *missing UX seam*: the intro had no affordance to
   reach the first item, so `session_start` now mounts item 0 (loop kickoff). F-13/F-15
   (lesson transitions) inherit this "mount-on-entry" behavior.
3. **Contract changed:** `submit.correct` (optional, append-only — does not break existing
   senders). Updated at its source of truth (`packages/contract/src/wire.ts`) + the ROADMAP
   note; no dependent re-sync needed (it's optional).
4. **Next builder should know (→ CLAUDE.md candidate):** the WS allowed-origins is now
   **env-driven** (`ALLOWED_WS_ORIGINS`); the droplet deploy must set it to
   `https://polymath.biograph.dev` or the WS upgrade 401s. Also: the rep `ComponentSpec`s carry
   **no itemId**, so the web names the mounted item by its *expression* — any agent logic that
   identifies "which item" must match on itemId/expression, never on the learner's `submission`
   (that's the answer; wrong on a miss). Both noted for F-06/F-07.

---

**Delivered in MR:** https://labs.gauntletai.com/keithmazanec/polymath/-/merge_requests/4 (unified I1 inner-loop batch: F-05/06/07/09).
