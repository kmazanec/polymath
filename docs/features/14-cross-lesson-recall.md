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

## Build plan (approved)

> Planned by kmaz-plan-iteration (architect + researcher + contrarian, reconciled). Iteration slug
> **`i3i4-lessons2-baseline`**. **Model tier: Opus** (touches `packages/contract` — the most
> load-bearing package — plus the server reflex path). **Build order: SECOND in I3** (after F-13,
> after the barrier; concurrent with F-13 except the shared `server.ts` seam). **Cuttable** — if I3
> capacity shrinks, drop F-14 and F-15 still merges.

**Architecture decision the build inherits (both researcher + contrarian converged here):**

- **Recall is a deterministic SERVER REFLEX, not an LLM-emitted menu move.** Model it on the existing transfer-pass→explain-back reflex (`server.ts` ~992-1017): the server reads L1 KC BKT, checks `< 0.85`, checks the throttle + phase, and mounts `CrossLessonRecall` directly — bypassing the LLM. **Do NOT add `recall_lesson1_kc` to `F06_MENU`/`TacticalMove`/the OpenAI `MoveSchema`** (avoids the two-place menu lockstep cost and keeps the trigger off the forgeable LLM path). The spec's "recall_lesson1_kc Action" / "agent menu extension" framing is superseded.
- **No new wire `Action` variant.** Recall is a `{ type:'mount', component:{ kind:'CrossLessonRecall', ... } }` over the existing `mount`. The ONLY contract change is the new `ComponentSpec` kind.
- **`CrossLessonRecall` is text-only** (KC name + prose reminder + dismiss button) — NO rep rendering, NO `visibleReps` field. This eliminates the probe-integrity leak (a recall card can't expose a held-out rep). Additionally **suppress the reflex during the `transferring` phase** (`inTransferProbe` is already computed server-side).

**Data-availability reality the build inherits (contrarian, verified):** `learner_state` is keyed `(sessionId, kc)`. L1 KC BKT only exists in an L2 session if the SAME session ran L1 — i.e. **after F-15's in-session L1→L2 transition**. So F-14's real trigger is enabled by F-15, not before. For standalone build/eval, the L1 BKT comes from a **`POLYMATH_ENABLE_TEST_SEAMS`-gated injection seam** (synthetic L1 BKT). The plan states plainly: there is **no production recall trigger until F-15 lands**; F-14 standalone is demo/eval-only against the seam. (This inverts the spec's stated DAG — F-14 effectively depends on F-15's session-continuity — handled by building F-14 before F-15 but accepting it only *fires* once F-15 preserves L1 state in-session.)

**Checklist:**

- [ ] **Contract (barrier piece, Opus).** Add the `CrossLessonRecall` variant to `packages/contract/src/component.ts` (frozen shape: `kind` literal, `kc: string`, `currentItemId: string`, `priorBktAtRegression: number`, `reminderBody: string` — text-only, no `visibleReps`), append to `COMPONENT_KINDS`, add a sample to the `componentSamples` record in `index.test.ts` (the set-equality test enforces this). **Lands in the shared-contract barrier** (co-frozen with F-15's `advance_lesson` event so F-14/F-15 don't race on `packages/contract`).
- [ ] **Web renderer.** New `apps/web/src/components/CrossLessonRecall.tsx` (model on `HintCard.tsx`: `role="note"`, `data-kc`, "got it, continue" button). Add the `case 'CrossLessonRecall':` to the exhaustive switch in `registry.tsx` (the `never` default forces it). Add `onDismiss` to `RenderOptions` if a dismiss event is wired.
- [ ] **Regression detector (Sonnet, pure module).** New `apps/agent/src/agent/regression.ts`: `detectRegression({ l1BktByKc, sessionId, currentItemId })` returning the first L1 KC `< 0.85` not yet recalled; pure + unit-tested (threshold boundary: 0.85 does NOT trigger, 0.849 does; empty `l1BktByKc` → null).
- [ ] **Server reflex + L1-BKT read (Opus, shared `server.ts`).** Wire the reflex before the agent turn (alongside the explain-back reflex). Read L1 KC BKT via `learner_state WHERE sessionId=? AND kc IN (L1 KCs)`. Suppress during `transferring`. Construct + mount `CrossLessonRecall` server-side (it bypasses the earned-it gate because the server is the truth-maker — the BKT check IS the earned-it check). Add the `POLYMATH_ENABLE_TEST_SEAMS`-gated synthetic-L1-BKT injection seam for standalone eval.
- [ ] **Throttle = UNCAPPED event-log query (CLAUDE.md monotonic rule).** "≤1 recall per session per KC" derived from a separate uncapped `count(*)` over `events` where `payload->'action'->'component'->>'kind'='CrossLessonRecall'` and `...->>'kc'=$kc` (model on `countOffTopicAnswers`, `server.ts:136-146`) — NOT the bounded `MAX_SESSION_EVENTS` fold, NOT in-memory (would die on reconnect / drift on cap).
- [ ] **Tests.** Component test (`CrossLessonRecall.test.tsx`); `regression.test.ts` unit; integration test (seed `learner_state` for L1 KC at BKT 0.72 under a session → L2 `submit` → recall fires once → second submit suppressed; second KC at 0.70 → fires for it). LangSmith/heuristic eval ≥90% against the synthetic seam (offline).
- [ ] **Verify:** `pnpm typecheck` · `pnpm --filter @polymath/contract test` · `pnpm --filter @polymath/web exec tsc --noEmit` (exhaustive switch) · `pnpm --filter @polymath/agent exec vitest run src/agent/regression.test.ts` · `pnpm --filter @polymath/agent test` · `pnpm test` · `docker build -f apps/agent/Dockerfile -t polymath-agent:f14 .`.

**Convergence:** the contract edit is the only `packages/contract` touch in I3 and is co-frozen in the barrier with F-15's `advance_lesson`. Shared with F-13/F-15 on the `server.ts` reflex/lesson-binding region — sequence F-13 → F-14 → F-15; expect a small `server.ts` reconcile at the F-15 merge sink.

## Implementation notes (filled in by the building agent)

> Empty.
