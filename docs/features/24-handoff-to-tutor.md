# Feature: Handoff-to-human-tutor artifact

**ID:** F-24 · **Iteration:** I6 — Stretch · **Status:** Built (one deferred post-F-18-merge reconciliation; see build sequence)

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

**DAG note — F-18 not present in `build/i6-stretch`.** As planned, the summary
pipeline (`packages/graph/src/summary/`, `SessionSummarySchema`, `getSessionSummary`,
`apps/web/src/views/`) is not on this branch. The frozen `HandoffArtifactSchema.summary`
field is a `z.unknown()` placeholder for exactly this reason. F-24 was built against
that placeholder: `buildHandoffArtifact` derives `masteredKcs`/`stuckKcs` directly from
the `learner_state` table (the same per-(session,kc) BKT source the summary pipeline
reads) and emits a forward-compatible `summary` object carrying `{ kcsMastered, kcsStuck,
masteryStatus }`. **When F-18 merges**, swap the `summary` placeholder in
`packages/contract/src/handoff.ts` for `import { SessionSummarySchema } from
'./sessionSummary.js'` (import, never redefine) and replace `buildHandoffArtifact`'s
inline summary projection with a `getSessionSummary` call — both are confined to the one
adapter file, as the plan requires.

**Questions node (`packages/graph/src/handoff/questions.ts`).** Takes a minimal
`{ stuckKcs, masteredKcs }` input rather than the unbuilt `SessionSummary` (decouples it
from the DAG-blocked schema; the caller projects the two lists). Deterministic templates
are always-on (the shipped product; the offline MR pipeline tests them fully); an LLM
rephrase is a key-gated, fail-soft DI seam (mirrors `explainback/judge.ts`). The node
NEVER throws and ALWAYS returns a contract-valid 3–5 set: a rephrase that fails to
validate (wrong count / blank) is discarded and the templates stand. A fully-mastered
session gets warm enrichment questions, never "I failed" (AC#5).

---

## Build plan (approved)

**Planned:** 2026-05-29 (kmaz-plan-iteration, 3-draft panel + synthesis) · **Manifest:** [BUILD-PLAN-i6-stretch](../BUILD-PLAN-i6-stretch.md) · **Build tier:** Opus for contract/route/questions-node/auth; Sonnet for the view + wiring.

> **🚫 DAG-BLOCKED on F-18 (read first).** As of 2026-05-29, F-18 (the summary pipeline) is **planned-but-not-built** — there is no `packages/graph/src/summary/`, no `SessionSummarySchema`, no `getSessionSummary`, no `apps/web/src/views/`. **kmaz-build-iteration must leave F-24 OUT until F-18/I5 merges.** This plan is written against F-18's assumed-frozen `SessionSummary` shape `{ preTestScore, postTestScore, growthMultiplier, timeOnTask, transferSuccessRate, masteryStatus, explainBackVerdict, kcsMastered, kcsStuck }`; **if F-18's frozen schema differs, reconcile** — all F-18 coupling is confined to one adapter file (`apps/agent/src/handoff/buildArtifact.ts`).

### Summary
A learner-facing, shareable tutor-handoff artifact: a new `packages/graph/src/handoff/questions.ts` node (env-gated, fail-closed; turns `SessionSummary.kcsStuck` into 3–5 tutor questions, deterministic template primary + optional LLM rephrase), a read-only agent route `GET /api/session/:id/handoff[/:token]` returning a composed `HandoffArtifact` JSON, and a regular React route `apps/web/src/views/TutorHandoff.tsx` (`/handoff/:sessionId` + tokened `/handoff/:sessionId/:token`). **PDF via `@media print` + `window.print()` (NOT Puppeteer).** A persistent "I'm ready to hand off" button is pure client navigation. No `ComponentSpec` variant, no WS change — additive contract + one nullable DB column.

### Files to create
- `packages/contract/src/handoff.ts` — `TutorQuestionSchema`, `HandoffArtifactSchema` (embeds F-18's `SessionSummarySchema`).
- `packages/graph/src/handoff/questions.ts` (+ `.test.ts`) — `generateTutorQuestions(summary): Promise<TutorQuestion[]>`; templates always-on, LLM rephrase behind `OPENAI_API_KEY`, fail-soft (copy `explainback/judge.ts` env-gate + try/catch).
- `apps/agent/src/handoff/buildArtifact.ts` (+ `.test.ts`) — `buildHandoffArtifact(deps, sessionId): Promise<HandoffArtifact|null>`; **sole F-18 coupling point**; `null` on unknown/empty session.
- `apps/agent/src/handoff/shareToken.ts` — `mintShareToken()` (`randomBytes(24).toString('hex')`), `validateShareToken(stored, given)` (constant-time).
- `apps/agent/src/handoff/route.ts` (+ `route.integration.test.ts`) — `tryHandleHandoffRoute`; mints/persists token lazily; validates on the tokened path; scopes session read to `events.app IS NULL`.
- `apps/web/src/views/TutorHandoff.tsx` (+ `.test.tsx`, + `tutorHandoff.css` with a `@media print` block).
- `apps/web/src/components/HandoffButton.tsx` (+ `.test.tsx`).
- Demo-script update (confirm whether a demo doc already exists before creating one).

### Files to modify
- `packages/contract/src/index.ts` — `export * from './handoff.js';` (**append-only; F-25 also appends**).
- `packages/graph/src/index.ts` — `export * from './handoff/questions.js';` (**F-18 adds `summary/`**).
- `apps/agent/src/db/schema.ts` — nullable `shareToken: text('share_token').unique()` on `sessions` (mirrors the `followup_token` precedent). **+ a generated migration — sequence the number vs F-25.**
- `apps/agent/src/server.ts` — register `tryHandleHandoffRoute` near the replay route; **NO `checkOperatorAuth`** (per-request-random-token exempt pattern). Add LLM client to `ServerDeps` if needed.
- `apps/web/src/main.tsx` — append `/handoff/:sessionId` + `/handoff/:sessionId/:token` routes to the router array (**conflict point with F-18/F-25 — trivial resolve**).
- `apps/web/src/App.tsx` — mount `<HandoffButton sessionId={…}/>` in the persistent chrome.

### Build sequence (test-first)
- [ ] **Reconcile against merged F-18** (blocking gate): re-read F-18's `SessionSummarySchema` + summary builder; adjust `buildArtifact.ts` + `HandoffArtifactSchema.summary` if shape differs. **Do not start until F-18 is merged.** — **DEFERRED (F-18 not on `build/i6-stretch`).** Built against the frozen `z.unknown()` placeholder; the single reconciliation point is `buildArtifact.ts` (see Implementation notes). Left unticked deliberately — it is a post-F-18-merge action, not skippable silently.
- [x] Add `packages/contract/src/handoff.ts` + re-export; `pnpm --filter @polymath/contract test`. (Frozen + committed on the base contract `73e655c`; consumed unchanged.)
- [x] `questions.test.ts` first (N stuck KCs → 3–5 questions deterministic offline; empty stuck → 3–5 enrichment questions, never "I failed"; LLM error → template fallback, never throws), then `questions.ts`.
- [x] `buildArtifact.test.ts` (mocked summary+questions: field order intro→mastered→stuck→questions→footer; warm framing present; `null` on empty), then `buildArtifact.ts`.
- [x] `share_token` column + `drizzle-kit generate`; `shareToken.ts` + mint→validate round-trip test. (Column + migration `0004_glorious_bloodstorm.sql` are frozen on the base contract; only `shareToken.ts` was built here.)
- [x] `route.integration.test.ts` (finished session → bare path returns artifact + mints share URL; tokened path valid→200, wrong token→403, unknown→404, `app='baseline'` scoped out), then `route.ts` + wire into `server.ts`. (9 cases green vs real Postgres + real HTTP server. Also: never-shared session's tokened path → 403; non-UUID → 400; empty session → 404; lazy mint is stable across calls.)
- [x] `TutorHandoff.test.tsx` (loading/loaded/error; AC#2 order; AC#5 warm copy literal; "Download PDF"→`window.print()`), then `TutorHandoff.tsx` + `tutorHandoff.css` `@media print`.
- [x] Add the two routes to `main.tsx`.
- [x] `HandoffButton.test.tsx` (visible across phases, click→`/handoff/:sessionId`, no wire event), then `HandoffButton.tsx`, mount in `App.tsx`.
- [x] Manual smoke: session → handoff → render → print-to-PDF → tokened share URL in a fresh browser context. (Drove the REAL agent on :8099 + Vite on :5199: bare path 200 + minted shareUrl, valid token 200, wrong token 403, unknown 404, non-UUID 400, baseline-arm 404; the view rendered in a real browser at both the bare and tokened URLs in AC#2 order.)
- [x] Demo-script final-beat update. (No demo doc existed; created `docs/DEMO-SCRIPT.md` with the handoff as the final beat — AC#6.)
- [x] `pnpm typecheck && pnpm test`. (No `docker build` needed for the print path — no Chromium, no new package; `packages/graph` already COPYed.)

### Contracts touched
- **ADDITIVE only — no reshaping, no `ComponentSpec`/`ClientEvent`/`ServerMessage`/`Action` kind.** New `packages/contract/src/handoff.ts`: `TutorQuestionSchema = z.object({ kc, question })`; `HandoffArtifactSchema = z.object({ sessionId, generatedAt, warmIntro, summary: SessionSummarySchema, masteredKcs, stuckKcs, tutorQuestions: z.array(TutorQuestionSchema).min(3).max(5), nerdyFooter })`.
- New graph export `generateTutorQuestions(summary): Promise<TutorQuestion[]>`.
- New HTTP routes `GET /api/session/:id/handoff` + `…/handoff/:token` (no `.pdf` endpoint).
- **DB additive nullable:** `sessions.share_token text UNIQUE`.
- **`SessionSummarySchema` is OWNED by F-18** — imported, never redefined.
- **Shared-file collisions** (`contract/index.ts`, `graph/index.ts`, `server.ts`, `schema.ts`+migration, `main.tsx`, `App.tsx`) — also touched by F-18/F-25; **merge order F-18 → F-24 → F-25**; sequence migration numbers.

### Tests → AC
- `questions.test.ts` → Testing #3, AC#2 · `buildArtifact.test.ts` → AC#2, AC#5 · `shareToken` unit → AC#4 security · `route.integration.test.ts` → Testing #2, AC#3/#4, integrity scoping · `TutorHandoff.test.tsx` → Testing #1, AC#2/#3/#5 · `HandoffButton.test.tsx` → AC#1 · manual smoke → AC#1/#4/#6 · demo doc → AC#6.

### Risks / open decisions
- **D24-1 — PDF mechanism. RECOMMENDED & chosen: `@media print` + `window.print()`. Rejected Puppeteer** (Alpine base + curated Dockerfile + ~300MB Chromium + health-check rollback + agent/web are *separate containers* → cross-container token-plumbed render). **Rejected a build-time PDF lib** (unnecessary; the page already renders).
- **D24-2 — literal `…/handoff.pdf` endpoint? RECOMMENDED: defer.** Met by browser print-to-PDF. If demanded, use `pdfkit` (pure-JS) rendering the summary *data*, never Puppeteer; run `docker build` to confirm the dep.
- **D24-3 — share token. RECOMMENDED & chosen: nullable `sessions.share_token` random column, minted lazily, constant-time validated. Rejected HMAC-stateless token** (needs a dev/CI-hostile secret). Exempt from `checkOperatorAuth` (per-request-random-token pattern; the artifact is the learner's own, intentionally shareable).
- **D24-4 — pipeline location. RECOMMENDED & chosen: `packages/graph/src/handoff/`** (existing already-COPYed package; honors the spec naming; keeps the F-18/F-24/F-25 boundary clean). **Rejected folding into `summary/`** and **rejected a new `@polymath/handoff` package**.
- **D24-5 — questions generation. RECOMMENDED & chosen: deterministic templates always-on (offline MR pipelines test it fully); LLM rephrase optional behind `OPENAI_API_KEY`, fail-soft to templates.**
- **Integrity/DoS:** read-only; reuses F-18's bounded, `app IS NULL`-scoped folds; no new `equivalent()`/`truthTable()` on learner input. Only new surface is the share token (constant-time, fail-closed). The session read **must** filter `events.app IS NULL`.

### Dependencies & DAG position
- **🚫 Blocked on F-18** (summary pipeline + `SessionSummarySchema` + `getSessionSummary` + `apps/web/src/views/`). Left out of the build until F-18/I5 lands.
- **Concurrent with F-22 (L3)** — zero file overlap.
- **Unblocks F-25** (teacher artifact reuses F-18's summary + optionally F-24's `generateTutorQuestions`/`buildHandoffArtifact`). **Merge order F-18 → F-24 → F-25.**
