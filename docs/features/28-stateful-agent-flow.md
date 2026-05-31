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
- [ ] 1. New `deliberation.ts`: `LearnerProgress`, `PedagogicalIntent`, `DeliberationMemory`, `DeliberationContext`, `emptyMemory()`.
- [ ] 2. Failing unit tests for `assess`: snapshot table → expected `LearnerProgress`; assert it reads ONLY server-derived fields (never `event.correct`/client flags).
- [ ] 3. Implement `assess(input, memoryIn): LearnerProgress` (pure). Green #2.
- [ ] 4. Failing unit tests for `decide`: classification → `PedagogicalIntent`.
- [ ] 5. Implement `decide(...)` (pure). Green #4.
- [ ] 6. Widen `MoveProvider.proposeMove` with optional `deliberation?: DeliberationContext` (+ the type) in `client.ts`. Verify Heuristic/OpenAI/test-doubles compile unchanged. **Do NOT touch `TacticalMove`/`F26_MENU`/`toTacticalMove`.**
- [ ] 7. Thread `deliberation` through `proposeAction`'s two `proposeMove` call sites. Existing graph/proposeAction tests stay green.
- [ ] 8. Extend `FlowState` (graph.ts) with `memoryIn`/`classification`/`intent`/`memoryOut` channels.
- [ ] 9. Rewrite `buildAgentGraph` as the 5-node linear graph; `realize` calls `proposeAction(provider, input, {classification,intent,memory})`; `validate` re-affirms `validateLayer2`; `emit` builds `memoryOut`. **Document the `realize` F-29 seam.**
- [ ] 10. **AC#5 proof** — failing test: keyless graph emits the SAME wire Action as the single-node graph for a representative turn set (session_start, correct/wrong/repeat-miss submit, request_hint, learner_question, transfer pass/fail). Golden snapshot.
- [ ] 11. `FlowAgentClient`: per-session `memory` Map, thread `memoryIn`/`memoryOut`, size-cap, fix the stale doc comment.
- [ ] 12. Test: memory threads across same-session turns; different session starts fresh; memory NEVER read by any gate/correctness path (AC#3).
- [ ] 13. New `makeAgentClient.ts` (self-gating factory).
- [ ] 14. Test `makeAgentClient`: no key → `StubAgentClient`; key set (mock provider, no network) → `FlowAgentClient(OpenAIMoveProvider)`. No real key in test.
- [ ] 15. **Wire `index.ts:44`** `new StubAgentClient()` → `makeAgentClient()` + a boot log of the selected provider. (THE AC#4 FIX.)
- [ ] 16. Update the agent integration suite: full turn loop over the new graph emits the SAME keyless wire Actions (mechanical updates only). **Run `pnpm --filter @polymath/agent test` ISOLATED.**
- [ ] 17. Verify `eval.test.ts` needs no scenario change (heuristic ignores arg 3). **F-32 owns `eval/` — make NO scenario edits.**
- [ ] 18. Manual live-LLM check (local key): a `learner_question` returns a real contextual answer (AC#4); `liveIt` still self-skips without a key.
- [ ] 19. Confirm `.gitlab-ci.yml` MR jobs get NO key (no edit needed; flag if one creeps in).
- [ ] 20. `pnpm typecheck` workspace-wide; agent suite isolated + non-agent projects separately (union authoritative).
- [ ] 21. Update `graph.ts` header (ADR-014 realize seam, ADR-006 provider selection) + Implementation notes (wiring-gap closure, memory-store location).

**Open questions for Keith:** (1) production-wiring-gap fix in F-28 scope? (recommended: yes — AC#4 is literally unsatisfiable without it). (2) deliberation memory in-process `Map` with size cap (lost on restart — fine, it's a cache) vs persisted? (recommended: in-process; persisting tempts a future reader to trust it as integrity). (3) `OpenAIMoveProvider` reads `deliberation` in its prompt in F-28 or defer to F-29? (recommended: defer — keep `openaiClient.ts` edit at zero to avoid F-29 collision).

**Invariants:** server-derived integrity (`assess` from the snapshot only); lockstep menu UNCHANGED; var-cap unchanged; `app IS NULL` (no new query); no key in MR jobs (factory self-gates); behavior-preserving keyless path (the #10 golden proof); 15s-timeout + retry/fallback/Layer-2 contract IDENTICAL; agent suite isolated-run authoritative.

## Implementation notes (filled in by the building agent)
