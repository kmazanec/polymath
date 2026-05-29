# Feature: Lesson 5 — Playground (free-build capstone)

**ID:** F-26 · **Iteration:** I6 — Stretch · **Status:** Built (feat/f-26)

## What this delivers (before → after)

**Before:** All lessons are directed practice — the agent picks items, the learner solves them. There is no free-build mode. The capstone demo flex per [ADR-002](../adrs/ADR-002-curriculum-scope-and-mvp-cut.md) is absent.

**After:** A playground mode where the learner proposes a target Boolean function (in any of the three reps) and the system challenges them to express it in the other two. Free-build mode is structurally different from directed practice — it lives in its own substate (or its own micro-statechart per Open Question 5 from ARCHITECTURE.md). The agent's role flips: it's no longer choosing the curriculum but rather verifying equivalence across the learner's reps and providing scaffolding when requested.

## How it fits the roadmap

I6, **fifth (last) stretch priority**. Often cut.

## Dependencies (must exist before this starts)

- **F-23** — L4 closes the curriculum; playground builds on the full vocabulary.

## Unblocks (what waits on this)

None.

## Contracts touched

- **Statechart spine** — adds a `playground` macro-state (decision per F-26 implementation: substate of an extended macro, or its own micro-statechart). Resolves [ARCHITECTURE.md Open Question 5](../ARCHITECTURE.md#open-questions).
- **`ComponentSpec`** — likely adds a new `PlaygroundCanvas` variant (the multi-rep simultaneous workspace).
- **Agent menu** — extends with a `verify_playground_equivalence` action.

## Sub-tasks

1. **T-26a — Decision: substate or micro-statechart** `[serial]`
   - Resolve Open Question 5 in this feature's planning.
2. **T-26b — `PlaygroundCanvas` component** `[parallel after T-26a]`
   - All three reps visible simultaneously, all editable.
   - The learner proposes a target via text/expression; can build in any rep.
   - On submit, all three reps are equivalence-checked against the proposed target.
3. **T-26c — Agent role: verifier + scaffold-on-request** `[parallel after T-26b]`
4. **T-26d — Entry from L4 mastery** `[parallel after T-26b]`

## Acceptance criteria (product behavior)

1. **A learner mastering L4 sees a "try the playground" affordance**; clicking it enters the playground mode.
2. **The learner proposes a target expression** via a text input.
3. **All three reps become editable simultaneously**; the learner can build in any.
4. **Pressing `Submit`** runs equivalence checks across all three reps against the proposed target and against each other.
5. **The agent provides scaffolding on request** but does not direct.
6. **The playground is exitable** back to a session-end celebration.

## Testing requirements

- Statechart test for the playground substate or micro-statechart.
- Integration test: full L1→L5 arc in a single session.
- Component test for PlaygroundCanvas.

## Manual setup required

None.

## Convergence and expected rework

None — F-26 is the last feature in the roadmap and runs strictly after F-23.

## Implementation notes (filled in by the building agent)

**T-26a — Open Question 5 resolved (ADR-013).** The playground is its OWN micro-statechart (a sibling machine), NOT a substate of the locked lesson spine. Rationale: the locked phase shape is a directed-practice grammar (every transition presumes a server-picked item + BKT/streak/transfer/mastery folds the playground has none of); a sibling machine adds NO phase to `PhaseName`/`LESSON_PHASES`, honoring the F-01 lock literally. The playground machine (`createPlaygroundMachine`) imports neither `PhaseName` nor `lesson.ts`; the statechart test asserts `LESSON_PHASES` is unchanged so any future coupling fails CI.

**Frozen-base note.** The I6 contracts barrier (`73e655c`) already landed every cross-cutting contract this feature touches: the `PlaygroundCanvas` `ComponentSpec` variant + `COMPONENT_KINDS` entry (with the contract round-trip test), the four append-only `ClientEvent` kinds, the `verify_playground_equivalence` menu move + its `openaiClient.ts` lockstep half, the `playgroundEquivalence` booleans export, the `HandoffArtifact` schema + the `share_token` migration, and a routing stub in `server.ts` that acks the four playground events. F-26's build work is therefore the FEATURE BEHAVIOR on top of those frozen shapes: ADR-013, the `playground.ts` micro-statechart, the `playgroundEquivalence.test.ts` (the frozen export shipped without a test → below the package's 100% coverage gate), the real `PlaygroundCanvas.tsx` + registry case (replacing the TBD placeholder), the real server handlers (replacing the bare ack), and the App wiring.

