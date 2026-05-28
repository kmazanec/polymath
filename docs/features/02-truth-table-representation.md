# Feature: TruthTable representation (toggle inputs, submit, validate)

**ID:** F-02 · **Iteration:** I1 — Lesson 1 cross-rep gym · **Status:** Not started

## What this delivers (before → after)

**Before:** The workspace has no truth-table affordance. Even though the `TruthTablePractice` ComponentSpec variant is declared in F-01's locked schema, mounting it renders a "TBD" stub. A learner cannot use a truth table as a practice representation.

**After:** When the agent mounts a `TruthTablePractice` component for a target expression (e.g., `A AND B`), the learner sees a truth table with the input columns togglable (clicking a cell flips its value between `true`/`false`), an output column initially blank, and a `Submit` button. Toggling inputs is instant (no network). Submitting validates the learner's claimed truth-table output cells against `packages/booleans.truthTable(targetExpression)` in <5ms, sends a `submit` event over the WebSocket with the result, and visually marks correct/incorrect cells. The learner *can do* a truth-table practice item end-to-end.

## How it fits the roadmap

I1, concurrent feature in **track A (reps)** alongside F-03 (Circuit) and F-04 (Pseudocode). Each rep is its own sub-agent feature branch. Three converge on `apps/web/src/components/registry.ts` (renderer switch), the `PulseContext` (after F-03 publishes it), and the agent menu (F-05 consumes their mounts).

**Off the critical path.** The critical path uses Circuit (F-03) as the canonical rep because Circuit + Pulse is the load-bearing pedagogy moment per [ADR-004](../adrs/ADR-004-modalities-and-sensors.md). TruthTable is parallel-track-required for the cross-rep gym thesis ([ADR-001](../adrs/ADR-001-learning-domain-boolean-logic.md)) but does not gate any downstream feature on its own.

## Dependencies (must exist before this starts)

- **F-01** — `ComponentSpec.kind === 'TruthTablePractice'` variant in the schema; `packages/booleans` validator; web shell with renderer switch.

## Unblocks (what waits on this)

- **F-05** — Inner agent loop emits `mount` Actions with `TruthTablePractice` ComponentSpecs; needs the rendered behavior to exist.
- **F-07** — Transfer probe can use truth-table as the target representation (and as a hidden rep when probing in circuit/code form).
- **F-09** — BKT updates fire on truth-table submissions; needs the submit event to be wired.

## Contracts touched

- **`ComponentSpec`** — adds the rendered behavior for the `TruthTablePractice` variant. Does not change the schema (variant already exists from F-01).
- **`packages/booleans`** — consumes the validator; does not extend it.
- **Curated component registry (rendering)** — replaces the F-01 "TBD" case for `TruthTablePractice` with the real component. ⚠ Convergence with F-03 and F-04 — three sub-agents editing the same switch file. Mitigation: each feature's sub-agent edits only its own `case` arm; merge order alphabetical.
- **`PulseContext`** — *subscribes* to the pulse after F-03 introduces it. F-02 must not modify the producer. The truth-table row corresponding to the current pulse input combination highlights in sync.
- **WebSocket message protocol** — extends `submit` event payload with the rep-tagged submission shape (`{ rep: 'truth_table', cells: number[] }`). ⚠ Coordinate with F-03/F-04 on the union shape: agreed to use a discriminated union with `rep` as the discriminator, F-02 lands the `truth_table` branch.

## Sub-tasks

1. **T-02a — `<TruthTable>` React component** `[parallel]`
   - Renders rows = 2^n assignments, columns = vars + output.
   - Click-to-toggle on output cells; input cells read-only (the agent supplies the input set).
   - Visual state for correct/incorrect after submit.
2. **T-02b — Submit handler + validator call** `[parallel after T-02a]`
   - On submit click: call `packages/booleans.truthTable(targetExpression)`, compare cell-for-cell, render verdict, dispatch `submit` WebSocket event.
3. **T-02c — `PulseContext` subscriber** `[serial after F-03 lands PulseContext]`
   - The current row (corresponding to the active pulse step) gets a subtle highlight. No-op if PulseContext is absent.
4. **T-02d — Renderer switch case** `[parallel]`
   - Replace F-01's TBD stub for `TruthTablePractice` with the real component.
5. **T-02e — Tests** `[parallel]`
   - Component test: toggling cells updates local state; submit fires the right event.
   - Visual regression test (Playwright screenshot or similar) for the post-submit correct/incorrect state.

## Acceptance criteria (product behavior)

1. **Given a target expression `A AND B`**, when the agent mounts `TruthTablePractice`, the learner sees a 4-row truth table with input columns A, B and an output column.
2. **Clicking an output cell toggles it between `true` and `false`** in under 50ms (no network round-trip).
3. **Clicking `Submit` with all 4 output cells correctly filled** marks every cell green, sends a `submit` event with `correct: true`, and the agent's next Action is mounted within ~500ms.
4. **Clicking `Submit` with one or more cells wrong** marks correct cells green and incorrect cells red, sends `correct: false`, and the agent's next Action proposes a hint or rephrase per the bounded menu.
5. **Variables in the expression are extracted automatically** — the learner does not manually specify A, B; the parser identifies them from `targetExpression`.
6. **Keyboard navigation works**: Tab moves between cells; Space toggles the focused cell; Enter submits.
7. **Reduced-motion preference is honored** — no transitions on cell flip beyond an instant color change.
8. **When F-03 has landed, during a pulse animation triggered from the Circuit component**, the truth-table row matching the active pulse step highlights with a subtle outline, fading at the same beat as the pulse.

## Testing requirements

- Component tests (Vitest + React Testing Library) for: toggle behavior, submit event shape, correct/incorrect render states, keyboard navigation.
- Integration test (Playwright): full flow — agent mounts `TruthTablePractice`, learner submits correct + incorrect cases, verdict rendered.
- Property test for the parser-variable-extraction: random expressions with up to 4 variables; assert extracted vars match parser AST.

## Manual setup required

None.

## Convergence and expected rework

⚠ **Three concurrent reps converge on `apps/web/src/components/registry.ts`.** Each PR adds its own `case`; merge conflicts are file-level not semantic. Resolve by alphabetical case order. Reviewer for the last-to-merge PR confirms exhaustiveness check still compiles.

⚠ **PulseContext consumer** (sub-task T-02c) must serialize after F-03's producer lands. Strategy: F-02's PR can be opened and merged *without* T-02c — the truth-table works fine without the pulse-sync feature. T-02c then lands as a follow-up commit (or a tiny separate PR) once F-03 is merged. Acceptance criterion 8 is the only one that depends on this; mark it "deferred until F-03 lands" until then.

⚠ **WebSocket protocol convergence with F-03/F-04** on the rep-tagged submission union. Lock the discriminator shape in the agent menu PR (F-05's prep work) so all three rep PRs use the same shape.

## Implementation notes (filled in by the building agent)

> Empty.
