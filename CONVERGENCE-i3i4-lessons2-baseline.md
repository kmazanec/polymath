# Convergence report — I3 + I4 (`i3i4-lessons2-baseline`)

**Status:** ✅ Converged and verified — ready for you to land as ONE linear MR.
**Build branch:** `build/i3i4-lessons2-baseline` @ `ba08d07` (7 commits, +7957/−240 across 80 files, off `main` @ `29bc6ff`).
**Date:** 2026-05-29 · Produced by `kmaz-build-iteration`.

This batch built **two roadmap iterations as one parallel batch** (the roadmap marks them concurrency-safe):
- **I3 — Lesson 2 + cross-lesson recall** (critical path): F-13, F-14, F-15 (merge sink).
- **I4 — chat-baseline experiment** (contract-mediated, parallel with I3): F-16, F-17.

---

## How it was built

1. **Step 0 — shared-contract barrier** (`ccc49ff`, committed before any fan-out): `currentLessonId(db,sessionId)` + async `lessonIdForEvent`; the `CrossLessonRecall` ComponentSpec kind + `advance_lesson` ClientEvent; additive migration `0001` (`app` on sessions/events, `subject_id` on sessions); the shared `scoreEquivalence` scorer in `@polymath/booleans` (both existing call sites refactored onto it). Verified green before fan-out.
2. **Fan-out** — each feature built test-first to its approved checklist in an isolated worktree off the barrier, driven for QA evidence, then run through a **6-dimension adversarial review panel** (spec/security/robustness/efficiency/convention/contrarian), each finding adversarially verified, gated-fixed on spec+security, and pushed.
3. **Converge** (this report) — squash-merged the five feature branches onto the build branch in DAG order (F-13→F-14→F-15 for I3; F-16→F-17 for I4), reconciled the shared seams, and ran the whole-iteration gates.

History is **linear** (one commit per feature + barrier + the converge fix — no merge commits):

```
ba08d07 test(converge): isolate F-17 lifecycle from the shared transfer_bank
a73f0a8 feat(F-17): experiment scaffolding — pre/post/24h-followup runners + CSV export
b79de90 feat(F-16): chat-baseline app (apps/baseline + /api/baseline/* on agent)
8bc4983 feat(F-15): L1→L2 macro transition (I3 merge sink)
8967bea feat(F-14): cross-lesson recall as a deterministic server reflex
d09a9c6 feat(F-13): Lesson 2 — composition (XOR-as-composition)
ccc49ff feat(i3i4-barrier): freeze shared contracts before fan-out
```

---

## Per-feature outcome (review panel)

