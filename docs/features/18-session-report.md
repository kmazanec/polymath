# Feature: SessionReport dashboard (Nerdy KPI shape)

**ID:** F-18 · **Iteration:** I5 — MVP+ polish · **Status:** Not started

## What this delivers (before → after)

**Before:** There is no per-session report. After a learner completes a session, the evaluator can read the events table via the replay endpoint but has no rendered summary. Nerdy's KPI shape ("double growth in core subjects") has no UI presence.

**After:** Visiting `/session/:id/report` renders a small dashboard view with: **pre-test score**, **post-test score**, **growth multiplier** (post / pre, in the shape of Nerdy's "double growth" claim), **time-on-task**, **transfer-task success rate**, **mastery status**, and the **explain-back rubric verdict**. The page is print-ready (PDF-friendly). One link from the demo deck reveals the report; the message is "our mastery signal produces telemetry of the exact shape Nerdy already publishes."

## How it fits the roadmap

I5, **off the critical path** but the highest-credibility MVP+ extra per [ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md). Concurrent with F-19, F-20.

## Dependencies (must exist before this starts)

- **F-12** — mastery state available.
- **F-15** — multi-lesson data available.
- **F-17** — pre/post test scores available (F-18 reads from F-17's tables if available; falls back to in-session post-test if not).

## Unblocks (what waits on this)

- **F-21** — counter-metrics dashboard composes some of F-18's tiles.
- **F-24** — handoff-to-tutor artifact reuses the report's summary pipeline.

## Contracts touched

- **REST API** — adds `GET /api/session/:id/report` returning the JSON payload F-18 renders.
- **`ComponentSpec`** — adds `SessionReport` variant (or hosts it as a regular React route, not via the registry; decision: it's not learner-facing during a session, so it's a regular route at `/session/:id/report`, not a ComponentSpec).
- **`apps/web/src/views/SessionReport.tsx`** — the report view.
- **Summary pipeline** — `packages/graph/summary/` introduced here. A small LangGraph subgraph that takes a session ID and produces the structured summary. **Reused by F-24 and F-25.**

## Sub-tasks

1. **T-18a — Summary pipeline (LangGraph subgraph)** `[parallel]`
   - Input: session ID. Output: structured summary (`{ preTestScore, postTestScore, growthMultiplier, timeOnTask, transferSuccessRate, masteryStatus, explainBackVerdict, kcsMastered, kcsStuck }`).
2. **T-18b — `GET /api/session/:id/report` endpoint** `[parallel after T-18a]`
3. **T-18c — `SessionReport.tsx` view** `[parallel after T-18b]`
   - Tile layout matching Nerdy's KPI shape.
   - Print stylesheet.
4. **T-18d — "Growth multiplier" computation** `[parallel after T-18a]`
   - Defined as `(postTestScore - preTestScore) / max(preTestScore, baseline_normalisation)`.
   - Normalised against a baseline so the multiplier is comparable across subjects.
5. **T-18e — Tests** `[parallel]`

## Acceptance criteria (product behavior)

1. **Visiting `/session/:id/report` for a completed session** renders the dashboard within 1s.
2. **The dashboard tiles match Nerdy's published "double growth" KPI shape** — pre/post + growth multiplier prominently displayed.
3. **The print stylesheet** produces a clean single-page PDF when the browser prints the page.
4. **Sessions that lack pre-test data** (because the experiment scaffolding wasn't run) gracefully show "pre-test not run" instead of empty fields.
5. **The growth multiplier is computed deterministically** from the captured scores — verifiable in unit tests.
6. **The summary pipeline is reusable** — F-24's handoff artifact and F-25's teacher artifact will call the same pipeline.

## Testing requirements

- Unit tests for the summary pipeline given synthetic session data.
- Component test for `SessionReport.tsx` rendering each tile state (with data, without data, error state).
- Visual regression (Playwright) for the print stylesheet.

## Manual setup required

- Confirm Nerdy's KPI shape from `varsitytutors.com/schools` — ~1 hour to take screenshots and align the dashboard's labels and tile order.

## Convergence and expected rework

⚠ **Summary pipeline reuse by F-24 / F-25** — lock the summary output shape in F-18 so F-24 can wrap it for tutor framing and F-25 for teacher framing. Strategy: define the output Zod schema early; F-24/F-25 only add presentation layers, not pipeline changes.

⚠ **F-21 reads from F-18's data + endpoint** — coordinate on the JSON shape.

## Implementation notes (filled in by the building agent)

> Empty.
