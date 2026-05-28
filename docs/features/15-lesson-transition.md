# Feature: Lesson 1 → Lesson 2 macro transition

**ID:** F-15 · **Iteration:** I3 — Lesson 2 + cross-lesson recall · **Status:** Not started

## What this delivers (before → after)

**Before:** Mastering L1 mounts `MasteryCelebration` with a "continue to Lesson 2" button that does nothing (or routes via a dev-only URL param). The macro statechart's `lesson_1 → lesson_2` transition is not wired.

**After:** Mastering L1 triggers the macro statechart to transition into the lesson_2 sub-statechart. Learner state (session ID, BKT params for L1 KCs, accumulated behavioral signals) persists across the transition; L2 starts with `introducing` phase and the L1 KCs available to the agent for `recall_lesson1_kc` (F-14). A "continue to Lesson 2" button on `MasteryCelebration` triggers the transition; alternatively the agent can propose it via a `transition` Action.

After F-15 merges, a learner can complete L1 mastery and continue into L2 in a single session — the MVP's two-lesson arc is live.

## How it fits the roadmap

I3, **on the critical path**. Merge sink for I3. Convergence point for F-13 and F-14.

## Dependencies (must exist before this starts)

- **F-12** — L1 mastery declarable.
- **F-13** — L2 sub-statechart exists.
- **F-14** — recall action available in the agent menu (so L2 can demonstrate cross-lesson value immediately).

## Unblocks (what waits on this)

- **F-18** — SessionReport spans both lessons.
- **F-20** — observability dashboards reflect the L1→L2 traversal pattern.
- **F-21** — counter-metrics computed across both lessons.

## Contracts touched

- **Statechart spine** — adds the macro `lesson_1 → lesson_2` transition with a guard reading L1 mastery state.
- **`Action` schema** — possibly extends `transition` Action with `to: 'lesson_2'`; already supported via the existing `transition` variant.
- **`learner_state`** — schema unchanged; the data carries over.
- **`sessions` table** — gains a `current_lesson_id` column (or derives from the statechart state). Migration if needed.

## Sub-tasks

1. **T-15a — Macro statechart transition** `[parallel]`
2. **T-15b — `MasteryCelebration` "continue" button wiring** `[parallel after T-15a]`
   - Dispatches a `transition_to_next_lesson` event to the statechart.
3. **T-15c — Persistence verification** `[parallel after T-15a]`
   - After transition, `learner_state` for L1 KCs is still queryable and consumed by F-14's regression detector.
4. **T-15d — Tests + demo scenario** `[parallel]`

## Acceptance criteria (product behavior)

1. **Mastering L1 mounts `MasteryCelebration`** with a "continue to Lesson 2" affordance.
2. **Clicking the affordance** transitions the statechart from `lesson_1.mastered` to `lesson_2.introducing` within ~500ms.
3. **L1 BKT values are preserved** in `learner_state` and consumed by F-14's regression detector during L2.
4. **The macro guard refuses transition** if L1 mastery is not declared — verifiable by attempting to fire the transition event from `lesson_1.practicing`.
5. **`sessions.current_lesson_id` (or equivalent) reflects the new lesson** after transition.
6. **The full L1→L2 arc is demoable** end-to-end in a single browser session — 4–8 minutes per the demo arc plan.

## Testing requirements

- Statechart test: macro transition fires on `lesson_1.mastered`, rejects otherwise.
- Integration test: drive an L1 session to mastery via test harness, click continue, assert L2's first item mounts.
- E2E (Playwright): full L1→L2 in a real browser session.

## Manual setup required

None.

## Convergence and expected rework

⚠ **F-15 is the convergence point for I3.** Both F-13 and F-14 must be merged. If either's contract was slightly different from this spec's expectation, F-15 absorbs the rebase.

⚠ **Statechart shape** — F-15 finalises the lesson-1-to-lesson-2 piece of the macro statechart. F-22/F-23 will extend to lesson_2-to-3, lesson_3-to-4 by reuse of the same transition pattern.

## Implementation notes (filled in by the building agent)

> Empty.