| Feature | Findings (raw→real→gating) | Verdict |
|---|---|---|
| **F-13** Lesson 2 | 7 → 3 → **3 security** | Panel caught a real **fail-open**: a forged `session_start.lessonId>1` folded turn-1 against gated L2 content with the seam off (and a reconnect could downgrade an L2 session). Root-caused to a split-brain bind; fixed so `lessonIdForEvent` reads the clamped binding for every event kind. Regression tests added (fail-before/pass-after). |
| **F-14** recall | 11 → 5 → **2 robustness** | Recall card **clobbered the practice item** with no resume; fixed to a non-destructive App-level side-slot + wired dismiss/resume. Also: allow-list (stops swallowing learner questions/integrity mounts), per-session throttle lock, removed a premature production trigger (recall stays seam-only until F-15, per plan). |
| **F-15** transition | 14 → 2 → 0 | Real spine **re-instantiation** (`LessonSession` keyed on `lessonId`) so the client lands in `lesson_2.introducing` on advance — same socket, same session (preserves F-14's L1 state). App-level advance test added. |
| **F-16** baseline | 15 → 3 → 0 | SPA session-resume (no orphan rows), idempotent distinct-item score tally (can't exceed the 5 scorable items). |
| **F-17** experiment | 9 → 4 → 0 | One-shot phase submits (409), server-pinned scored item sets (no followup inflation), forged/duplicate itemIds → 400. |

All gating (spec + security) findings were fixed and re-verified on the feature branches before convergence.

---

## Convergence reconcile (what merged, what conflicted)

The plan anticipated the `apps/agent/src/server.ts` triple-collision (F-13/F-14/F-15 all touch the lesson-binding / reflex region) and `packages/contract` (F-14+F-15) — the **barrier removed the contract collision entirely** (both contract additions were frozen up front, so F-14/F-15 consumed them with zero conflict). Remaining reconciles, all resolved:

- **`server.ts`** — F-13↔F-14 conflicted on the `FrameOptions` dev-seam fields + the WS-upgrade handler (both seams `allowLessonOverride` + `testL1Bkt` kept, both wired). F-15's import was merged (`computeRecall` + `loadLessonIfExists`). F-16/F-17 route registration auto-merged (distinct `createServer` regions).
- **`apps/web/App.tsx`** (the merge sink's heart) — adopted F-15's `LessonSession` re-instantiation as the skeleton, wove in F-13's `?lesson=2` initial-lesson seam and F-14's recall side-slot. `lessonIntroContent.ts` reconciled to keep both APIs; `registry.tsx` keeps F-14's real `CrossLessonRecall` renderer + F-15's `onContinue`.
- **`lessons/2/*`** — both F-13 and F-15 scaffolded placeholders; **took F-13's canonical content** (directory owner) and updated F-15's advance test from its placeholder (`(A AND B) OR C` / `l2-and-or`) to F-13's (`(A AND B) OR (NOT C)` / `l2-and-or-c`).
- **`server.integration.test.ts`, `lesson.test.ts`** — both branches' test blocks kept (the conflicts were adjacency, not overlap).
- **Migration chain** — `0000`→`0001`(barrier)→`0002`(F-17), all additive; journal intact.
- **One converge-only fix** (`ba08d07`): the F-17 lifecycle test assumed the shared `transfer_bank` always had 4 free items, but `seed.test.ts`'s `DELETE FROM transfer_bank` could race it in the full cross-project `pnpm test` (design (ii) has zero item-bank slack). Re-seed in a `beforeEach` (idempotent) so the suite owns its precondition. The CI `agent_test` path (agent suite alone, serial) was already green.

---

## Verification evidence (whole iteration, on the assembled batch)

| Gate | Result |
|---|---|
| `pnpm typecheck` | ✅ clean across all 8 workspace projects (incl. new `apps/baseline`) |
| `pnpm test` | ✅ **658 passed / 2 skipped, 68 files** — incl. the F-13 L2-binding, F-14 recall, F-15 advance, and F-17 lifecycle integration tests all green together against a real Postgres |
| `pnpm build` | ✅ all packages + apps build (web + baseline SPA); pre-existing chunk-size warning only |
| `docker build` agent image | ✅ builds (`polymath-agent:i3i4`) |
| **Fresh-DB boot** | ✅ agent boots, runs migrations `0000→0001→0002` + transfer-bank seed, serves `/api/health` **200** — the deploy-crash class (bad migration / missing COPY) is clear |
| In-image checks | ✅ `/app/lessons` ships `1` + `2`; 5 experiment tables present; `app`/`subject_id` columns present; `transfer_bank` seeded with 8 L1 items |
| Live route round-trips | ✅ `POST /api/baseline/session` → **503** (fail-closed without `OPENAI_API_KEY`, correct); `POST /api/experiment/subjects` → **201**; `pretest/start` serves exactly 4 items; `export.csv` emits the frozen 9-column header |
| Deploy wiring | ✅ baseline service in both compose files; Caddy `/baseline*` route in both caddyfiles; `docker-compose.yml config` validates |

> **Note on the shared-test-container flake (pre-existing, not a code defect):** the *first* `pnpm test` run that introduces a new migration on a freshly-reset shared container can show a `pool.end()`/`column already exists` migration race across parallel projects; it clears on the next run (the migration is then applied). This does **not** affect CI — the `agent_test` job runs the agent suite alone against its own sibling Postgres (verified green, 294/295). Documented here so it isn't mistaken for a regression.

---

## ⚠️ Merge MUST block on these (human action required)

These were shipped as **validator-passing placeholders** by design (the agent cannot author them); they are pedagogically/structurally coherent but not human-authored, and the iteration is **not learner-facing until they're done**:

1. **F-13 — the 12 L2 practice items + L2 intro/IntroExplanation prose** (~1.5 days). Placeholders compute every `truthTable` via `@polymath/booleans` (so `loadLesson(2)` can't throw) and keep XOR strictly as the composition `(A AND NOT B) OR (NOT A AND B)`, never the bare keyword. **Author the real pedagogy before this goes live.**
2. **F-17 — the IRB-light consent form** (`experiments/baseline/consent-form.md`, ~½ day). The agent scaffolded the structure; **you write/review the legal content** before running real subjects.

## Carried risks / follow-ups (non-blocking)

- **F-17 design (ii) has ZERO item-bank slack** — 4 pre + 4 shared-post = all 8 L1 transfer items exactly. If L1 transfer items are ever added/removed, re-check the pre/post exclusion math. (A future L1-bank expansion is the clean long-term fix; tracked as the descoped option (i) from D1.)
- **F-13 WorkedExample web renderer** — descoped per D4 (the web renderer is a `<Tbd>` stub; AC#3 is satisfied at the agent layer). Filed as a follow-on if a learner-facing WorkedExample is wanted.
- **F-14 production recall trigger** — intentionally OFF until this lands; the reflex fires for real once F-15's in-session L1→L2 advance preserves L1 `learner_state` (it does), but the trigger is wired through the seam for standalone eval. Confirm the intended production-on behavior in a follow-up once real L2 content lands.
- **F-16 baseline** requires `OPENAI_API_KEY` in production to function (fails closed 503 otherwise — intentional fairness/security). The DNS/Caddy `/baseline/` route is wired; confirm the key is set on the droplet before demoing the baseline arm.
- **`apps/web` bundle** is >500 kB (pre-existing warning, not introduced here).

---

## To land this as one MR

The five feature branches (`build/i3i4-lessons2-baseline-f13|f14|f15|f16|f17`) are **fully subsumed** by the converged `build/i3i4-lessons2-baseline` — they can be deleted after you land it. Suggested:

1. Review this branch's diff against `main` (`git diff main..build/i3i4-lessons2-baseline`).
2. Land it (rebase onto `main` if `main` moved; the history is already linear).
3. Author the two blocking placeholders (F-13 content, F-17 consent) before the iteration is learner-facing.
4. Tear down the per-feature branches + worktrees (`.claude/worktrees/i3i4-lessons2-baseline/*`) and the `_converge` worktree.

The CI MR pipeline (`verify` + `agent_test`, both offline — no provider key) is the gate; all new LLM paths (baseline chat, L2 evals) are mocked there, with live-judge/eval steps confined to the protected `main` job.