**AC#5 scaffold delivery — fixed post-MR (this is why F-26 was initially held).** The first build shipped `handlePlaygroundRequestScaffoldTurn` as an ack-only no-op: it persisted the ask and sent `{kind:'ack'}` but never invoked the agent, so the learner clicking "Request a hint" received nothing — AC#5 unmet. The I6 build reviewer correctly flagged this **high/spec-compliance** and *escalated* it (left F-26 out of the I6 MR) rather than patch it inline, since the fix is integration work. Resolved on `feat/f-26` (rebased onto post-I5 `main`): (1) the server handler now builds a scaffold-only `verify_playground_equivalence` move, `compileMove`s it to an on-topic `answer_question`, re-validates via `validateOutboundAction`, and sends `{kind:'action'}` — the move can only compile to an answer/`no_action`, never a transition, so the playground stays ungraded and the LLM is never the verdict authority (D26-3); the scaffold is a deterministic Socratic nudge across the three reps that never reveals the answer key (works with no LLM key). (2) Client gap (the "gate nobody can see" half): the playground view *replaces* `LessonSession`, which is what normally renders the agent `answer`, so a delivered scaffold was set in state but never shown — `PlaygroundCanvas` gained a `scaffold` prop (rendered in a `role=status` side slot), threaded via `RenderOptions.playgroundScaffold` from App's `AgentAnswer` state. (3) Tests: the integration test that asserted `ack` (it had codified the bug) now asserts a scaffold *action* is delivered + persisted off the graded path; the component test now asserts the delivered scaffold actually renders. No new server-side `equivalent()`/`truthTable()` over learner input → no DoS surface.

