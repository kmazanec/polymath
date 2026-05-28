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

## Implementation plan (approved)

> Built off F-07 (the merge sink). Consumes the event log F-05/06/07 write. The
> `lessons/1/mastery_config.json` is already fully populated (F-01); F-09 only
> consumes it via the existing `loadLesson`. `learner_state` was created empty in
> F-01; F-09 is its **single writer**.

- [x] **`packages/bkt`** (new pure package): `updateBKT(prior, correct, config)`
      (Corbett-Anderson) + `isMastered(params, threshold)`. Hand-computed unit cases +
      property test (probability always in [0,1]). Add to the workspace + tsconfig refs.
- [x] **Event-log consumer** — `apps/agent/src/mastery/eventConsumer.ts`: the **single
      writer** of `learner_state`. On `submit` (with `correct`), `request_hint`,
      `transfer_submitted`: update the affected KC's BKT, bump hint/retry counters, recompute
      behavioral aggregates (hint ratio, retry ratio, response-time band), persist. Pure
      "compute next state" core (unit-testable) + a thin DB-write wrapper.
- [x] **Rule-gate predicate** — extend `apps/agent/src/mastery/gate.ts`:
      `evaluateRuleGate(learnerState, config): { passed, blockers[] }` implementing the full
      ADR-011 predicate (consecutive-correct ≥3, hints ≤0 in last N, median RT in band, hint
      ratio ≤0.20, retry ratio ≤0.30, BKT ≥0.95). Returns the blocker reason set. `isMastered`
      stays the F-12 seam (rule + transfer recorded; explain-back later).
