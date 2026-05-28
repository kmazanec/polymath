# Feature: Full mastery gate integration (all 4 conditions)

**ID:** F-12 · **Iteration:** I2 — Voice + full mastery gate · **Status:** Not started

## What this delivers (before → after)

**Before:** The rule-gate (F-09) plus transfer-pass condition are evaluable, but mastery cannot be declared end-to-end — the explain-back condition exists in F-11 but is not wired into the gate. The mastery-without-conditions refusal from [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md) is not demoable.

**After:** The `evaluateMasteryGate(learnerState, masteryConfig): { passed: boolean, blockers: string[] }` predicate combines all 4 conditions: (a) rule-gate (F-09's predicate), (b) transfer-probe passed from held-out bank in this session, (c) explain-back rubric pass (F-11's verdict), (d) topic-guardrail clean (no agent off-topic deflection beyond a small budget). The agent emits `propose_mastery_transition` only when the gate predicate's `passed` returns true. The statechart guard on `assessed → mastered` re-evaluates the predicate as the truth-maker and rejects the proposal if not satisfied. On rejection, the agent's rationale is logged. The `MasteryCelebration` component mounts on success.

The third explicit refusal from [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md) — "mastery without conditions" — is now demoable: bypass any one condition (test seam) and the statechart refuses the transition.

## How it fits the roadmap

I2, **on the critical path**. Closes I2. After F-12 merges, L1 mastery is end-to-end demoable with all 4 conditions. I3 (Lesson 2) can begin.

## Dependencies (must exist before this starts)

- **F-09** — rule-gate predicate.
- **F-11** — explain-back rubric verdict.

## Unblocks (what waits on this)

- **F-13, F-15** — Lesson 2 + L1→L2 transition require the gate to be live.
- **F-18** — SessionReport reads mastery state.

## Contracts touched

- **Mastery gate predicate** — extends F-09's implementation with the explain-back + topic-guardrail conditions. Signature unchanged.
- **Statechart spine** — guard on `assessed → mastered` evaluates the full predicate. Replaces the stub guard from F-09.
- **`ComponentSpec`** — `MasteryCelebration` variant from F-01. F-12 implements rendering.
- **`Action` schema** — `propose_mastery_transition` extends the agent menu. (May reuse `transition` Action variant with `to: 'mastered'`.)
- **Mastery config JSON** — adds explain-back agreement threshold, topic-guardrail budget; doesn't change F-09's keys.

## Sub-tasks

1. **T-12a — Extended mastery gate predicate** `[parallel]`
   - Combine F-09 rule-gate + transfer condition + F-11 explain-back verdict + topic-guardrail counter.
   - Returns `{ passed, blockers }` with named blockers for each unmet condition.
2. **T-12b — Statechart guard on `assessed → mastered`** `[parallel after T-12a]`
3. **T-12c — Agent menu: `propose_mastery_transition`** `[parallel after T-12a]`
4. **T-12d — `<MasteryCelebration>` component + renderer case** `[parallel]`
5. **T-12e — Topic-guardrail counter** `[parallel]`
   - Each `answer_question` Action with `topicClassification: 'off_topic'` increments the counter; a small budget (e.g., 3) before mastery is blocked.
6. **T-12f — Tests + integration** `[parallel]`

## Acceptance criteria (product behavior)

1. **A learner who passes rule-gate + transfer + explain-back + clean topic-guardrail** triggers an agent `propose_mastery_transition`; the statechart guard accepts; `MasteryCelebration` mounts.
2. **A learner who passes rule-gate + transfer + explain-back but has triggered the off-topic budget** — the agent does NOT propose mastery; the rationale notes `blockers: ['topic_guardrail_exceeded']`.
3. **An injected `propose_mastery_transition` Action with the gate predicate returning `passed: false`** is rejected by the statechart guard; a log entry records `statechartDecision: 'reject', statechartReason: 'mastery_gate_failed: <blockers>'`. *This is the demoable mastery-without-conditions refusal.*
4. **The mastery-config JSON tunable** for the explain-back agreement threshold is hot-reloadable in dev.
5. **The replay endpoint shows the per-turn gate evaluation** at each item completion — useful for the demo "show the gate failing then passing."
6. **`MasteryCelebration` renders** with the concepts mastered (from `learner_state`) and offers a "continue to Lesson 2" affordance — which is wired in F-15.

## Testing requirements

- Unit tests for the predicate: each blocker independently triggers the right rejection.
- Property test: the predicate is deterministic given the same `learnerState` + `masteryConfig`.
- Integration test: drive a full L1 session through to mastery; assert the celebration mounts.
- Test seam for the demo refusal: a `?testForce=mastered` query param (dev-only) injects a bypass attempt that the guard rejects.

## Manual setup required

None.

## Convergence and expected rework

⚠ **F-12 is the convergence point for I2.** F-10's voice loop, F-11's rubric, F-09's rule-gate all flow through F-12's predicate. If the rubric's verdict shape changed during F-11 development, F-12 must rebase. Mitigation: lock the verdict shape early in F-11.

⚠ **Statechart guard replacement**: F-09 lands a stub guard; F-12 replaces it. Coordinate so F-12 is the final state of the guard for the MVP; F-22/F-23 only ship new mastery-config keys, not new guard logic.

## Implementation notes (filled in by the building agent)

> Empty.