**Build decisions (as implemented).**
- **Verdict authority is the client; the server recompute is defense-in-depth (D26-3).** `PlaygroundCanvas` computes the cross-rep verdict via `playgroundEquivalence` in the browser (correctness off the network); the server's `handlePlaygroundSubmitTurn` recomputes it for the persisted record only and writes NO BKT/streak/mastery. For the truth-table rep (which authors no expression — the learner fills the target's table) the client feeds the target itself when its own correctness flag is true and a sentinel otherwise, so `playgroundEquivalence` stays the single client verdict authority; the server recompute compares the submitted cells directly to `truthTable(target).out`.
- **Earned-it entry, read-only (D26-5).** `handleEnterPlaygroundTurn` gates on the current lesson's mastery gate re-derived via a NEW `deriveMasteryReadOnly` helper — `app IS NULL`-scoped, uncapped off-topic total, and crucially writing NOTHING (the existing `updateAndReadLearnerState` re-persists `learner_state`, which an ungraded playground turn must not do). Fail-closed: an unmastered/forged session gets a `503`-style error and no canvas. `handleExitPlaygroundTurn` uses the same read-only derive for the celebration's server-sourced `conceptsMastered`. The integration test asserts `learner_state` is byte-identical across a `playground_submit`.
- **"Try the Playground" is a terminal-celebration affordance (D26-4).** Rather than coupling to a hardcoded lesson number, the App offers it on any `MasteryCelebration` with **no `nextLessonId`** (the last lesson's celebration; intermediate lessons always carry a next). `MasteryCelebration` gained an additive `onTryPlayground` prop (no contract change); the App threads it only on a terminal celebration.
- **DoS cap on the learner-authored target (D26-2).** `playgroundEquivalence` already caps BOTH sides at `MAX_EQUIVALENCE_VARS`; `PlaygroundCanvas` additionally refuses a target over 8 distinct variables at the *propose* step (a friendlier, earlier bound than the equivalence cap) so a huge truth table is never even rendered.
- **booleans 100% coverage restored.** The frozen `playgroundEquivalence` export and the NAND/NOR grammar additions shipped below the package's 100% gate; this build adds `playgroundEquivalence.test.ts` and additive NAND/NOR cases for `astToExpression`/`evaluate`/`parsePseudocode`. The one defensive `catch` around `equivalent()` (unreachable once `withinCap` proved both sides parse under cap) is `c8`-ignored with a rationale — the only body edit to a frozen file, and not a signature/contract change.

---

## Build plan (approved)

**Planned:** 2026-05-29 (kmaz-plan-iteration, 3-draft panel + synthesis) · **Manifest:** [BUILD-PLAN-i6-stretch](../BUILD-PLAN-i6-stretch.md) · **Build tier:** Opus (contract variant + new statechart + lockstep menu move + DoS-sensitive equivalence + new ADR — do not split).

> **Open Question 5 → RESOLVED: playground is its OWN micro-statechart (sibling machine), documented in new ADR-013. The locked lesson spine is untouched.** A spine substate was rejected: the locked phase shape is a directed-practice grammar (every transition presumes a server-picked item + BKT/streak/transfer folds the playground has none of); a sibling machine adds **no phase** to the spine (it composes *after* the L4 machine's `mastered` final state), honoring "fill guard bodies, never re-shape the spine; new phases need a new ADR" literally. **ADR-013 is required and is the first build step.**

### Summary
A post-mastery free-build capstone. After mastering L4 the learner sees a "Try the Playground" affordance on the L4 `MasteryCelebration`; clicking it enters Playground mode driven by a new sibling XState micro-machine (`createPlaygroundMachine`) — `lesson.ts`/`LESSON_PHASES` **untouched**. The mode renders a new `PlaygroundCanvas` `ComponentSpec` variant **composing the three existing rep editors** (all visible/editable) + a learner target-expression input. On Submit, the canvas computes a **client-side** cross-rep equivalence verdict (each rep vs the target AND vs each other) via a new var-capped `playgroundEquivalence` booleans helper (<5ms, off the network). The agent flips to **scaffold-on-request only** (a new lockstep `verify_playground_equivalence` move that compiles to a scaffold mount, never a mastery transition); the server recomputes the verdict purely for the persisted record + an earned-it entry gate. Exitable to a session-end `MasteryCelebration`.

### Files to create
- `docs/adrs/ADR-013-playground-micro-statechart.md` — resolves Open Question 5; `Supersedes: none`; the sibling-machine WHY.
- `packages/statechart/src/playground.ts` (+ `.test.ts`) — `createPlaygroundMachine()` + `PLAYGROUND_PHASES` (`proposing→building→checking→{satisfied,mismatch}→ended`; `mismatch→building`; any→`ended`). No `PhaseName`/`lesson.ts` import; the test asserts `LESSON_PHASES` unchanged.
- `packages/booleans/src/playgroundEquivalence.ts` (+ `.test.ts`) — `playgroundEquivalence(target, submissions)` wrapping `scoreEquivalence`/`equivalent`, applying the distinct-variable cap to **both** the target and each submission; returns per-rep booleans + `allAgree`.
- `apps/web/src/components/PlaygroundCanvas.tsx` (+ `.test.tsx`) — composite: target input + the three existing rep components (`visibleReps` = all three) + Submit (client-side verdict) + per-rep badges + scaffold-request + Finish/exit.

### Files to modify
- `packages/contract/src/component.ts` — add `PlaygroundCanvas` to the `ComponentSpec` union AND `'PlaygroundCanvas'` to `COMPONENT_KINDS` (ADDITIVE). **No `claimedTruthTable`** (the learner authors the target; Layer-2 recompute N/A).
- `packages/contract/src/wire.ts` — append-only `ClientEvent` kinds: `enter_playground`, `playground_submit`, `playground_request_scaffold`, `exit_playground` (reuse `RepSubmission` + `MAX_EXPRESSION_LEN`).
- `apps/web/src/components/registry.tsx` — add `case 'PlaygroundCanvas':` (the `never` default forces it) + thread new `RenderOptions` handlers.
- `apps/agent/src/agent/menu.ts` — add `verify_playground_equivalence` to `TacticalMove` + `F26_MENU = [...<then-current menu const>, 'verify_playground_equivalence'] as const` + a `compileMove` arm (scaffold mount or `no_action`; **NEVER a mastery transition**).
- `apps/agent/src/agent/openaiClient.ts` — **lockstep:** extend `MoveSchema` enum (source from `F26_MENU`) + add the `toTacticalMove` arm (keep exhaustive).
- `apps/agent/src/server.ts` — `handleEnterPlaygroundTurn` (earned-it: re-derive L4 mastery from the event log, fail-closed, `events.app IS NULL`), `handlePlaygroundSubmitTurn` (server recompute via `playgroundEquivalence` for the record only — NO BKT/streak/mastery write), `handleExitPlaygroundTurn` (mount session-end `MasteryCelebration`); route the new kinds in `handleClientFrame`.
- `apps/agent/src/agent/prompt.ts` — one paragraph: in playground the agent is verifier/scaffold, never asserts equivalence.
- `apps/web/src/components/MasteryCelebration.tsx` — add a "Try the Playground" button when `lessonId === 4` (separate from `nextLessonId`).
- `apps/web/src/App.tsx` — instantiate `createPlaygroundMachine`, mount `PlaygroundCanvas` on the affordance, dispatch the new events, render verdicts, exit → `MasteryCelebration`.
- `packages/contract/src/index.test.ts` — round-trip cases for the new variants.

> **No `lessons/5/` directory** — the generic advance reflex would break on `content.items[0]`; entry is the dedicated `enter_playground` event, not `advance_lesson`. **No Dockerfile COPY change** (source-only additions to existing packages).

### Build sequence (test-first)
- [x] **T-26a (serial):** write `docs/adrs/ADR-013-playground-micro-statechart.md` (own micro-statechart; cite the locked-phase-shape invariant). Mark Open Question 5 resolved.
- [x] Test-first `playground.test.ts` (`proposing→building→checking→satisfied|mismatch`, `mismatch→building`, any→`ended`; assert `LESSON_PHASES` unchanged), then `createPlaygroundMachine()` + index export.
- [x] Test-first `playgroundEquivalence.test.ts` (3 reps ≡ target → allAgree; one wrong → that rep false; **over-cap target → all false, no enumeration**; over-cap submission → false; unparseable → false), then `playgroundEquivalence` (cap target too). *(The export shipped in the frozen barrier; this chunk adds the missing test to restore the package's 100% coverage gate, plus additive NAND/NOR coverage cases for `astToExpression`/`evaluate`/`parsePseudocode` that the frozen grammar additions left uncovered.)*
- [x] **Contract (coordinated):** add `PlaygroundCanvas` to the union + `COMPONENT_KINDS`; add the 4 `ClientEvent` kinds; round-trip cases in `index.test.ts`. `pnpm --filter @polymath/contract test` + `pnpm typecheck` (registry.tsx now fails exhaustiveness — proves the contract landed). *(Landed in the frozen I6 contracts barrier `73e655c`; consumed unchanged. The web renderer case + agent menu/server were the feature work on top.)*
- [x] Web renderer: `case 'PlaygroundCanvas':` + new handlers (fixes exhaustiveness).
- [x] Test-first `PlaygroundCanvas.test.tsx`, then `PlaygroundCanvas.tsx` (compose three rep components, `visibleReps=['truth_table','circuit','pseudocode']`, target input, Submit client-side verdict, per-rep badges, scaffold-request, Finish).
- [x] Agent menu lockstep: `verify_playground_equivalence` in `TacticalMove`+`F26_MENU`+`compileMove`; extend `openaiClient.ts`; update `prompt.ts`. `pnpm --filter @polymath/agent typecheck` (a missed lockstep half = non-exhaustive-switch error).
- [x] Server: `handleEnterPlaygroundTurn` (earned-it, `app IS NULL`, fail-closed), `handlePlaygroundSubmitTurn` (recompute + persist, no BKT/mastery), `handleExitPlaygroundTurn`; route in `handleClientFrame`.
- [x] App wiring: "Try the Playground" on the L4 `MasteryCelebration` (AC#1); wire enter/submit/scaffold/exit to the socket; exit → celebration (AC#6).
- [x] Integration test: full L1→L4-mastered→playground→exit arc in one session (Testing #2).
- [x] `pnpm typecheck && pnpm test && pnpm build`; confirm the `lesson.ts` diff is **empty**; QA in-browser. *(All green: 72 files / 711 passed / 2 skipped (pre-existing non-PG conditionals). `git diff 73e655c..HEAD -- packages/statechart/src/lesson.ts` and the frozen contract source files are empty. Browser QA via a throwaway harness (removed, never committed): drove the real compiled `PlaygroundCanvas` in Chrome — phase-1 target input → phase-2 all three reps simultaneously (truth table + circuit palette incl. NAND/NOR + pseudocode) → "Check my work" produced `{"verdict":{"byKey":{"truth_table":true,"pseudocode":true},"allEquivalent":true}}` with per-rep match badges → "Request a hint" fired the scaffold ask → "Finish" exited.)*

### Contracts touched (all ADDITIVE)
- **`ComponentSpec`** — new `{ kind:'PlaygroundCanvas', visibleReps: z.array(Rep) }` + `'PlaygroundCanvas'` in `COMPONENT_KINDS` (3-place coordinated change; `never` default enforces the registry case). No `claimedTruthTable`.
- **`ClientEvent`** — append-only `enter_playground` / `playground_submit` (target + per-rep `RepSubmission` optionals, `.max(MAX_EXPRESSION_LEN)`) / `playground_request_scaffold` / `exit_playground`.
- **Agent menu** — LOCKSTEP additive `verify_playground_equivalence` (payload `{ scaffold?: string; rationale }` — **scaffold-only**, the LLM is never the verdict authority); `F26_MENU` chains off the **then-current** menu const (F-23's, if any), not `F06_MENU`.
- **New booleans export** `playgroundEquivalence(target, submissions)` — additive; locked signatures untouched.
- **NOT touched:** `Action` union, `PhaseName`/`LESSON_PHASES`/`lesson.ts`, `@polymath/booleans` locked signatures, `circuitModel.ts` `GateKind` (consumes F-22/F-23's NAND/NOR, doesn't modify).
- **Collision flags (F-26 runs LAST, rebases on top):** `component.ts`+`wire.ts`+`registry.tsx` (also F-24/F-25); `menu.ts`+`openaiClient.ts`+`prompt.ts` (also F-23 — chain `F26_MENU` off the then-current const); `server.ts` (F-24/F-25 report routes + celebration/advance machinery).

### Tests → AC
- `playground.test.ts` → Testing #1; underpins AC#3/#6 · `playgroundEquivalence.test.ts` → AC#4 + the over-cap-target DoS guard · `PlaygroundCanvas.test.tsx` → Testing #3; AC#2/#3/#4/#5/#6 · server unit (entry refuses when L4 mastery not earned; submit recompute matches client, `app IS NULL`, no BKT write) → AC#1 earned-it + integrity · agent lockstep typecheck → AC#5 · L1→L5 full-arc integration → Testing #2; AC#1/#6 · contract round-trip → new variants parse.

### Risks / open decisions
- **D26-1 — substate vs micro-statechart (Open Question 5).** RECOMMENDED & chosen: **own micro-statechart + ADR-013**; spine untouched (rejection rationale in the banner).
- **D26-2 — DoS: cap the learner-authored target (headline integrity).** RECOMMENDED & chosen: `playgroundEquivalence` applies the distinct-variable cap to **both** the target and each submission; over-cap on either → verdict `false`, never enumerate. The real gap: `scoreEquivalence` caps only the submission, **not** the canonical — and here the target *is* the learner-controlled canonical (a 26-var target → 2^26 enumeration, hanging browser or event loop). Cap on the client AND the server recompute.
- **D26-3 — agent role: scaffold-only, LLM never the verdict authority.** RECOMMENDED & chosen: the verdict is the client-side `playgroundEquivalence` call (locked "correctness off the network, learner sees correct before the agent decides"); the new move exists only for scaffold-on-request (AC#5) and compiles to a scaffold mount; the server recompute is defense-in-depth (like Layer 2).
- **D26-4 — no `lessons/5/`.** RECOMMENDED & chosen: entry is the dedicated `enter_playground` event; `loadLessonIfExists(5)` correctly stays undefined so L4's `masteryCelebrationAction` won't set `nextLessonId:5` — the "Try the Playground" button is a separate affordance, earned-it-checked server-side.
- **D26-5 — integrity scoping/fail-closed:** `handleEnterPlaygroundTurn` re-derives L4 mastery, scopes `events.app IS NULL`, fails closed; `handlePlaygroundSubmitTurn` persists verdicts but writes NO BKT/streak/mastery and scopes `app IS NULL`. No new operator route / env-gated service.
- **D26-6 — probe-integrity:** trivially satisfied (all reps visible), but `PlaygroundCanvas` must still pass `visibleReps=['truth_table','circuit','pseudocode']` so each rep's existing `visibleReps` gate renders it.

### Dependencies & DAG position
- **Blocked by F-23** (L4 + full NAND/NOR vocabulary in the booleans grammar AND `circuitModel.ts`): `playgroundEquivalence` must parse every gate the learner can type; the circuit rep must render NAND/NOR. **F-23 merges first** (soft-orders after F-22, which F-23 subsumes).
- **Runs STRICTLY LAST in I6** — rebases on top of all other I6 features (inherits their `menu.ts`/`contract`/`server.ts` changes).
- **Unblocks:** nothing (terminal feature). **Not blocked by F-18/F-24/F-25** (exit goes to the existing `MasteryCelebration`, not the F-18 report).
