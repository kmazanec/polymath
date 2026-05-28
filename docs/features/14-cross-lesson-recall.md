# Feature: Cross-lesson recall component + `recall_lesson1_kc` agent action

**ID:** F-14 · **Iteration:** I3 — Lesson 2 + cross-lesson recall · **Status:** Not started

## What this delivers (before → after)

**Before:** The agent can mount items only in the current lesson's content. The "cross-lesson recall" piece of [ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md) that elevates L1+L2 from "two disconnected lessons" to "a curriculum the architecture remembers" is not visible.

**After:** During a Lesson 2 session, when the agent detects regression on an L1 KC the learner had mastered (e.g., the L2 item involves a NOT and the BKT for "NOT" has slipped below 0.85), the agent emits a `recall_lesson1_kc` Action. The browser mounts a `CrossLessonRecall` component visible to the learner as a short callout: *"You mastered AND in Lesson 1 — here's how AND shows up in this composed expression."* The learner can dismiss or interact with the recall card before continuing. After interaction, the agent resumes the practice flow.

This is the **strongest available demonstration that the architecture is more than a single-lesson app** per [ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md). Without F-14, L2 looks like a duplicate of L1 with new content.

## How it fits the roadmap

I3, **off the critical path** (cuttable if I3 capacity shrinks). Concurrent with F-13. F-15 reads both.

## Dependencies (must exist before this starts)

- **F-05** — agent menu extensible.
- **F-13** — L2 exists as a session destination.

## Unblocks (what waits on this)

- **F-15** — the recall capability is part of what gets demoed in the L1→L2 transition.

## Contracts touched

- **`Action` schema** — extends with `recall_lesson1_kc(kc: string, currentItemId: ItemId)`. Agent menu extension.
- **`ComponentSpec`** — `CrossLessonRecall` variant. Already declared in F-01? No — F-01's schema explicitly lists the 12 variants from [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md). `CrossLessonRecall` is one. F-14 implements rendering for it.

  Actually: [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md)'s 12 variants do NOT include `CrossLessonRecall`. **F-14 extends the schema with a new variant.** Coordinate with F-15 reviewer.

- **Curated component registry (rendering)** — adds the `CrossLessonRecall` case.
- **Inner-agent classify logic** — adds a regression-detector that checks L1 KC BKT values during an L2 turn. Lives in `apps/agent/src/agent/regression.ts`.

## Sub-tasks

1. **T-14a — Schema extension** `[parallel]`
   - Add `CrossLessonRecall` variant to `ComponentSpec` in `packages/contract`. Add `recall_lesson1_kc` variant to `Action`.
   - Note: this is the only feature in I3 that touches `packages/contract`. F-13 does not.
2. **T-14b — `<CrossLessonRecall>` React component** `[parallel after T-14a]`
   - Renders the callout with KC name, prior mastery evidence, and a "got it, continue" button.
   - Renderer switch case.
3. **T-14c — Regression detector + agent emission logic** `[parallel after T-14a]`
   - In the agent's classify node, before selecting a routine action, check L1 KC BKT in `learner_state`. If below 0.85, emit `recall_lesson1_kc`.
   - Throttle: at most one recall per session unless a different KC slips.
4. **T-14d — Tests + eval scenarios** `[parallel]`
   - LangSmith scenario: synthetic learner with L1 NOT slipping during L2 NOT-AND composition → agent emits recall.

## Acceptance criteria (product behavior)

1. **A learner mid-L2 whose synthesized L1 BKT for "NOT" has dropped below 0.85** triggers `recall_lesson1_kc` on the next agent turn; the `CrossLessonRecall` component mounts.
2. **The recall callout names the specific KC** ("AND", "NOT", "OR") and shows a brief reminder.
3. **Dismissing the recall** resumes the practice flow at the next item.
4. **At most one recall per session** per KC — repeated triggers within a session are suppressed.
5. **The recall is visible in the replay endpoint** — useful for the demo to highlight cross-lesson value.
6. **LangSmith eval for the regression-detector scenarios passes at ≥90%**.

## Testing requirements

- Component test for `<CrossLessonRecall>`.
- Unit test for the regression detector.
- Integration test: synthetic L2 session with deliberate L1 KC regression triggers the recall once and only once.
- LangSmith eval for the detector.

## Manual setup required

None.

## Convergence and expected rework

⚠ **Schema extension** — F-14 is the only post-F-01 feature to extend `ComponentSpec` with a *new* variant. F-22, F-23, F-24, F-25, F-26 all may also add variants. Strategy: each new-variant PR coordinates the change across `apps/web` (renderer case) and `apps/agent` (system prompt enumeration). For F-14, this is contained because it lands within I3 alone.

⚠ **F-14 concurrent with F-13**: zero file overlap (F-14 touches schema + regression detector + new component; F-13 touches lessons/2/ + statechart). Clean.

## Implementation notes (filled in by the building agent)

> Empty.
