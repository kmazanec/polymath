# Feature: Full mastery gate integration (all 4 conditions)

**ID:** F-12 · **Iteration:** I2 — Voice + full mastery gate · **Status:** Planned (build plan approved 2026-05-28)

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

## Build plan (approved)

> Synthesized from architect/researcher/contrarian drafts (kmaz-plan-iteration, 2026-05-28),
> judged + reconciled against ground-truth code. **Every schema F-12 needs is already locked:**
> `MasteryCelebration` (component.ts:105) + `COMPONENT_KINDS`, the `transition→'mastered'` Action,
> `propose_mastery_transition` (already in `TacticalMove` / `F05_MENU` / `openaiClient`), and
> `LearnerState`'s `explainBackPassed` / `topicGuardrailClean` booleans that `isMastered` already
> reads (gate.ts:96-103). F-12 is **wiring + truth-making**, not a contract feature. See
> [BUILD-PLAN.md](../BUILD-PLAN.md) for the iteration DAG + frozen contracts.

**CRITICAL VERIFIED FINDINGS (read before building):**
- **The XState `lessonMachine` is NOT driven at agent runtime** (no `createActor` anywhere in
  `apps/agent/src`). The server's `rejectUnauthorizedAction` (server.ts:357) is the de-facto mastery
  truth-maker. AC#3's `statechartDecision`/`statechartReason` log must be **instrumented in the server
  rejection path**, not in the statechart. Spec line 9's "the statechart guard re-evaluates the
  predicate" is satisfied by the server-side earned-it gate. F-12 fills `lesson.ts canDeclareMastery`'s
  input semantics for completeness, but the live enforcement is the server gate.
- **Two verified fail-OPEN landmines to flip closed:** `eventConsumer.ts:175` hardcodes
  `topicGuardrailClean: true`; `:174` hardcodes `explainBackPassed: false` (F-11 fixes :174, F-12 fixes :175).