- [x] **Wire the gate into the snapshot** — the server's `readLearnerSnapshot` computes
      `ruleGatePassed` from `evaluateRuleGate` over the persisted `learner_state` (replacing
      F-05's signals-flag read), so the agent fires a transfer probe exactly when the gate
      passes (criterion 4).
- [x] **Statechart readiness guard** — replace F-07's permissive `practicing → transferring`
      edge with a `canEnterTransfer` guard backed by the rule-gate result (coordinate with
      F-07's phase; F-09 rebases on it).
- [x] **Consume `mastery_config.json`** via `loadLesson` (already wired in the server).
- [x] **Tests** — `packages/bkt` unit + property; rule-gate returns `passed:true` for a
      synthesized clean history and `passed:false` w/ `blockers:['hint_ratio_exceeded']` for a
      hinty one; integration: synthesize a session of events, assert the gate flips at the
      right point + the replay shows the per-turn BKT trajectory.

## Implementation notes (filled in by the building agent)

### As built

- **`packages/bkt`** (new pure package): `updateBKT` (Corbett-Anderson Bayes update +
  learning transition), `isMastered`, `initBKT`, `updateBKTSequence`. Probability is provably
  kept in [0,1]; hand-computed unit cases (0.776 after one correct from prior 0.30) + a
  property test over adversarial param/observation streams.
- **Rule gate** (`mastery/gate.ts`): `evaluateRuleGate(state, config): {passed, blockers[]}`
  implements the full ADR-011 predicate (consecutive-correct, hints-in-window, median RT band,
  hint ratio, retry ratio, BKT ≥ threshold) and names each blocker. `isMastered` now composes
  rule-gate + transfer + explain-back + topic-guardrail (F-12 fills the explain-back input).
  Added `hintRatio`/`retryRatio` to the `LearnerState` interface (the gate's input — distinct
  from F-05's `LearnerSnapshot`).
- **Single-writer event consumer** (`mastery/eventConsumer.ts`): a pure `deriveState` reducer
  folds the session's event log (+ the just-arrived event) into per-KC BKT + behavioral
  aggregates; `toLearnerState` projects it for the gate. The server's
  `updateAndReadLearnerState` runs it before the agent proposes, **persists `learner_state`
  (one row per KC, upsert) as the sole writer**, and returns the snapshot with the *real*
  `ruleGatePassed` (replacing F-05's placeholder flag). So the agent fires a transfer probe
  exactly when the gate passes (criterion 4), proven end-to-end.
- **Retry semantics:** a "retry" is a repeat submit on an item previously gotten *wrong* (a
  correct attempt clears the miss) — re-seeing an already-correct item is spaced practice, not
  a retry. This keeps the retry ratio meaningful.
- **Statechart guard** (`canEnterTransfer`): F-07's permissive `practicing → transferring` edge
  is now guarded on `context.transferReady`, set via a new `set_transfer_ready` event +
  `assign` action. The web emits `set_transfer_ready(true)` then `enter_transfer` when the
  agent (server-gated) mounts a probe — so the spine *declaratively refuses* an early transfer
  (the demoable ADR-005 named guard), with the server gate as the enforcing layer.

### Deviations / honest gaps

- **Criterion 6 (hot-reloadable `mastery_config.json` in dev) — NOT met.** The lesson +
  mastery config are cached per-process (`lessonCache` in `server.ts`, added in F-05 to avoid
  re-reading JSON every frame). Changing a threshold requires an agent restart. The config
  *is* externalized to JSON and loaded via `loadLesson` (the tuning surface ADR-011 wants);
  only the live hot-reload is deferred. Flagged for the batch retro; cheap to add later (a dev
  cache-bust or file-watch) but out of F-09's load-bearing scope.
- **`hintsUsedInLastN`** uses the session-total hint count as a conservative proxy for the
  "last N items" window — at L1 scale the session is short enough that total ≈ window, and a
  conservative (higher) count only makes the gate stricter. A true sliding window is a later
  refinement.

### Convergence flags for integration

- `packages/statechart/src/lesson.ts`: F-09 added `transferReady` to context/input, the
  `set_transfer_ready` event + `setTransferReady` action, and the `canEnterTransfer` guard on
  `enter_transfer`. F-07 owns the `transferring` phase + `isHiddenRepMountRefused`; these are
  additive on top.
- `apps/web/src/ws/actionAdapter.ts`: a TransferProbe mount now emits
  `[set_transfer_ready(true), enter_transfer]` (was just `enter_transfer`). Tests updated.
- `apps/agent/src/server.ts`: F-09 replaced `readLearnerSnapshot` with
  `updateAndReadLearnerState` (single writer) and reordered the verdict computation before it.
  This is the same `handleClientFrame` block F-06 (L3 logging) + F-07 (transfer verdict) touch
  — reconcile all three at integration.

### Verification

- `pnpm typecheck` clean (6 packages incl. new `@polymath/bkt`); bkt 6 tests, gate 11,
  eventConsumer 5, statechart 16, web 105, agent 76 (+5 skipped).
- End-to-end (real Postgres): 3 correct AND submits drive BKT past 0.95, the gate passes, the
  agent fires the probe, a correct transfer → mastery; the replay shows the rising per-KC BKT
  trajectory (criterion 8) and the transfer verdict (criterion 5).
- Rule-gate unit tests cover `passed:true` for a clean history and `passed:false` with
  `blockers:['hint_ratio_exceeded']` (criteria 2, 3); BKT matches hand-computed values
  (criterion 7).

### Adversarial review (Step 6) — Wave 1

- **Spec (HIGH, fixed): the response-time band was never enforced in production.** The `submit`
  wire event had no response-time field, so `responseTimesMs` was always empty and the 2–60s
  band (an ADR-011 condition + part of criterion 2) was skipped. **Fix:** added an optional
  append-only `submit.responseTimeMs` (the web stamps item-mount time and reports elapsed ms),
  threaded it through the consumer. New unit test: a sub-2s streak is blocked with
  `response_time_out_of_band`.
- **Spec/Security (MEDIUM, fixed): the BKT/streak trusted the client's `correct` flag.** Per
  ADR-010 the server must recompute correctness. **Fix:** `deriveState` now recomputes each
  submit's correctness server-side via `@polymath/booleans.equivalent(submission, target)` —
  the client `correct` flag is used only by the agent's tactical move choice (F-05), never for
  the integrity-critical BKT/streak. New unit test: a non-equivalent submission does not
  advance the streak even if a client claimed correct. (The security reviewer independently
  confirmed the gate→probe chain is sound either way: a forged `correct` only fast-forwards to
  the *server-validated* transfer probe; `mastered` still requires the real transfer pass.)
- **Security (MEDIUM, fixed): O(n²) per-session event scans.** Three unbounded
  `select … where sessionId` scans ran per frame (learner-state derive, transfer candidates,
  most-recent-probe). **Fix:** all three now `.orderBy(desc(ts)).limit(MAX_SESSION_EVENTS=500)`
  — far above a real L1 session, bounding a client that floods a session with events.
- **Low (fixed): criterion-3 blocker isolation** — the consumer test now isolates the
  response-time and hint-ratio blockers in dedicated cases rather than asserting on a mixed set.

---

**Delivered in MR:** https://labs.gauntletai.com/keithmazanec/polymath/-/merge_requests/4 (unified I1 inner-loop batch: F-05/06/07/09).
