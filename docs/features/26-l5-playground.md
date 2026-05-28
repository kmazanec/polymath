# Feature: Lesson 5 — Playground (free-build capstone)

**ID:** F-26 · **Iteration:** I6 — Stretch · **Status:** Not started

## What this delivers (before → after)

**Before:** All lessons are directed practice — the agent picks items, the learner solves them. There is no free-build mode. The capstone demo flex per [ADR-002](../adrs/ADR-002-curriculum-scope-and-mvp-cut.md) is absent.

**After:** A playground mode where the learner proposes a target Boolean function (in any of the three reps) and the system challenges them to express it in the other two. Free-build mode is structurally different from directed practice — it lives in its own substate (or its own micro-statechart per Open Question 5 from ARCHITECTURE.md). The agent's role flips: it's no longer choosing the curriculum but rather verifying equivalence across the learner's reps and providing scaffolding when requested.

## How it fits the roadmap

I6, **fifth (last) stretch priority**. Often cut.

## Dependencies (must exist before this starts)

- **F-23** — L4 closes the curriculum; playground builds on the full vocabulary.

## Unblocks (what waits on this)

None.

## Contracts touched

- **Statechart spine** — adds a `playground` macro-state (decision per F-26 implementation: substate of an extended macro, or its own micro-statechart). Resolves [ARCHITECTURE.md Open Question 5](../ARCHITECTURE.md#open-questions).
- **`ComponentSpec`** — likely adds a new `PlaygroundCanvas` variant (the multi-rep simultaneous workspace).
- **Agent menu** — extends with a `verify_playground_equivalence` action.

## Sub-tasks

1. **T-26a — Decision: substate or micro-statechart** `[serial]`
   - Resolve Open Question 5 in this feature's planning.
2. **T-26b — `PlaygroundCanvas` component** `[parallel after T-26a]`
   - All three reps visible simultaneously, all editable.
   - The learner proposes a target via text/expression; can build in any rep.
   - On submit, all three reps are equivalence-checked against the proposed target.
3. **T-26c — Agent role: verifier + scaffold-on-request** `[parallel after T-26b]`
4. **T-26d — Entry from L4 mastery** `[parallel after T-26b]`

## Acceptance criteria (product behavior)

1. **A learner mastering L4 sees a "try the playground" affordance**; clicking it enters the playground mode.
2. **The learner proposes a target expression** via a text input.
3. **All three reps become editable simultaneously**; the learner can build in any.
4. **Pressing `Submit`** runs equivalence checks across all three reps against the proposed target and against each other.
5. **The agent provides scaffolding on request** but does not direct.
6. **The playground is exitable** back to a session-end celebration.

## Testing requirements

- Statechart test for the playground substate or micro-statechart.
- Integration test: full L1→L5 arc in a single session.
- Component test for PlaygroundCanvas.

## Manual setup required

None.

## Convergence and expected rework

None — F-26 is the last feature in the roadmap and runs strictly after F-23.

## Implementation notes (filled in by the building agent)

> Empty. Note: this feature resolves Open Question 5 from ARCHITECTURE.md (playground substate vs. micro-statechart). The decision belongs in T-26a and should be reflected in the implementation notes.
