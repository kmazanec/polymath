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

> Empty.
