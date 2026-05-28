# Feature: BKT + behavioral signals + rule-gate predicate

**ID:** F-09 · **Iteration:** I1 — Lesson 1 cross-rep gym · **Status:** Not started

## What this delivers (before → after)

**Before:** `learner_state` rows exist but the BKT probabilities and behavioral signals are zeroes. The mastery gate predicate is a stub returning `false`. The rule-gate condition for transfer-probe readiness is not evaluable.

**After:** Every learner submission updates the per-KC BKT probability via the Corbett-Anderson update rule ([ADR-011](../adrs/ADR-011-evaluation-and-mastery-instrumentation.md)). Behavioral signals accumulate: hint ratio, retry ratio, median response time, response-time band hits. The rule-gate predicate evaluates: `consecutiveCorrectAtHardestTier ≥ 3 AND hintsUsedInLastN ≤ 0 AND medianResponseTime in [2s, 60s] AND hintRatio ≤ 0.20 AND retryRatio ≤ 0.30 AND bktForKC ≥ 0.95`. The agent reads the predicate to decide when to emit `propose_transfer_probe`. A `MasteryConfig` JSON per lesson holds the tunable thresholds.

After F-09 merges, an L1 session can run to the point where the rule-gate signals readiness, the agent fires a transfer probe, the learner passes it, and the rule-gate plus transfer condition together flip the gate predicate to "rule + transfer passed; awaiting explain-back" — observable via the replay endpoint. The full 4-condition mastery gate lands in F-12.

## How it fits the roadmap

I1, **on the critical path**. Merge sink for I1 — depends on F-05, F-06, F-07, F-08 (the consumers of the event log it indexes). After F-09 merges, the L1 mastered-without-voice flow is end-to-end demoable.

## Dependencies (must exist before this starts)

- **F-05** — events flowing into the log per turn.
- **F-06** — hint events recorded.
- **F-07** — transfer-submitted events.
- **F-08** — transfer bank seeded so probes can fire against real items.

## Unblocks (what waits on this)

- **F-12** — full mastery gate (extends the rule-gate with explain-back + topic-guardrail conditions).
- **F-22** / **F-23** — lesson-specific configs reuse the predicate.

## Contracts touched

- **Mastery gate predicate** — `apps/agent/src/mastery/gate.ts`. Signature locked in F-01. F-09 implements the rule-gate + BKT + behavioral body. F-12 extends it (additive).
- **`packages/bkt`** — introduced here. Pure-TS BKT update + threshold check. ~150 lines per [ADR-011](../adrs/ADR-011-evaluation-and-mastery-instrumentation.md). Imported by the agent.
- **Lesson config JSON** — `lessons/1/mastery_config.json` filled in with the parameter set from [ADR-011](../adrs/ADR-011-evaluation-and-mastery-instrumentation.md). The shape is locked.
- **`learner_state` table** — gains structured columns/JSONB for BKT params per KC, behavioral signal aggregates, hint/retry counters. Drizzle migration.
- **Statechart spine** — adds a guard on `practicing → transferring` that checks the rule-gate. Coordinate with F-07's statechart additions.

## Sub-tasks

1. **T-09a — `packages/bkt` BKT update + threshold check** `[parallel]`
   - `updateBKT(prior: BKTParams, correct: boolean, config: BKTConfig): BKTParams` (Corbett-Anderson update).
   - `isMastered(params: BKTParams, threshold: number): boolean`.
   - Unit-tested with hand-computed cases.
2. **T-09b — `learner_state` schema extension + migration** `[parallel]`
3. **T-09c — Event-log consumer that updates `learner_state`** `[parallel after T-09a, T-09b]`
   - On every `submit`, `request_hint`, `transfer_submitted`: read existing `learner_state` for the session, update BKT for the affected KC, increment hint/retry counters, recompute aggregates. Persist.
4. **T-09d — Rule-gate predicate** `[parallel after T-09c]`
   - `evaluateRuleGate(learnerState, masteryConfig): { passed: boolean, blockers: string[] }`.
   - Returns the reason set so the agent's emission rationale can name it.
5. **T-09e — Agent hook: gate read before `propose_transfer_probe`** `[parallel after T-09d]`
   - Inner-agent classify node checks the rule-gate; if `passed`, emits `propose_transfer_probe`; if not, picks another menu item.
6. **T-09f — `lessons/1/mastery_config.json`** `[parallel]`
   - All parameters per [ADR-011](../adrs/ADR-011-evaluation-and-mastery-instrumentation.md).
7. **T-09g — Statechart guard for `practicing → transferring`** `[parallel after T-09d]`

## Acceptance criteria (product behavior)

1. **After every `submit` event, the corresponding KC's BKT probability is updated** — verifiable by querying `learner_state` after a submit.
2. **The rule-gate predicate returns `passed: true` for a session** in which a synthesized history of 3 consecutive correct + 0 hints + response times in the 2–60s band is fed in (integration test).
3. **The rule-gate predicate returns `passed: false` with `blockers: ['hint_ratio_exceeded']`** if the synthesized history has hintRatio > 0.20.
4. **The agent only emits `propose_transfer_probe` when the rule-gate passes** — verifiable from the per-Action rationale log.
5. **After a learner passes a transfer probe, the gate predicate (still partial without explain-back) records the transfer pass** so F-12 can later read it.
6. **`lessons/1/mastery_config.json` is hot-reloadable in dev** — changing the threshold and refreshing the page applies the new value without a deploy.
7. **The Corbett-Anderson BKT update matches hand-computed values** for a small set of test cases (unit test).
8. **The replay endpoint shows the per-turn BKT trajectory** for a session — useful for debugging and the demo.

## Testing requirements

- Unit tests for `packages/bkt` against hand-computed BKT trajectories.
- Property test: BKT probability never goes outside [0, 1].
- Integration test: synthesize a session of events, assert rule-gate transitions at the right point.
- Eval scenario: "session with hint-ratio just over threshold" — rule-gate must reject.

## Manual setup required

None.

## Convergence and expected rework

⚠ **Statechart spine** convergence with F-07 — F-09 adds a guard to the `practicing → transferring` transition that F-07 introduced. Strategy: F-07 lands the phase with a trivially-true guard; F-09 replaces the guard. Both edits to the same machine definition — F-09's PR rebases on top of F-07's merged code.

⚠ **Event log consumer** is the only place that mutates `learner_state`. Single-writer pattern enforced by code review — no other feature writes to `learner_state` columns F-09 owns.

⚠ **Mastery config** schema is consumed by F-12. F-12 extends with explain-back-specific keys but does not change F-09's keys. Coordinate at file-edit level if F-09 and F-12 land close together (they don't — F-12 is in I2).

## Implementation notes (filled in by the building agent)

> Empty.
