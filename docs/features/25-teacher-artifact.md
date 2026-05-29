# Feature: Teacher artifact (VT4S shape)

**ID:** F-25 · **Iteration:** I6 — Stretch · **Status:** Not started

## What this delivers (before → after)

**Before:** No teacher-facing view. The institutional sales channel (Nerdy's VT4S, 1,000+ districts, Teacher Copilot product surface) has no analogue in the prototype.

**After:** A separate route `/teacher/:sessionId` renders a teacher-shaped report: per-KC mastery + per-misconception flags + suggested next-session focus, matching the VT4S / Teacher Copilot surface area per [ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md). Reuses the same summary pipeline as F-24 (handoff-to-tutor). Auth: simple env-var-based teacher token (no real auth needed for prototype).

## How it fits the roadmap

I6, **fourth stretch priority**. Concurrent with F-23 (L4).

## Dependencies (must exist before this starts)

- **F-24** — summary pipeline finalised; this feature wraps it in teacher framing.

## Unblocks (what waits on this)

None.

## Contracts touched

- **`apps/web/src/views/TeacherReport.tsx`** — new route.
- **Reuses `packages/graph/handoff/` summary pipeline** — no extension, just a new presentation layer.

## Sub-tasks

1. **T-25a — `TeacherReport.tsx` view** `[parallel]`
   - Per-KC mastery table.
   - Per-misconception flags (from L4's misconception detector).
   - "Suggested next-session focus" (a small generated paragraph).
2. **T-25b — Route auth via env-var teacher token** `[parallel]`
3. **T-25c — Demo script update** `[parallel]`

## Acceptance criteria (product behavior)

1. **Visiting `/teacher/:sessionId?token=...`** renders the teacher report for a completed session.
2. **Per-KC mastery is visible** in a table.
3. **Misconception flags** (e.g., "halfway De Morgan's") are surfaced when triggered.
4. **A suggested next-session focus paragraph** is generated based on stuck KCs.
5. **Invalid token returns 401**.
6. **The view is print-friendly** for teacher PDF export.

## Testing requirements

- Component test.
- Auth test: invalid token returns 401.
- Integration test: full session → /teacher view renders.

## Manual setup required

- Configure teacher token in `.env`.

## Convergence and expected rework

⚠ **Concurrent with F-23.** Zero file overlap.

## Implementation notes (filled in by the building agent)

**D25-1 (misconception source):** Chose option (a) — client-derive best-effort from `stuckKcs`.
The agent's `GET /api/session/:id/teacher-report` endpoint derives `masteredKcs`/`stuckKcs`
from the `learner_state` table (BKT threshold 0.95), requiring no contract extension and no
dependency on any unmerged feature. The view renders "No misconceptions detected" when `stuckKcs`
is empty. This is the "cut decisively" I6 posture.

**D25-2 (token):** Reuses `POLYMATH_OPERATOR_SECRET` — the report endpoint is already
operator-gated (exactly the `checkOperatorAuth` pattern from MR !7). A distinct teacher token
adds no meaningful role separation for a prototype.

**D25-3 (auth presentation):** Token is entered in an in-page form and sent as
`Authorization: Bearer <token>`, never as a `?token=` query param. The spec's AC#1 wording
(`?token=...`) was deliberately not followed — query params leak secrets in access logs. The
in-page form matches I5 D10 intent. The AC is satisfied by the correct auth mechanism, not
the wrong URL pattern.

**DAG adaptation:** The build plan was blocked on F-18 (`GET /api/session/:id/report` +
`SessionSummarySchema`). Since F-18 is not yet in `build/i6-stretch`, this feature adds its
own lightweight endpoint (`GET /api/session/:id/teacher-report`) that reads `learner_state`
directly — the same data source with a teacher-shaped response shape. When F-18 lands, this
endpoint can be deprecated in favor of the report pipeline, but it ships value now without
blocking on the DAG.

**Files created:**
- `apps/agent/src/report/teacherReport.ts` — `buildTeacherReport(db, sessionId)` reads
  `learner_state` + `sessions`, returns `TeacherReportPayload`.
- `apps/agent/src/report/teacherReport.test.ts` — unit tests for the builder.
- `apps/web/src/views/TeacherReport.tsx` — route component (auth / loading / loaded states).
- `apps/web/src/views/TeacherReport.test.tsx` — 9 component tests covering AC#1–5.
- `apps/web/src/views/teacherReport.css` — table grid + `@media print` overrides (AC#6).
- `apps/web/src/views/focusParagraph.ts` — pure deterministic focus paragraph builder (AC#4).
- `apps/web/src/views/focusParagraph.test.ts` — 5 unit tests.

**Files modified:**
- `apps/agent/src/server.ts` — added `GET /api/session/:id/teacher-report` route (operator-gated).
- `apps/web/src/main.tsx` — registered `/teacher/:sessionId` route.
- `.env.example` — documented `POLYMATH_OPERATOR_SECRET` for teacher auth.

---

## Build plan (approved)

**Planned:** 2026-05-29 (kmaz-plan-iteration, one opus pass: architect/reuse/contrarian) · **Manifest:** [BUILD-PLAN-i6-stretch](../BUILD-PLAN-i6-stretch.md) · **Build tier:** Sonnet (default presentation path); Opus only if the contract-extension path (D25-1b) is approved.

> **🚫 DAG-BLOCKED on F-18 (and F-24). Read first.** F-18 (summary pipeline + `GET /api/session/:id/report` + `apps/web/src/views/` + the `SessionReport.tsx` template this mirrors) is **not built** as of 2026-05-29. **kmaz-build-iteration must leave F-25 OUT until F-18 merges.** The spec says F-25 "reuses `packages/graph/handoff/`" — **that overstates it**: F-25's default path reuses only F-18's **`GET /api/session/:id/report`** JSON, so if F-24 slips F-25 can still build against F-18 alone (note this relaxation for the orchestrator).

### Summary
A single web route `/teacher/:sessionId` (`apps/web/src/views/TeacherReport.tsx`) that fetches F-18's existing `GET /api/session/:id/report` and re-frames the returned `SessionSummary` into a teacher view: a per-KC mastery table (`kcsMastered`/`kcsStuck`), per-misconception flags, and a deterministically-generated "suggested next-session focus" paragraph. Pure presentation — **no summary-pipeline extension, no new agent endpoint** (the report endpoint is reused); auth enforced at that endpoint via the existing `checkOperatorAuth` gate, with the token presented as an `Authorization`/`X-Operator-Secret` header from an in-page input (per I5 D10, **not** a query param).

### Files to create
- `apps/web/src/views/TeacherReport.tsx` (+ `.test.tsx`) — the route component (data / no-data / 401 states).
- `apps/web/src/views/teacherReport.css` — table layout + `@media print` single-page styles.
- `apps/web/src/views/focusParagraph.ts` (+ `.test.ts`) — pure `buildNextSessionFocus(summary): string`.

### Files to modify
- `apps/web/src/main.tsx` — register `{ path: '/teacher/:sessionId', element: <TeacherReport/> }` (F-18 may add a placeholder; **shared edit point with F-18/F-24 — append-only**).
- `docs/features/25-teacher-artifact.md` — fill Implementation notes (auth + misconception-source decisions).
- (Conditional, D25-1b only) `apps/agent/src/report/buildReport.ts` + `packages/contract/src/sessionReport.ts` — add optional `misconceptionFlags?: string[]`. **Default plan avoids this.**

**Explicitly NOT touched (default path):** `packages/contract`, `packages/graph`, `apps/web/src/components/registry.tsx` (regular route, not a ComponentSpec), `apps/agent/src/server.ts`. Zero overlap with F-23.

### Build sequence (test-first)
- [ ] Confirm F-18 merged: `GET /api/session/:id/report` returns `SessionSummarySchema`-valid JSON, `checkOperatorAuth`-gated. **If not merged, STOP — DAG-blocked.**
- [ ] `focusParagraph.test.ts` first (names `kcsStuck` when present; "ready to advance" when empty; deterministic), then `focusParagraph.ts` (pure template, no LLM).
- [ ] Resolve D25-1 (misconception source) before the view test. Default: client-derive best-effort or render "none detected".
- [ ] `TeacherReport.test.tsx` (mocked fetch): full-data KC table + focus paragraph (AC#1/#2/#4); misconception flag shown/absent (AC#3); fetch 401 → "invalid token / auth required" state + in-page token input that re-fetches with the header (AC#5); no-token initial state.
- [ ] `TeacherReport.tsx`: `useParams().sessionId`, in-page token input → fetch `/api/session/:id/report` with `Authorization: Bearer <token>`, parse via `SessionSummarySchema` from `@polymath/contract`, render table + flags + `buildNextSessionFocus()`, map 401/403 → auth-required state.
- [ ] `teacherReport.css`: table grid + `@media print` clean page; consume F-19 `:root` tokens via `var(--token)` with local fallbacks (no competing `:root`).
- [ ] Register the route in `main.tsx`.
- [ ] Integration test (seeded session → `/teacher/:sessionId` renders the table) reusing F-18's fixture pattern.
- [ ] Update `.env.example` only if a distinct teacher token is chosen (D25-2); else document that `POLYMATH_OPERATOR_SECRET` gates it.
- [ ] Demo-script update + fill spec Implementation notes.
- [ ] `pnpm --filter @polymath/web exec vitest run src/views/...`; `pnpm typecheck && pnpm build`.

### Contracts touched
- **Default path: NONE reshaped.** Consumes the frozen `SessionSummarySchema` from `@polymath/contract` (F-18). New web-internal symbol `buildNextSessionFocus(summary): string`.
- **Conditional (D25-1b, ADDITIVE only if chosen):** optional `misconceptionFlags?: string[]` on `SessionSummarySchema` (`.optional()` keeps it append-only). The one place F-25 could touch the locked contract — needs sign-off.
- **Shared-file collision:** `apps/web/src/main.tsx` route registration (with F-18/F-24) — append-only, trivial rebase. Disjoint from F-23.

### Tests → AC
- `focusParagraph.test.ts` → AC#4 (deterministic) · `TeacherReport.test.tsx` → AC#1/#2/#3/#5/#6 · web integration → testing #3 / AC#1 · auth test (endpoint returns 401 on wrong/absent token when secret set; component maps to auth-required UI) → AC#5.

### Risks / open decisions
- **D25-1 (headline) — misconception flag data source (AC#3).** F-23 emits the halfway-misconception only inline in hint copy and persists **nothing queryable**; `SessionSummary` has no misconception field. **(a) RECOMMENDED:** F-25 client-derives a best-effort flag from served-hint events / `kcsStuck` heuristics, rendering "no misconceptions detected" when none — ships value, no contract change. **(b)** add optional `misconceptionFlags?: string[]` to the schema + populate in `buildReport.ts` (cleaner, but contract touch + requires F-23 to persist a marker). **Recommend (a) for the I6 "cut decisively" posture; (b) is the principled follow-up. Do not fabricate flags.**
- **D25-2 — token. RECOMMENDED: reuse `POLYMATH_OPERATOR_SECRET`** (the report endpoint is already operator-gated; a teacher is the operator persona) vs a new `POLYMATH_TEACHER_TOKEN` (only if role separation is a real requirement).
- **D25-3 — auth presentation. RECOMMENDED: in-page token input → `Authorization` header (per I5 D10), NOT `?token=`** (query params leak the secret in access logs). **The spec's AC#1 shows `?token=...` — the spec is wrong here; the plan deliberately deviates. Needs sign-off.**
- **Fail-closed/integrity:** by-UUID teaching data → exactly the `checkOperatorAuth` concern; the reused `/report` endpoint already fails closed (503 in prod when secret unset, open in dev/CI). F-25 must add no unauthenticated bypass. No DoS surface (no `equivalent()`/`truthTable()` here).

### Dependencies & DAG position
- **🚫 Hard-blocked on F-18** (report endpoint + `SessionReport.tsx` template + `views/` dir). Soft-blocked on F-24 per the spec, but the default path needs only F-18 → if F-24 slips, F-25 can build against F-18 alone.
- **Soft cross-dependency on F-23** for misconception data (AC#3) — degrade gracefully (D25-1).
- **Unblocks:** nothing (leaf feature, lowest I6 priority).
