# Feature: Stateful agent deliberation flow + live LLM provider

**ID:** F-28 · **Iteration:** I7 · **Status:** Not started

## What this delivers (before → after)
**Before:** The inner agent is a single LangGraph `propose → emit` node with no memory ("instantiated fresh per turn"), and production hardcodes the keyless heuristic provider, so "Ask the tutor" returns one canned string.
**After:** The agent runs a real multi-node deliberation graph — assess the learner's progress → decide a pedagogical intent → realize it → validate → emit — with a small per-session deliberation memory threaded turn-to-turn; and when `OPENAI_API_KEY` is present the real LLM provider answers contextual questions, falling back to the heuristic when it is not.

## How it fits the roadmap
Second feature of I7. It restructures the agent flow (`apps/agent/src/agent/`) and wires the provider seam. It is behavior-preserving for the keyless path (the heuristic implements the same nodes deterministically), so existing agent suites stay green or take mechanical updates. It is the substrate F-29 (generation) plugs its `realize` node into.

## Requirements traced (from the PRD)
The brief's *"the system should guide, assess, remediate, and know when the learner is ready"* and *"how does the system know whether the learner is confused, practicing, guessing, pattern-matching, or ready to advance?"* — currently scattered in a heuristic `if` ladder; this makes `assess` and `decide` explicit, named, testable nodes.