**Approved decisions (this build):**
- **Gate refactor → SIBLING + DELEGATE, do NOT replace `isMastered`.** Add `evaluateMasteryGate(state, config): { passed, blockers }`; refactor `isMastered` to `return evaluateMasteryGate(state, config).passed`. Preserves the boolean signature depended on at server.ts:357 + gate.test.ts, and surfaces named blockers for AC#3.
- **Topic-guardrail semantics → COUNT OFF-TOPIC ANSWERS THE AGENT GAVE** (persisted `answer_question` Actions with `topicClassification:'off_topic'`), NOT learner questions. A correctly-refused off-topic question does NOT penalize the learner. Budget = 3.
- **AC#3 → instrument the server rejection path** (not runtime XState — verified not driven). `?testForce=mastered` is **dev-only / `NODE_ENV!=='production'` gated** (fail-closed on the seam itself); the earned-it gate still rejects it when the predicate fails.
- **`requireDifferentRepresentation` → subsumed by F-07's hidden-reps transfer mechanism** (verified set true in config but unread by `isMastered`; not a new 5th condition).
- **Verdict input → reads `payload.explainBackVerdict.passed`** (F-11's frozen slot). Until F-11's route persists it, F-12 wires against the shared fixture (mocked payload), then re-points at the live path.

**Frozen contract signatures (this feature):**
- `gate.ts` (NEW): `export type MasteryBlocker = 'rule_gate_failed' | 'transfer_not_passed' | 'explain_back_not_passed' | 'topic_guardrail_exceeded'`; `export interface MasteryGateResult { passed: boolean; blockers: MasteryBlocker[] }`; `export function evaluateMasteryGate(state: LearnerState, config: MasteryConfig): MasteryGateResult`. `isMastered` → one-line delegate. `LearnerState` / `MasteryConfig` input signatures UNCHANGED. Rule-gate sub-blockers fold under `'rule_gate_failed'`.
- `MasteryConfig` (append-only, OPTIONAL): `topicGuardrailBudget: z.number().int().nonnegative().default(3)` + `explainBackJudgeAgreementThreshold?: z.number().min(0).max(1).optional()` (same single name F-11 uses). All optional/defaulted so existing lesson configs still validate (a required key crashes the agent at boot).
- `eventConsumer.ts` (additive): `LoggedEvent` gains `offTopic?: boolean`; `DerivedState` gains `offTopicCount: number` (init 0); `deriveState` counts off-topic `answer_question` actions; `toLearnerState` computes `topicGuardrailClean = offTopicCount <= config.topicGuardrailBudget` — **replaces the hardcoded `true` at line 175**.
- `LearnerSnapshot` (client.ts:68, append-only): gains `explainBackPassed: boolean` + `topicGuardrailClean: boolean` alongside `ruleGatePassed`, so the agent can ORGANICALLY propose mastery (AC#1).
- INTERNAL JSONB convention (NOT a Zod change): reads `payload.explainBackVerdict` (F-11 writes it).
- RELIES ON, NO CHANGE: `ComponentSpec.MasteryCelebration`, the `transition` Action, `propose_mastery_transition` in the two-place menu lockstep (**F-12 edits NEITHER** `menu.ts` nor `openaiClient.ts` — verify by typecheck), the statechart spine.

**Build checklist (test-first):**

- [ ] **BARRIER (with F-11, before any explain-back-input code):** confirm/freeze the `ExplainBackVerdict` type (in `packages/contract`) + the `payload.explainBackVerdict` persistence slot via a shared test fixture. Steps that don't read the verdict (gate predicate, topic-guardrail counter, `MasteryCelebration` renderer, config keys) build in parallel now; the explain-back-wire step + full integration test gate on this barrier.
- [ ] **T-12a (test-first):** in `gate.test.ts` add FAILING cases for `evaluateMasteryGate` — each of the 4 blockers fires INDEPENDENTLY; all-satisfied → `{passed:true, blockers:[]}`; a missing input (`explainBackPassed=false`) → a blocker, never a pass (fail-closed); a property test asserts determinism for fixed `(state,config)`; blockers are typed-union literals (greppable for AC#3).
- [ ] **T-12a (impl):** add `MasteryBlocker` + `MasteryGateResult` + `evaluateMasteryGate`, composing `evaluateRuleGate` (fold `RuleGateBlocker[]` under `'rule_gate_failed'`), transfer (honor `requireHandCuratedTransfer`), explain-back (honor `requireExplainBackPass`), topic-guardrail — exactly as `isMastered` does today. Refactor `isMastered` → `return evaluateMasteryGate(state, config).passed`. Do NOT change `LearnerState`/`MasteryConfig` input signatures.
- [ ] **T-12d-config (test-first → impl, append-only):** add OPTIONAL `topicGuardrailBudget` (int, nonnegative, `.default(3)`) + `explainBackJudgeAgreementThreshold` (0..1, `.optional()`) to `MasteryConfig`; round-trip test that existing `lessons/1/mastery_config.json` still parses; set `topicGuardrailBudget:3` (+ threshold per ADR-011) in `lessons/1/mastery_config.json`. Verify `loadLesson` still passes (a required key crashes the agent at boot).
- [ ] **T-12e (topic-guardrail counter, test-first):** in `eventConsumer.test.ts` add a FAILING test that drives logged events through the REAL `deriveState` fold — including `answer_question` actions with `topicClassification:'off_topic'` — asserting `offTopicCount` increments only on off-topic answers and `toLearnerState` flips `topicGuardrailClean=false` once `offTopicCount > budget`. **Go through the real fold, NOT a hand-set `LearnerState`** (the I1 inert-refusal trap).
- [ ] **T-12e (impl):** extend `LoggedEvent` with `offTopic?:boolean`; in `server.ts toLoggedEvent` (line 81) read it from the persisted prior-turn action (`p.action.type==='answer_question' && p.action.topicClassification==='off_topic'` — extend the `action` projection at line 85, currently reads only type+component.kind); in `deriveState` add `offTopicCount` + increment; in `toLearnerState` compute `topicGuardrailClean`. **KILL the hardcoded `topicGuardrailClean: true` at line 175.** Count from the bounded full-event fold, never `recentHistory`.
- [ ] **T-12-explainback-wire (AFTER barrier, test-first):** extend `LoggedEvent` with `explainBackPassed?:boolean`; in `toLoggedEvent` read `payload.explainBackVerdict.passed`; in `deriveState` set `DerivedState.explainBackPassed=true` once a folded verdict has `passed===true`; in `toLearnerState` thread it (replacing the hardcoded `false` at line 174 — coordinate with F-11, which also fixes this line). Fail-closed: no verdict → stays false → blocker → block. Unit-test with a MOCKED verdict payload — never call the live judge.
- [ ] **T-12c (thread signals + fix prompt/stub, test-first):** extend `LearnerSnapshot` (client.ts:68) with `explainBackPassed` + `topicGuardrailClean`; populate in `server.ts updateAndReadLearnerState` from `learnerDerived`. In `prompt.ts` surface both signals and FIX line 24 ("propose only when the rule gate has passed" — strictly weaker than the full gate) → "only when rule-gate AND transfer AND explain-back passed AND topic-guardrail clean". In `stubClient.ts` replace the transfer-pass `no_action` arm (lines 110-117): once `explainBackPassed && topicGuardrailClean`, propose `propose_mastery_transition`; else `no_action` with blockers in the rationale (AC#2). **Do NOT touch `menu.ts`/`openaiClient.ts`.**
- [ ] **T-12-earned-it (AC#3, test-first):** in `server.ts rejectUnauthorizedAction` (line 356) switch the `transition→mastered` branch from `isMastered` to `evaluateMasteryGate`, and on rejection return a reason embedding the named blockers: `mastery_gate_failed: ${blockers.join(',')}`. Persist `statechartDecision:'reject'`, `statechartReason` into the validation block (server.ts:650). Both the server gate and the (informational) statechart guard derive from the SAME `evaluateMasteryGate` call that turn — no stale recompute.
- [ ] **T-12d-renderer (test-first):** create `apps/web/src/components/MasteryCelebration.tsx` rendering `spec.conceptsMastered` + a disabled/placeholder "Continue to Lesson 2" affordance gated on `spec.nextLessonId` (wiring is F-15, AC#6); add the test. In `registry.tsx` SPLIT `MasteryCelebration` out of the shared Tbd fallthrough into a real case; keep `ConfidenceCheck` (and `ExplainBackPrompt` unless F-11 already moved it) in Tbd; keep the `never` default. (Convergence with F-11 on this 3-line block — see BUILD-PLAN.md.)
- [ ] **T-12-testForce seam:** add the dev-only `?testForce=mastered` seam that injects a real `transition→mastered` proposal reaching `rejectUnauthorizedAction`; gate behind `NODE_ENV!=='production'` (fail-closed on the seam). It proves the refusal; it does NOT grant mastery — the earned-it gate must still reject it when the predicate fails.
- [ ] **T-12f (integration, test-first):** UPDATE the I1 assertion at `server.integration.test.ts:264` (`afterTransfer.type==='no_action'`) to the I2 reality — drive submits → probe → transfer-pass → `explain_back_recording_ended` with a synthetic passing verdict in `payload.explainBackVerdict`, then assert (i) the agent organically proposes mastery, (ii) the earned-it gate accepts → `transition→mastered` + `MasteryCelebration` mount, (iii) the replay endpoint shows the per-turn gate evaluation (AC#5). Add a NEGATIVE test: drive the off-topic budget over via REAL `answer_question` off_topic events → assert mastery NOT proposed + persisted reason carries `mastery_gate_failed` with `topic_guardrail_exceeded` (AC#2). Add an AC#3 test using `?testForce=mastered` with the gate failing → assert downgrade to `no_action` with blockers logged. **Use the REAL fold + REAL server path, never synthetic `LearnerState`.**
- [ ] **AC#5 replay check:** confirm `GET /api/session/:id/replay` surfaces the per-turn gate evaluation from the persisted validation / `statechartReason`; if absent, add an additive per-turn `gateEvaluation:{passed,blockers}` to the event payload so the demo can show the gate failing then passing.
- [ ] **Deploy-packaging check:** F-12 adds NO new workspace package / runtime-read data dir (the verdict type lives in `@polymath/contract`, already COPYed; the new `MasteryConfig` keys live in already-COPYed `lessons/`). Run a `docker build` of `apps/agent` to confirm boot + that the gate reads degrade NON-FATALLY (fail-closed, not crash) when the verdict input is absent.
- [ ] **FULL VERIFY:** `pnpm typecheck` (registry exhaustiveness; `LearnerSnapshot` threading; confirms NO one-sided menu edit); `pnpm test`; the agent integration suite against Postgres; `docker build` of `apps/agent`; `./infra/smoke.sh`.

**Risks (carry into the build):**
- **Fail-open landmine (highest severity, VERIFIED):** `eventConsumer.ts:175` hardcodes `topicGuardrailClean: true`. The counter must derive from the real fold AND `toLoggedEvent` must actually carry `topicClassification` (today its `action` projection reads only type+component.kind).
- **Inert-refusal trap (the I1 lesson):** the gate predicate is unit-testable by handing `LearnerState` directly to `evaluateMasteryGate` — such tests pass even if `deriveState`/`toLearnerState` never compute the inputs from real events. Only the full-fold server integration test catches an inert gate.
- **Phantom persistence coupling (the convergence point):** F-12 reads `explainBackPassed` from `payload.explainBackVerdict` that F-11 must PERSIST. If F-11 ships the verdict only as an in-memory return, F-12's fold reads nothing → `explainBackPassed` stays false forever (a silent fail-closed that looks like a bug: no learner can ever be mastered). Freeze the slot + assert it in the shared fixture.
- **Statechart not driven at runtime (VERIFIED):** instrument AC#3 in the server rejection path, not the XState guard. Treating spec line 9 literally would be fiction.
- **Two-place menu lockstep:** F-12 must NOT touch `menu.ts`/`openaiClient.ts` — a one-sided edit breaks `toTacticalMove` exhaustiveness (typecheck).
- **Config additive-but-required trap:** adding `topicGuardrailBudget` as REQUIRED breaks loading of any lesson config lacking it → `loadLesson` throws at boot → agent crash → deploy rollback. Must be optional-with-default.
- **Test-seam as prod fail-open:** `?testForce=mastered` must be inert in prod AND still rejected by the earned-it gate in dev.
- **`isMastered` refactor vs rename:** server.ts:357 + gate.test.ts depend on the boolean. Use the sibling + one-line delegate.

## Implementation notes (filled in by the building agent)

> Empty.
