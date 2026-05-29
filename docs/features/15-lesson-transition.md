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

## Build plan (approved)

> Planned by kmaz-plan-iteration (architect + researcher + contrarian, reconciled). Iteration slug
> **`i3i4-lessons2-baseline`**. **Model tier: Opus** — the I3 merge sink; touches the locked
> statechart, the server mastery + session path, and owns the lesson-binding contract. **Build
> order: LAST in I3, strictly after F-13 and F-14** (cannot mint a working `nextLessonId` without
> `lessons/2/`; AC#3's "L1 BKT preserved for F-14" is untestable without F-14).

**Two spec claims the build RETRACTS (verified against code):**

1. **"already supported via the existing `transition` variant" — FALSE.** `Action.transition.to` is a `PhaseName` (intra-lesson phase enum), not a lesson id; `PhaseName` has no `lesson_2` value (adding one needs a new ADR). The L1→L2 advance is a **new append-only `advance_lesson` ClientEvent kind**, handled as a server reflex.
2. **"the macro statechart transitions … guard refuses transition" framed as XState enforcement — the SERVER runs no XState actor.** The machine runs only client-side (`App.tsx useMachine`); the server's guard-equivalent is `rejectUnauthorizedAction`. So AC#2/AC#4's "macro guard" is **client theater** unless F-15 adds **real server enforcement**: an L2-advance branch in `rejectUnauthorizedAction` that re-derives L1 mastery from the event log (reusing the `gateEvaluation` already computed at `server.ts:950`) and refuses otherwise.

**Mechanism decision: session-level RE-INSTANTIATION, not a macro/parent XState machine.** (Architect's call, confirmed by researcher/contrarian: `mastered` is a `final` state — dead; a parent machine would force lesson-level states that break the locked `PhaseName`/`LESSON_PHASES` contract and every `snapshot.value` consumer.) The client extracts a `LessonSession` child keyed on `lessonId`; advancing re-mounts it with `input:{lessonId:2}`. The durable lesson-arc record is server-side `sessions.lessonProgress`.

**The single highest-risk correctness item — SAME SESSION, ALWAYS.** The advance MUST keep the existing `sessionId` (so L1 `learner_state` rows survive for F-14's recall). **Minting a new session passes F-15's own ACs but silently zeroes F-14.** And re-sending `session_start` on a session with prior L1 activity trips the agent's `alreadyStarted` reflex (`stubClient.ts:32-35`) → `no_action` → blank L2 workspace. So F-15 must (a) NOT mint a new session, (b) mount L2's first item via a **deterministic server reflex** (not the LLM — keeps AC#2's ~500ms honest; the LLM at a phase boundary is ~5-10s), and (c) either fix/sidestep the `alreadyStarted` reflex.

**Checklist:**

- [ ] **Lesson-binding contract — F-15 OWNS it (barrier).** Define `currentLessonId(db, sessionId): Promise<number>` backed by `sessions.lessonProgress` (no migration — the jsonb column exists, read/written nowhere today). Rewrite `lessonIdForEvent` (`server.ts:161-163`) to this async lookup. **F-13 consumes the read; F-14 reads cross-lesson state through it; F-15 writes the advance.** Freeze this signature in the shared-contract barrier so the three features don't triple-collide on those 3 lines.
- [ ] **Wire (barrier piece).** Add append-only `advance_lesson` ClientEvent to `packages/contract/src/wire.ts` (`{ kind, sessionId, toLessonId: z.number() }`). Co-frozen in the barrier with F-14's `CrossLessonRecall` (both touch `packages/contract` — don't race).
- [ ] **Set `nextLessonId` (server).** In `masteryCelebrationAction` (`server.ts:509`), set `nextLessonId: lesson.content.lessonId + 1` — **guarded by a non-fatal `loadLesson(2)` existence check** (a hardcoded `2` before `lessons/2/` exists = dead button → boot/turn crash). This hard-confirms F-15 is after F-13.
- [ ] **Server advance reflex + guard (Opus).** Handle `advance_lesson` as a dedicated early branch (model on the `explain_back_recording_ended` branch). Re-derive L1 mastery server-side (the real AC#4 guard); refuse with `no_action` if unmet. On accept: write `sessions.lessonProgress = { currentLessonId: 2 }`, **keep the same sessionId**, and **deterministically mount L2's `content.items[0]`** (server reflex — AC#2 500ms). Persist the transition event.
- [ ] **`alreadyStarted` fix.** Make a lesson-changing start mount the new lesson's first item despite prior session activity (`stubClient.ts:32-35`) — or sidestep entirely via the server reflex above.
- [ ] **Client wiring.** Thread `onContinue` via `RenderOptions` → `registry.tsx` → `MasteryCelebration.tsx` (button currently has no `onClick`, disabled until `nextLessonId`). Handler in `App.tsx` sends `advance_lesson`; extract `LessonSession` child keyed on `lessonId`; `socketRef` stays in `App` (stable `onMessage` routing to the active session — avoid the stale-closure bug).
- [ ] **Data-path proof (AC#3, the F-14 enabler).** Integration test: drive L1→mastery (via `?testForce=mastered`+`?testExplainBackVerdict=pass` seams), advance, assert (i) `sessions.lessonProgress.currentLessonId===2`, (ii) L1 KC `learner_state` rows still present under the same sessionId, (iii) a subsequent L2 `submit` folds against L2.
- [ ] **Tests.** Statechart: `lessonId:2` actor block (re-instantiation parity). Server unit: advance refused without server-derived L1 mastery; accepted with it. Integration: full L1→L2 (above). E2E: a thinner Playwright affordance check (infra is real — `apps/web/e2e/`, `playwright.config.ts` — but WS-uninterceptable + not in CI; **the integration test is the primary AC#6 evidence**, the browser E2E drives the seams against the live stack).
- [ ] **Verify:** `pnpm typecheck` · `pnpm --filter @polymath/statechart test` · `pnpm --filter @polymath/agent exec vitest run src/server.integration.test.ts` · `pnpm --filter @polymath/web test` · `pnpm test` · `docker build -f apps/agent/Dockerfile -t polymath-agent:f15 .` · `./infra/smoke.sh`.

**Convergence:** F-15 is the I3 merge sink — it absorbs F-13's lesson-binding read + F-14's reflex into the canonical `server.ts` shape. Strictly downstream; not concurrent. `sessions.lessonProgress` shape `{ currentLessonId, ... }` is read by F-18/F-20 later — define it as a typed interface.

## Implementation notes (filled in by the building agent)

**Barrier already shipped the contract pieces** (commit ccc49ff): `advance_lesson`
ClientEvent, `MasteryCelebration.nextLessonId`, `LessonProgress` interface,
`currentLessonId`/`lessonIdForEvent`, `sessions.lesson_progress` jsonb (migration 0001).
F-15 consumed these — no contract reshape.

**Server (`apps/agent/src/server.ts`):**
- `masteryCelebrationAction` now sets `nextLessonId = lessonId+1` guarded by a NON-FATAL
  `loadLessonIfExists(next)` (new in `lessons/loader.ts`). Absent/invalid next lesson →
  field omitted → client keeps the button disabled (fail-closed).
- `handleAdvanceLessonTurn` — a dedicated early reflex branch (modeled on the explain-back
  branch), handled BEFORE the generic agent turn so it never touches the LLM menu or the
  heuristic `alreadyStarted` reflex. Re-derives L1 mastery server-side
  (`evaluateMasteryGate`) as the real AC#4 earned-it guard; refuses with `no_action` +
  a persisted reject decision when unmet OR when `toLessonId !== currentLessonId+1` OR the
  next lesson doesn't load. On accept: writes `sessions.lessonProgress={currentLessonId}`
  on the SAME session (no new session → F-14's L1 learner_state survives), then
  DETERMINISTICALLY mounts L2's `content.items[0]` as a TruthTablePractice (server reflex,
  not the LLM). Persists exactly one event row with the gate evaluation + accept/reject.

**`alreadyStarted`:** SIDESTEPPED, not changed — the advance reflex mounts L2 directly and
never re-sends `session_start`, so `stubClient.ts`'s "session in progress → no_action" path
is never hit on advance. `stubClient.ts` was left untouched.

**Client:** `RenderOptions.onContinue` → `registry.tsx` → `MasteryCelebration` button
`onClick` (enabled iff `nextLessonId`). `App.tsx` `onContinue` sends `advance_lesson` on the
SAME `sessionId` via the stable `socketRef`; the server's L2 mount arrives as the next
`action` and re-fills the workspace. A full XState re-instantiation (extract a
`LessonSession` child keyed on `lessonId`) was deliberately left for the F-13/F-14/F-15
convergence to keep this advance edit localized; the spine is locked + the server reflex is
the real macro guard (no client machine transition added).

**Placeholder `lessons/2/`** (content/mastery_config/kc_vocabulary) — validator-passing
PLACEHOLDER so the existence check passes and the advance path is testable. **Merge blocks
on Keith/F-13 authoring the real L2 content** (the 12 practice items + prose). The truth
tables are computed via @polymath/booleans so the loader cannot throw.

**Convergence note:** the advance-reflex + lesson-binding edits in `server.ts` are localized
and commented; reconcile with F-13's L2 read + F-14's recall reflex at the I3 merge.