## Dependencies (must exist before this starts)
None hard — builds on the shipped agent flow + the frozen `Action`/`AgentInput` contracts. (Best sequenced after F-27 so the new agent decisions are observable in the coherent surface, but F-28 does not consume F-27's behavior.)

## Unblocks (what waits on this)
- F-29 (validator-gated generation) — its generation step IS the `realize` node of this graph; F-29 hard-depends on F-28.

## Contracts touched
- **`Action` schema** (source of truth: ADR-005) — consumed unchanged; the graph still compiles every tactical move down to the four locked wire variants.
- **Mastery gate predicate** / **inner-agent flow** (source of truth: ADR-003 / ADR-006 / **ADR-014**) — the `MoveProvider` interface widens minimally to carry deliberation state in/out; the validate/emit tail keeps the unchanged retry-once → fallback-bank → `no_action` contract, Layer-2, and the 15 s timeout.
- The provider-selection seam (source of truth: ADR-006) — `OpenAIMoveProvider` when keyed, heuristic otherwise.

## Acceptance criteria (product behavior)
1. The agent flow is a multi-node `StateGraph` (assess → decide → realize → validate → emit); each node is independently testable.
2. `assess` produces a named learner-progress classification (e.g. stuck / progressing / guessing / over-hinting / ready) from the server-derived snapshot — not from raw client flags.
3. A small per-session deliberation memory is threaded turn-to-turn (e.g. last intent, last difficulty, regeneration count) and is **derived/cached, never the integrity source** — BKT/streak/gates remain the server fold.
4. With `OPENAI_API_KEY` set, "Ask the tutor" returns a real contextual answer to the learner's actual question; without a key, the keyless heuristic answer path is unchanged.
5. The keyless path is behavior-preserving: existing agent integration suites pass (isolated-run authoritative per CLAUDE.md) or take only mechanical updates.
6. All existing safety holds: Layer-2 recompute, earned-it gates, server-minted mastery, var-cap, `app IS NULL`, server-recomputed correctness — none changed.

## Testing requirements
- Unit: each graph node in isolation (assess classification over snapshots; decide intent over classifications; validate reject/retry path).
- Integration (agent suite, serial, owns the DB): the full turn loop for submit / hint / question / transfer across the new graph, asserting the same wire Actions the heuristic produced before for the keyless path.
- Provider seam: keyed vs. keyless selection; the MR-pipeline secret rule respected (no provider key in MR jobs; live LLM eval stays on the protected/`main` path).

## Manual setup required
`OPENAI_API_KEY` for the live-LLM path locally and on the protected branch (the keyless path needs none). No key in MR pipelines (CLAUDE.md rule).

## Build plan (kmaz-plan-iteration, I7 — 3-draft panel; verified against code 2026-05-31)

**Tier: Sonnet** + one Opus-review checkpoint (on the keyless behavior-preservation proof and the wiring-gap fix). The hard reasoning is resolved here; the build is redistribution + wiring.

**Core decisions (resolved):**
- 5-node **linear** `StateGraph` `assess → decide → realize → validate → emit`. The retry-once→fallback→no_action loop stays a **pure function inside `realize`** (the reused `proposeAction` body), NOT modeled as graph cycles — so behavior-preservation is provable, not re-derived. `assess`/`decide`/`validate`/`emit` are **pure & deterministic** (keyless-safe); the provider is called ONLY in `realize`.
- `assess` produces a NAMED `LearnerProgress` (stuck/progressing/guessing/over_hinting/ready) from the **server-derived snapshot only** (never client flags). `decide` → `PedagogicalIntent` (advisory; the heuristic keeps its own policy and may ignore it, so keyless output is byte-identical).
- Deliberation memory = a `Map<sessionId, DeliberationMemory>` on **`FlowAgentClient`** (graph is compiled once, so per-turn graph state can't hold cross-turn memory), threaded in/out via graph channels. **Derived/cached, never integrity** (AC#3). Size-capped.
- **THE WIRING GAP (in scope):** `index.ts:44` hardcodes `new StubAgentClient()` (heuristic-only); `OpenAIMoveProvider` is constructed NOWHERE in production. AC#4 is unsatisfiable today. Fix: a `makeAgentClient()` factory (OPENAI_API_KEY present → `FlowAgentClient(new OpenAIMoveProvider())`, else `StubAgentClient`) mirroring `makeExplainBackJudge`/`makeOpenAiBaselineChatProvider` self-gating; wired at `index.ts:44`. Tests construct clients directly → no key in MR pipelines.
- AC#4 "real answer" needs ONLY the wiring — `answer_question` is already a `TacticalMove` arm, already compiled, already emitted by `OpenAIMoveProvider.toTacticalMove`. No new answer-path code.
- 15s timeout stays in `server.ts proposeWithTimeout` (outside the graph). The `realize` node is **the single F-29 generation seam** — documented so F-29 fills it without reshaping the graph.
- **NO menu change** — `TacticalMove`/`F26_MENU`/`toTacticalMove` untouched (F-28 redistributes, doesn't extend the menu). The MoveProvider widens only via an **optional 3rd param** (`deliberation?`), so every existing provider compiles unchanged.

**Frozen signatures** (see BUILD-PLAN-i7 §Frozen contracts): `LearnerProgress` / `PedagogicalIntent` / `DeliberationMemory` / `DeliberationContext` (new `apps/agent/src/agent/deliberation.ts`); `MoveProvider.proposeMove(input, validationError?, deliberation?)`; extended `FlowState` channels; `makeAgentClient(): AgentClient`. All **agent-internal** — NOT `@polymath/contract`.

**Ordered checklist:**
- [x] 1. New `deliberation.ts`: `LearnerProgress`, `PedagogicalIntent`, `DeliberationMemory`, `DeliberationContext`, `emptyMemory()`.
- [x] 2. Failing unit tests for `assess`: snapshot table → expected `LearnerProgress`; assert it reads ONLY server-derived fields (never `event.correct`/client flags).
- [x] 3. Implement `assess(input, memoryIn): LearnerProgress` (pure). Green #2.
- [x] 4. Failing unit tests for `decide`: classification → `PedagogicalIntent`.
- [x] 5. Implement `decide(...)` (pure). Green #4.
- [x] 6. Widen `MoveProvider.proposeMove` with optional `deliberation?: DeliberationContext` (+ the type) in `client.ts`. Verify Heuristic/OpenAI/test-doubles compile unchanged. **Do NOT touch `TacticalMove`/`F26_MENU`/`toTacticalMove`.**
- [x] 7. Thread `deliberation` through `proposeAction`'s two `proposeMove` call sites. Existing graph/proposeAction tests stay green.
- [x] 8. Extend `FlowState` (graph.ts) with `memoryIn`/`classification`/`intent`/`memoryOut` channels.
- [x] 9. Rewrite `buildAgentGraph` as the 5-node linear graph; `realize` calls `proposeAction(provider, input, {classification,intent,memory})`; `validate` re-affirms `validateLayer2`; `emit` builds `memoryOut`. **Document the `realize` F-29 seam.**
- [x] 10. **AC#5 proof** — failing test: keyless graph emits the SAME wire Action as the single-node graph for a representative turn set (session_start, correct/wrong/repeat-miss submit, request_hint, learner_question, transfer pass/fail). Golden snapshot.
- [x] 11. `FlowAgentClient`: per-session `memory` Map, thread `memoryIn`/`memoryOut`, size-cap, fix the stale doc comment.
- [x] 12. Test: memory threads across same-session turns; different session starts fresh; memory NEVER read by any gate/correctness path (AC#3).
- [x] 13. New `makeAgentClient.ts` (self-gating factory).
- [x] 14. Test `makeAgentClient`: no key → `StubAgentClient`; key set (mock provider, no network) → `FlowAgentClient(OpenAIMoveProvider)`. No real key in test.
- [x] 15. **Wire `index.ts:44`** `new StubAgentClient()` → `makeAgentClient()` + a boot log of the selected provider. (THE AC#4 FIX.)
- [x] 16. Update the agent integration suite: full turn loop over the new graph emits the SAME keyless wire Actions (mechanical updates only). **Run `pnpm --filter @polymath/agent test` ISOLATED.**
- [x] 17. Verify `eval.test.ts` needs no scenario change (heuristic ignores arg 3). **F-32 owns `eval/` — make NO scenario edits.**
- [ ] 18. Manual live-LLM check (local key): a `learner_question` returns a real contextual answer (AC#4); `liveIt` still self-skips without a key. *(No OPENAI_API_KEY in this build environment — keyless path confirmed; live check requires a key.)*
- [x] 19. Confirm `.gitlab-ci.yml` MR jobs get NO key (no edit needed; flag if one creeps in). *(Confirmed: `when: never` on `merge_request_event` for key-bearing jobs.)*
- [x] 20. `pnpm typecheck` workspace-wide; agent suite isolated + non-agent projects separately (union authoritative).
- [x] 21. Update `graph.ts` header (ADR-014 realize seam, ADR-006 provider selection) + Implementation notes (wiring-gap closure, memory-store location).

**Open questions for Keith:** (1) production-wiring-gap fix in F-28 scope? (recommended: yes — AC#4 is literally unsatisfiable without it). (2) deliberation memory in-process `Map` with size cap (lost on restart — fine, it's a cache) vs persisted? (recommended: in-process; persisting tempts a future reader to trust it as integrity). (3) `OpenAIMoveProvider` reads `deliberation` in its prompt in F-28 or defer to F-29? (recommended: defer — keep `openaiClient.ts` edit at zero to avoid F-29 collision).

**Invariants:** server-derived integrity (`assess` from the snapshot only); lockstep menu UNCHANGED; var-cap unchanged; `app IS NULL` (no new query); no key in MR jobs (factory self-gates); behavior-preserving keyless path (the #10 golden proof); 15s-timeout + retry/fallback/Layer-2 contract IDENTICAL; agent suite isolated-run authoritative.

## Implementation notes (filled in by the building agent)

**Resolved decisions (confirmed):**

1. **5-node linear graph.** `assess → decide → realize → validate → emit` implemented as a LangGraph `StateGraph`. The retry-once→fallback→no_action loop stays inside `proposeAction` (realize's inner body), NOT modeled as graph cycles — behavior-preservation is provable, not re-derived.

2. **Production wiring gap closed.** `apps/agent/src/index.ts:44` previously hardcoded `new StubAgentClient()`. F-28 adds `makeAgentClient()` factory (`apps/agent/src/agent/makeAgentClient.ts`). With `OPENAI_API_KEY` set: `FlowAgentClient(new OpenAIMoveProvider({apiKey}))`. Without: `StubAgentClient`. Mirrors `makeExplainBackJudge` / `makeOpenAiBaselineChatProvider` pattern. Boot log line confirms selected provider.

3. **Deliberation memory location.** In-process `Map<sessionId, DeliberationMemory>` on `FlowAgentClient`, size-capped at 1000 entries (oldest-first eviction). Lost on restart (intentional — it's a cache). `FlowAgentClient.memory` is `private` — no public getter, no path from any gate/integrity consumer to this field.

4. **`assess` reads ONLY server-derived LearnerSnapshot.** The TypeScript type enforces this: `LearnerSnapshot` has no `correct` field; the assess function takes a `LearnerSnapshot` parameter. The golden test (AC#5) and the `@ts-expect-error` in the deliberation test both confirm this structurally.

5. **Heuristic provider ignores deliberation context.** `HeuristicMoveProvider.proposeMove(input, validationError?)` satisfies `MoveProvider.proposeMove(input, validationError?, deliberation?)` because the 3rd param is optional. The heuristic ignores it — so the keyless path is byte-identical to pre-F-28 behavior (proved by the golden.test.ts AC#5 suite, 11 turn-types verified).

6. **F-29 seam is documented in graph.ts.** The `realize` node comment states: `*** F-29 SEAM: the generation step plugs into THIS node. ***` F-29 overrides the `provider.proposeMove(input, error, deliberation)` call for `intent === 'practice'` when generation is enabled, without reshaping the graph topology.

7. **`OpenAIMoveProvider` deliberation context.** Per the build plan recommendation (D: defer), `openaiClient.ts` is NOT modified in F-28. The deliberation arg is available to the OpenAI provider via the optional 3rd param, but F-28 does not add it to the prompt. F-29 owns that enhancement — keeping `openaiClient.ts` at zero edits in F-28 avoids the F-29 collision zone.

8. **`validateLayer2` node.** Explicit `validate` node in the 5-node graph re-affirms Layer-2 on the action returned by realize. This is belt-and-suspenders (realize's `proposeAction` already validates); the explicit node makes the invariant visible in the graph topology and ensures any future realize-override (F-29) cannot accidentally bypass Layer-2.

9. **Test file breakdown:**
   - `deliberation.test.ts` (11 tests): assess/decide unit tests with snapshot table
   - `golden.test.ts` (11 tests): AC#5 keyless behavior-preservation golden proof
   - `memory.test.ts` (5 tests): memory threading across turns + AC#3 integrity isolation
   - `makeAgentClient.test.ts` (3 tests): factory behavior, no real key used

10. **Downstream inheritance (F-29):**
    - `graph.ts`'s `realize` node is the seam: replace/wrap `provider.proposeMove(input, error, deliberation)` with the generation call when `state.intent === 'practice'`
    - `FlowState.intent` channel carries the string intent into the realize node
    - `proposeAction` remains the retry/fallback wrapper — F-29's generation either succeeds (returning a validated action) or falls through to the existing fallback path
    - `makeAgentClient()` does NOT need to change for F-29 (it already wires `OpenAIMoveProvider`)
    - `deliberation.ts` types are stable: F-29 reads `DeliberationContext.intent` to decide whether to generate
