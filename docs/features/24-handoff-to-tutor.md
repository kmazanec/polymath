# Feature: Handoff-to-human-tutor artifact

**ID:** F-24 · **Iteration:** I6 — Stretch · **Status:** Not started

## What this delivers (before → after)

**Before:** A session ends with the `MasteryCelebration` or just runs out. There is no artifact framing the experience as preparation for a Nerdy human tutor session. The "AI amplifies tutors" alignment with Nerdy's business model has no UI presence — *the single feature most distinguishing the submission from a generic candidate* per [ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md).

**After:** At session end (or when the learner explicitly clicks "I'm ready to hand off to a tutor"), the system generates a polished one-page artifact — a downloadable PDF (or shareable URL) — auto-populated from session-log + mastery-state. Content: what the learner mastered, where they got stuck, the specific items they struggled with, and *concrete questions to bring to a Nerdy human tutor*. Framed warmly: "I've taken you as far as I usefully can on this. Here's what to ask in your next live tutoring session." Reuses the summary pipeline from F-18.

## How it fits the roadmap

I6, **third stretch priority** per [ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md). Concurrent with F-22 (L3).

## Dependencies (must exist before this starts)

- **F-18** — summary pipeline.

## Unblocks (what waits on this)

- **F-25** — teacher artifact reuses the pipeline.

## Contracts touched

- **`apps/web/src/views/TutorHandoff.tsx`** — new route.
- **`packages/graph/handoff/`** — extends F-18's summary pipeline with a "questions to ask" generation node.
- **`ComponentSpec`** — adds a `HandoffArtifact` variant (or just a `/handoff/:sessionId` route, no ComponentSpec; decision: regular route, no schema change).
- **PDF generation** — server-side using a small library (e.g., Puppeteer headless render of the React page to PDF).

## Sub-tasks

1. **T-24a — `TutorHandoff.tsx` view** `[parallel]`
   - Layout: header ("ready to hand off"), summary tiles (what was mastered, what was stuck), 3–5 concrete questions, footer with Nerdy framing.
2. **T-24b — Summary pipeline extension** `[parallel after T-24a]`
   - Adds a "questions-to-ask" generation node consuming `kcsStuck` from F-18's pipeline.
3. **T-24c — Server-side PDF generation** `[parallel]`
   - `GET /api/session/:id/handoff.pdf` returns a Puppeteer-rendered PDF of the TutorHandoff page.
4. **T-24d — Shareable URL** `[parallel after T-24a]`
   - `/handoff/:sessionId/:token` for sharing; token validates against the session.
5. **T-24e — "I'm ready to hand off" affordance** `[parallel after T-24a]`
   - A button in the in-session UI (visible from any phase, prominent at session-end).
6. **T-24f — Demo script update** `[parallel]`
   - Documents the on-portfolio flex per [ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md).

## Acceptance criteria (product behavior)

1. **Clicking "I'm ready to hand off" at any time** generates the artifact for the current session.
2. **The artifact lists** (in this order): a 1-line warm intro, what was mastered (from `learner_state.bkt`), where the learner got stuck (KCs below mastery threshold), 3–5 questions for the human tutor (generated from `kcsStuck`).
3. **`GET /api/session/:id/handoff.pdf`** returns a downloadable PDF rendering of the page.
4. **The shareable URL `/handoff/:sessionId/:token`** is valid and renders the artifact in any browser.
5. **The framing language is warm + Nerdy-aligned**: "I've taken you as far as I usefully can on this" — not "I failed to teach you."
6. **The demo arc lands on this artifact as the final beat** — confirmed in the demo script.

## Testing requirements

- Component test for TutorHandoff.tsx rendering states.
- Integration test: full session → click handoff → PDF download.
- Unit test for the questions-to-ask generation node.

## Manual setup required

- **Decide artifact form (PDF, URL, in-product card).** [ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md) leaves this open. **Recommendation: ship all three** (PDF + URL + in-product card view) — the same TutorHandoff page renders to all three; the cost is just adding the PDF endpoint.

## Convergence and expected rework

⚠ **Concurrent with F-22.** Zero file overlap.

⚠ **Pipeline reused by F-25 (teacher artifact).** F-25 wraps the same pipeline output in a teacher-framing presentation layer.

## Implementation notes (filled in by the building agent)

> Empty.
