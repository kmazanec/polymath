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

## Implementation notes (filled in by the building agent)
