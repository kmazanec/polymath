# ADR-013: The free-build playground is its own micro-statechart (a sibling machine), not a substate of the locked lesson spine

**Status:** Accepted · **Date:** 2026-05-29 · **Stretch:** yes (ADR-012 stretch priority 5 — the L5 capstone)
**Supersedes:** none · **Superseded by:** none

## Context

[ADR-012](./ADR-012-stretch-features-for-nerdy.md) places a free-build *playground* last in the stretch order: a post-mastery capstone in which the learner proposes an arbitrary target Boolean function and the system challenges them to express it across the three reps, with the agent flipping from curriculum-director to equivalence-verifier and scaffold-on-request. [ARCHITECTURE.md Open Question 5](../ARCHITECTURE.md#open-questions) left undecided whether the playground should live as a new **substate inside the locked lesson spine** or as **its own micro-statechart** (a sibling machine composed after the lesson machine reaches its `mastered` final state).

This ADR resolves Open Question 5.

The lesson spine ([ADR-003](./ADR-003-statechart-plus-bounded-inner-agent.md), locked at iteration 0) is:

```
introducing → practicing → {hint, transferring} → assessed → {mastered, remediating}
```

Its phase set is the locked `PhaseName` contract enum; the project invariant is *"downstream features fill in guard bodies (`canDeclareMastery`, `canEndItem`), never re-shape the spine; a new phase needs a new ADR."*

## Options considered

**A — Add a `playground` substate (or sibling phase) to the lesson spine.** One machine, the playground reachable as a phase after `mastered`. *Rejected.* The locked phase shape is a **directed-practice grammar**: every transition presumes a server-picked item plus the BKT/streak/transfer folds that grade it (`practicing→assessed` is a *submit-and-grade*; `assessed→mastered` is the mastery gate; `practicing→transferring` is the rule gate). The playground has *none* of these — no item, no BKT, no streak, no transfer, no mastery write. Bolting a `playground` phase onto the spine would (a) re-shape the locked phase set, violating that lock, and (b) drag the directed-practice guards (`canEnterTransfer`, `canDeclareMastery`) into a mode where they have no meaning. It also forces `LESSON_PHASES`/`PhaseName` to grow, rippling into every exhaustive phase consumer.

**B — Its own micro-statechart, a sibling machine (chosen).** A separate `createPlaygroundMachine()` with its own small phase set (`proposing → building → checking → {satisfied, mismatch} → ended`; `mismatch → building`; any → `ended`). It imports **no** `PhaseName` and **no** `lesson.ts`; it composes *after* the lesson machine's `mastered` final state (the client instantiates it when the learner clicks the "Try the Playground" affordance on the L4 `MasteryCelebration`). The lesson spine — `lesson.ts`, `LESSON_PHASES`, `PhaseName` — is **untouched**, byte-for-byte.

**C — No statechart; manage playground UI state in React component state.** *Rejected.* The architecture's thesis is that XState owns *when the UI may change*; an ad-hoc `useState` machine for the playground would be the one mode where that discipline lapses, and the legal-transition guarantees (you cannot be `checking` before you `propose`; a `mismatch` only returns to `building`) would live in scattered conditionals instead of one auditable machine.

## Decision

**The playground is its own micro-statechart — a sibling machine — per Option B.** The locked lesson spine is not modified.

`createPlaygroundMachine()` (`packages/statechart/src/playground.ts`) defines:

- **States:** `proposing` (the learner is choosing a target expression) → `building` (the target is set; all reps editable) → `checking` (Submit pressed; the client-side cross-rep equivalence verdict is computed) → `satisfied` (all supplied reps equivalent to the target) or `mismatch` (at least one rep disagrees). `mismatch → building` (keep iterating). Every state can go to `ended` (the learner finishes → session-end celebration). `ended` is `final`.
- **No `PhaseName` import, no `lesson.ts` import.** The playground phases are deliberately a *separate* vocabulary; they are not added to `PhaseName`/`LESSON_PHASES`. The statechart test asserts `LESSON_PHASES` is unchanged, so a future edit that accidentally couples the two fails CI.
- **Composition, not nesting:** the web app runs the lesson machine to `mastered`, and only then — on the explicit affordance — instantiates the playground machine. They never run as one actor.

This honors the spine lock *literally*: the playground adds **no phase** to the spine. It also keeps the playground's "ungraded, no mastery write" nature structurally enforceable — the playground machine simply has no `mastered`/`assessed` states and no mastery guard to mis-fire.

## Consequences

- **Open Question 5 is resolved** (own micro-statechart).
- The lesson spine stays locked; `git diff` on `packages/statechart/src/lesson.ts` for this feature is empty (asserted by a test).
- The agent's role in the playground is **scaffold-on-request only** — a new lockstep menu move (`verify_playground_equivalence`) that compiles to a scaffold mount or `no_action`, **never** a mastery/lesson transition (the playground machine has no transition to grant). The correctness verdict is the **client-side** `playgroundEquivalence` call (preserving the locked "correctness off the network; the learner sees their answer marked before the agent decides" invariant); the server recompute is defense-in-depth for the persisted record only.
- Entry is gated by an **earned-it** server check: the playground entry turn re-derives L4 mastery from the (bounded, `app IS NULL`-scoped) event log and fails closed — the "Try the Playground" affordance is not a free door.
- Because the playground is a sibling machine reachable only after `mastered`, no `lessons/5/` content directory is created; entry is the dedicated `enter_playground` event, never the generic `advance_lesson` reflex (which would break on a missing `content.items[0]`).
