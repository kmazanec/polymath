# Feature: Transfer probe + hidden-reps refusal

**ID:** F-07 · **Iteration:** I1 — Lesson 1 cross-rep gym · **Status:** Not started

## What this delivers (before → after)

**Before:** The system has no transfer assessment. The learner can complete an L1 practice item but the brief's "transfer moment" requirement is not honored.

**After:** When the agent determines the learner is ready to be tested (rule-gate stub passes — F-09 lands the full predicate but F-07 can be tested against a hand-fired transfer probe), it emits a `mount` of `TransferProbe`. The probe specifies `targetRep` (the representation the learner must produce, e.g., circuit) and `hiddenReps` (the reps that must not be visible, e.g., truth-table). The renderer literally does not mount components for representations in `hiddenReps`. If the learner asks the agent to bring back a hidden rep ("can I see the truth table again?"), the agent emits `answer_question` with a stock refusal text from [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md): *"During the transfer check, I'm keeping the [REP] view off so you're showing me you can do this yourself. We can review it together right after."* On `submit`, the learner's answer is validated against the bank-stored canonical truth-table; pass/fail recorded in `events`.

The transfer-probe refusal is **a demoable moment** — "watch what happens when I ask for the truth table back" is in the demo script per [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md).

## How it fits the roadmap

I1, **on the critical path**. Concurrent with F-06 after F-05 lands. Blocks F-09 (the rule-gate's transfer-pass condition reads from this), F-11 (explain-back is triggered on transfer pass), F-12 (full mastery gate).

## Dependencies (must exist before this starts)

- **F-02, F-03, F-04** — the reps must exist before they can be selectively hidden.
- **F-05** — agent menu extensible.
- **F-08** — the transfer bank must have items seeded so the probe has content to pull from.

## Unblocks (what waits on this)

- **F-09** — rule-gate's transfer-pass condition.
- **F-11** — explain-back is triggered on `transfer_submitted` event.
- **F-12** — full mastery gate requires transfer pass.

## Contracts touched

- **`Action` schema** — extends with `propose_transfer_probe(held_out_rep: Rep)`. Emitted by the agent; statechart guard validates and mounts `TransferProbe` accordingly.
- **`ComponentSpec`** — `TransferProbe` variant already in F-01 schema. F-07 implements rendering. The hidden-reps enforcement is at the **component level**: the `TransferProbe` component literally does not import/render the hidden reps.
- **Curated component registry (rendering)** — adds the `TransferProbe` case.
- **Statechart spine** — adds the `transferring` phase guards: any attempt to mount a hidden-rep component during the phase is rejected. This is one of the three explicit refusals from [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md).
- **WebSocket message protocol** — adds `transfer_submitted` event kind. Append-only.
- **`transfer_bank` Postgres table** — read-only consumer.
- **Refusal copy library** — `apps/web/src/copy/refusals.ts` introduced here. The three refusal texts live in one place; F-12 will reference the mastery-without-conditions refusal.

## Sub-tasks

1. **T-07a — `<TransferProbe>` React component** `[parallel]`
   - Mounts only the `targetRep` workspace; reads `hiddenReps` and refuses to mount anything in it (returns null + log).
   - Banner copy: "Transfer check — show me you can do this without scaffolds."
2. **T-07b — Statechart `transferring` phase + guards** `[parallel]`
   - Phase transitions from `assessed` on agent's `propose_transfer_probe`.
   - Guards reject any `mount` of a hidden-rep ComponentSpec.
   - The "bring back the rep" refusal is wired: incoming `learner_question` events classified by the agent as "bring back a hidden rep" are routed to the refusal-text `answer_question` Action.
3. **T-07c — Agent transfer-probe subgraph** `[parallel]`
   - LangGraph node: when rule-gate signals readiness (stub for now; F-09 wires real predicate), pull an unseen item from `transfer_bank` (excluding any item shown earlier in the session); emit `propose_transfer_probe`.
4. **T-07d — Refusal copy + topic classifier for "bring back rep" requests** `[parallel]`
5. **T-07e — Submission handler** `[parallel after T-07a]`
   - On submit: validate via `packages/booleans.equivalent` against the bank item's canonical expression; emit `transfer_submitted` with the result.
6. **T-07f — Tests** `[parallel]`

## Acceptance criteria (product behavior)

1. **When the agent emits `propose_transfer_probe(held_out_rep: 'truth_table')`** on an L1 item, the statechart transitions to `transferring` and the learner sees the `TransferProbe` workspace containing only the `targetRep` (e.g., circuit), no truth table.
2. **Attempting to mount a hidden-rep component during the phase is silently rejected by the statechart guard** — verifiable by injecting a `mount` Action with a hidden rep and observing the rejection in the statechart's decision log.
3. **The pulse-through-the-circuit animation (F-03) is suppressed during transfer probes** when the truth table is hidden, since the in-sync truth-table row pulse would leak information.
4. **The learner asking "can I see the truth table" via the (post-F-10) voice or (current) text channel** elicits a stock refusal text from `refusals.ts`; no rep is brought back.
5. **A correct submission emits `transfer_submitted` with `correct: true`**; the agent's next Action is a `propose_mastery_transition` (or the rule-gate-stubbed equivalent).
6. **An incorrect submission emits `transfer_submitted` with `correct: false`**; the agent's next Action is a `remediating` transition back into `practicing` with a `simpler_item`.
7. **The probed item is one the learner has not seen in this session** — verifiable from the `events` table by cross-referencing item IDs.
8. **The transfer-probe refusal is observable in a demo recording** — the demo script can include "I'm going to ask for the truth table back; watch what happens."

## Testing requirements

- Component test: TransferProbe renders only targetRep; hidden reps are null in the DOM.
- Statechart test: `mount` of hidden-rep during `transferring` phase is rejected by guard.
- Integration test: full probe flow from `propose_transfer_probe` through correct submission to next-phase transition.
- Eval scenario: "learner asks for hidden rep" → stock refusal text.

## Manual setup required

- Refusal copy review by Keith — the language must be warm + explanatory, not adversarial. ~half day of writing/review.

## Convergence and expected rework

⚠ **Statechart spine changes** in T-07b. The `transferring` phase is added to `packages/statechart`. Coordinate with F-09 (rule-gate guards) — both touch the statechart. Strategy: F-07 lands the phase + the hidden-rep guard; F-09 lands the readiness guard.

⚠ **Agent menu file** edited concurrently with F-06. See F-06's convergence note.

⚠ **Renderer switch convergence** with F-06.

⚠ **F-07 depends on F-08's seeded transfer bank** — coordinate timing so F-08 merges before F-07's submission tests can run live. F-07 can develop against a small stubbed bank, then switch to the seeded one when F-08 is in.

## Implementation notes (filled in by the building agent)

> Empty.
