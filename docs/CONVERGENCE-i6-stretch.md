# Convergence report — I6 Stretch: L3 NAND · L4 De Morgan's · Handoff-to-tutor · Teacher artifact · L5 Playground

**Integration branch:** `integration/i6-stretch` (cut from `build/i6-stretch` @ `73e655c3`, the frozen I6 contract barrier)
**Assembly:** cherry-pick only, zero merge commits (linear history verified below).
**Date:** 2026-05-29

## Verdict summary

| Feature | Title | Shippable | Notes |
| ------- | ----- | --------- | ----- |
| F-22 | Lesson 3 — NAND universality | **YES** | No gating findings; 3 deferred low. |
| F-23 | Lesson 4 — De Morgan's + misconception defense | **YES** | One high finding already `fixedNow` on the branch (coverage gate); no unresolved gating. |
| F-24 | Handoff-to-human-tutor artifact | **YES** | No gating findings; 3 deferred low; one post-F-18-merge reconciliation noted. |
| F-25 | Teacher artifact (VT4S shape) | **YES** | No gating findings; 2 deferred low (test depth). |
| F-26 | Lesson 5 — Playground (free-build capstone) | **NO — BLOCKED** | Unresolved **high** gating finding (AC#5 scaffold never delivered, escalated). Left out; worktree + branch preserved. |

Four of five features shipped. F-26 is left out, not forced — its sole gating finding requires wiring the agent invocation path for the playground scaffold turn (integration work, not a localized edit), which is human judgment, exactly the carve-out the finalization brief reserves.

---

## Per-feature finalization

### F-22 — Lesson 3, NAND universality  ·  SHIPPABLE
- **Branch:** `feat/f-22` (9 commits, cherry-picked in DAG order).
- **Acceptance:** Met. L3 content/config/vocab authored and validator-clean; agent mounts L3 circuit items with a NAND-only palette; `?lesson=3` binds the session and mounts the L3 first item; four-NAND XOR pulse-through verified in the web circuit bundle. AC#3's "in the Circuit workspace" rep selection is the live LLM agent's job (the offline stub heuristic opens truth_table, same as L1/L2) — the NAND-only *restriction* is correctly applied at every circuit mount site.
- **Unresolved gating:** none.
- **Deferred low:** (1) stub heuristic opens L3 with a truth_table rep rather than circuit-first — runtime rep selection is the agent's job, not a contract change; (2) `playgroundEquivalence`/NOR tests cover sibling-feature code to keep the booleans 100% gate green — documented, no drift; (3) AC#2 three worked examples are agent-move driven (runtime LLM behaviour), consistent with L1/L2.
- **QA (this integration):** Live WS `?lesson=3` + `session_start{lessonId:3}` mounted `TruthTablePractice "NOT A"` (the L3 first item) — lesson binding proven on the running agent. Booleans coverage 100%.
- **Retro propagated:** see batch-level CLAUDE.md note (the coverage-barrier lesson is partly F-22's untested NAND grammar). Otherwise nothing material.

### F-23 — Lesson 4, De Morgan's + halfway-misconception defense  ·  SHIPPABLE
- **Branch:** `feat/f-23` (7 commits incl. `abbe60c` coverage-gate restoration; cherry-picked in DAG order).
- **Acceptance:** Met. L4 opens on De Morgan (`NOT (A AND B)`, claimedTruthTable `[1,1,1,0]`); the halfway-application submit (`[1,0,0,0]`) yields the named L1 HintCard; a correct submit produces zero false-positive hint. All 5 authored halfway columns verified genuine near-misses (recomputed via `@polymath/booleans`). Held-out halfway transfer rows (L4-07/08) present in the frozen seed.
- **Unresolved gating:** none. The one **high** finding (booleans 100% coverage red on the barrier base) was `fixedNow` on the branch — test-only additions + one `v8-ignore` on dead-defensive code, no contract signatures touched.
- **Deferred low:** the LangSmith live ≥90% LLM-judge half of AC#6 is deferred to a protected/manual maintainer-only job (MR pipelines are offline-only per the CI security invariant); the offline label half gates MRs and is green.
- **QA (this integration):** Live WS `?lesson=4` + halfway submit returned the exact named HintCard body: *"That's the halfway-application misconception: you flipped the negation but didn't flip the operator… De Morgan's law says you must ALSO change the AND to OR…"* (level 1). AC#3 proven end-to-end.
- **Retro propagated:** the coverage-barrier convergence lesson (below) is largely F-23's experience. Otherwise nothing material.

### F-24 — Handoff-to-human-tutor artifact  ·  SHIPPABLE
- **Branch:** `feat/f-24` (7 commits; cherry-picked clean, App.tsx auto-merged).
- **Acceptance:** Met (with one approved deviation). Owner route builds a contract-valid artifact + lazily mints a share URL; tokened share route authenticates by the per-session random token; warm framing, AC#2 field order, print-to-PDF via `@media print` + `window.print()`. The literal `.pdf` endpoint (raw AC#3) is an **approved deviation** (D24-1/D24-2: browser Print→Save-as-PDF, avoids Chromium in the Alpine image). Session reads scoped to `sessions.app IS NULL` (baseline-arm id → 404).
- **Unresolved gating:** none.
- **Deferred low:** (1) `.pdf` endpoint not implemented (approved); (2) bare handoff GET mints a token (learner-facing, intentionally-shareable, documented-exempt from operator auth — the followup-route pattern; idempotent in effect); (3) `ensureShareToken` concurrent-mint comment slightly overstates UNIQUE protection (same-row UPDATE is last-write-wins-safe; cross-session collision ~2^-192, unreachable); (4) production LLM rephrase seam is an intentional permanent no-op (templates are the shipped product).
- **Post-merge action (not a skip):** when F-18 (summary pipeline / `SessionSummarySchema` / `getSessionSummary`) lands, reconcile by swapping the `z.unknown()` summary placeholder for the real schema and replacing the inline summary projection with `getSessionSummary` — confined to `apps/agent/src/handoff/buildArtifact.ts` + `packages/contract/src/handoff.ts`. F-18 is not on `build/i6-stretch`.
- **QA (this integration):** Live agent — owner path on a practised session (seeded learner_state AND=0.99, OR=0.2, NOT=null) → HTTP 200, `masteredKcs:["AND"]`, `stuckKcs:["NOT","OR"]`, 3 tutorQuestions, minted shareUrl; tokened valid → 200 (artifact only, shareUrl omitted); wrong token → 403; an unpractised (zero learner_state) session → 404 "unknown session" (by-design: nothing to hand off).
- **Retro propagated:** nothing material (the build's lessons are already in CLAUDE.md: learner-facing per-token-secret exemption from operator auth; integrity scoping to `app IS NULL`).

### F-25 — Teacher artifact (VT4S shape)  ·  SHIPPABLE
- **Branch:** `feat/f-25` (1 commit; cherry-picked with conflicts in `server.ts` + `main.tsx`, resolved — see convergence below).
- **Acceptance:** Met. New operator-auth-gated `GET /api/session/:id/teacher-report` reads `learner_state` directly and returns the VT4S per-KC mastery payload; web `/teacher/:sessionId` route renders the table with an `Authorization: Bearer` fetch. This is a **DAG adaptation** (not contract drift): `build/i6-stretch` does not include F-18's `/report` endpoint or `SessionSummarySchema`, so F-25 adds its own lightweight endpoint without touching any frozen contract.
- **Unresolved gating:** none.
- **Deferred low:** (1) the agent unit test reimplements the `>=0.95` classification inline rather than asserting `buildTeacherReport`'s own loop on non-empty rows (passes for the right result but not via the real path); (2) no route-level integration test asserting 401/404/200 for `/teacher-report` directly (covered at the web component + via shared `checkOperatorAuth`).
- **QA (this integration):** Live agent with `POLYMATH_OPERATOR_SECRET` set — no auth → 401; wrong token → 401; valid token + unknown session → 404 "session not found"; valid token + practised session → 200 `{masteredKcs:["AND"], stuckKcs:["NOT","OR"], kcRows:3}`. Auth fails closed, integrity reads scoped to `app IS NULL`.
- **Retro propagated:** nothing material (reuses the established `checkOperatorAuth` operator-route pattern already in CLAUDE.md).

### F-26 — Lesson 5, Playground (free-build capstone)  ·  BLOCKED (left out)
- **Branch:** `feat/f-26` (7 commits) — **NOT cherry-picked.** Worktree `.claude/worktrees/i6-stretch/f-26` and branch `feat/f-26` preserved untouched for the human.
- **Why blocked:** one unresolved **high** spec-compliance finding (escalated by the reviewer, not fixed inline): *AC#5 "Request a hint" records the ask but the agent never delivers a scaffold.* `handlePlaygroundRequestScaffoldTurn` only inserts an events row and sends `{kind:'ack'}` — it never builds an AgentInput, never constrains to `F26_MENU`, never calls `proposeWithTimeout`, so `verify_playground_equivalence` is never invoked and the learner receives no scaffold. The fix is to wire the agent invocation path (build a playground AgentInput, constrain the menu, validate + send the action) plus an integration assertion that a scaffold-request yields a scaffold-only answer action. That is integration work needing human judgment, so F-26 is left out per the finalization contract.
- **Other (non-gating) F-26 findings, for the human when they resume:** exit_playground mounts a MasteryCelebration without re-checking the full mastery gate (cosmetic, grants nothing); PlaygroundCanvas advertises XOR/XNOR gates the grammar can't parse (dead/misleading); `playgroundEquivalence` can enumerate up to 2^20 on disjoint 10+10 var sets (bounded, ~tens of ms, not a hang); enter_playground earned-it gate checks the current lesson (matches ADR-013 D26-5).
- Note: F-26's frozen *contract* code (`playgroundEquivalence.ts`, ComponentSpec PlaygroundCanvas, ClientEvent playground kinds, `F26_MENU`) is already on `build/i6-stretch` and is consumed by the shipped features' tests for coverage; only F-26's *feature* commits are withheld. ADR-013 (which is in F-26's commits) is correctly absent from the shipped set.

---

## Batch-level

### Integrated suite (full `pnpm test` on the assembled branch)

```
Test Files  84 passed (84)
     Tests  816 passed | 2 skipped (818)
  Duration  11.93s
```

The 2 skips are the OPENAI_API_KEY-gated live-LLM eval suites (`agent/src/agent/eval/eval.test.ts`, `graph/src/explainback/eval.test.ts`) — expected offline. `pnpm typecheck` clean across all 8 projects. `pnpm build` succeeds for all packages + apps. Agent integration suite (39 tests, real Postgres on `:55432`) green, including the De Morgan misconception, handoff route, NAND, and transfer/mastery paths. `@polymath/booleans` coverage gate restored and verified green:

```
All files          |     100 |      100 |     100 |     100
```

### Smoke evidence (real running stack)

Drove the assembled agent (`tsx src/index.ts` on `:8097` against the test Postgres, `NODE_ENV=development`, `POLYMATH_ENABLE_TEST_SEAMS=true`, `POLYMATH_OPERATOR_SECRET=smoke-secret`). `GET /api/health` → `{"status":"ok"}`. No errors in the agent log.

**Primary new paths (this iteration):**
- F-22 L3 NAND: live WS `?lesson=3` → mounted `TruthTablePractice "NOT A"` (L3 first item) — lesson binding proven.
- F-23 L4 De Morgan: live WS `?lesson=4` + halfway submit → exact named De Morgan HintCard (level 1) — AC#3 proven end-to-end.
- F-24 handoff: practised session → 200 artifact (`masteredKcs:["AND"]`, `stuckKcs:["NOT","OR"]`, 3 questions, shareUrl); tokened valid → 200, wrong token → 403.
- F-25 teacher-report: no-auth/wrong-token → 401, valid+unknown → 404, valid+practised → 200 VT4S payload.

**Neighbouring existing path (regression check):**
- L1 inner loop: live WS `session_start{lessonId:1}` → mounted `TruthTablePractice "A AND B"` — the existing inner loop is intact.
- Session mint (`POST /api/session`) and the WS `/agent` round-trip both work unchanged.

### Proof of linear history (zero merge commits)

```
$ git log --merges build/i6-stretch..integration/i6-stretch
$            ← (empty: no merge commits)
```

24 feature commits + the convergence resolutions, all linear. (The empty output above is the proof.)

### Convergence conflicts + resolutions

All resolved in place as ordinary commits (no `-m`, no merge commit):
1. **`apps/agent/src/agent/eval/scenarios.json`** (F-22 ∩ F-23): both append eval scenarios to the same JSON array. Resolved by keeping the union — all L3 (F-22) scenarios followed by all L4 (F-23) scenarios. JSON re-validated.
2. **`packages/booleans/src/playgroundEquivalence.test.ts`** (F-22 ∩ F-23 add/add): both *created* the same test file to restore the package's 100% coverage gate (F-26's `playgroundEquivalence.ts` shipped untested on the barrier). Resolved by **unioning the test cases** — F-23's thorough set (at-cap boundary, `?? ''` branch, `MAX_EQUIVALENCE_VARS`) PLUS F-22's unique `vi.spyOn(booleans,'equivalent')` catch-arm test, de-duplicating test names. Verified: booleans 137 tests, 100% statements/branches/functions/lines.
3. **`apps/agent/src/server.ts`** (F-24 ∩ F-25): both register a new HTTP route at the same insertion point. Resolved by keeping both route blocks, each with its own `return;`.
4. **`apps/web/src/main.tsx`** (F-24 ∩ F-25): both add a router import + route. Resolved by keeping both imports and all four routes (`/handoff/:sessionId`, `/handoff/:sessionId/:token`, `/teacher/:sessionId`).

No conflict required human judgment; none forced a feature out.

### Features left out (blocked)

- **F-26** (`feat/f-26`): unresolved high gating finding (AC#5 playground scaffold never delivered to the learner). Worktree `.claude/worktrees/i6-stretch/f-26` and branch `feat/f-26` preserved untouched. The fix is agent-invocation wiring + a delivery assertion — human judgment.

### Load-bearing areas to review manually

- **Contract surface:** none changed. All five features consumed the frozen I6 contracts unchanged. F-25 is a DAG adaptation (its own lightweight `/teacher-report` endpoint, not F-18's `/report`); F-24 keeps the `z.unknown()` summary placeholder pending F-18.
- **Trust boundaries:** F-25 `/teacher-report` is operator-auth gated (`checkOperatorAuth`, fails closed in prod when the secret is unset); F-24 handoff is the documented learner-facing per-token-secret exemption; both scope session reads to `sessions.app IS NULL`. Worth a manual pass.
- **The booleans coverage convergence** (resolution #2): confirm the unioned test file is the intended superset.

### Durable lesson propagated

Added to `CLAUDE.md` (Contract change protocol): *a contract barrier that ships sibling-feature implementation code must ship it covered, or it reds a coverage-gated package for every feature built off the barrier — and that restoration becomes a convergence point; resolve such test-file collisions by unioning the cases.* Committed on the integration branch.
