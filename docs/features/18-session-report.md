# Feature: SessionReport dashboard (Nerdy KPI shape)

**ID:** F-18 · **Iteration:** I5 — MVP+ polish · **Status:** Built (test-first; full suite green; QA against the running stack)

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

## Build plan (approved)

**Iteration:** I5 (`i5-polish-observability-metrics`) · **Model tier:** Opus · **Runs:** concurrent with F-19, F-20 after the Step-0 barrier. **Not a dependency of any other I5 feature** (F-21 reads its locked output shape, but builds against the barrier-frozen schema, not F-18's merge).

**Tier rationale:** F-18 owns the most downstream-read contract in I5 — the summary-pipeline output shape (F-21 reads tiles; future F-24/F-25 wrap the pipeline). It must be locked correctly the first time, and the data derivation carries fail-closed/fail-open semantics (experiment-vs-in-session fallback, `events.app IS NULL` scoping, "not run" vs `0.0`). Contract-defining, multi-surface coordination → Opus.

**Build summary:** Reuse the seams that already exist. **`packages/graph` ALREADY EXISTS**, is `@polymath/graph` (an agent dep), and is already `COPY`ed in `apps/agent/Dockerfile` (deps + runtime) — so F-18 adds a `packages/graph/src/summary/` subdir mirroring the established `explainback/` subgraph pattern; **NOT a new workspace package, NOT a Dockerfile change** (the spec's "introduced here" + WORKSPACE_PKG_NOT_FOUND risk is verified false). The summary OUTPUT shape is locked as a Zod schema in `@polymath/contract` (precedent: `ExplainBackVerdict` lives there so the agent reads it without a graph dep). The pipeline reads experiment pre/post tables when the session carries a `subjectId` (reusing `experiment/csv.ts` `fractionCorrect`), and falls back to an in-session post-test from the bounded `deriveState` fold (scoped `events.app IS NULL`) + `learner_state` — no LLM call, fully deterministic. `GET /api/session/:id/report` is operator-gated via `checkOperatorAuth` exactly like `/replay`. The web route is a regular React Router route (registry untouched). **Demo reality:** most demo sessions have no `subjectId`, so the pre-test tile reads "pre-test not run" and `growthMultiplier` is `null` — the designed graceful state, not a failure; the "double growth" tile fully lights up only on an F-17 experiment-subject session.

**Checklist:**

- [x] TEST-FIRST (contract): add `packages/contract/src/sessionReport.ts` + `sessionReport.test.ts` asserting `SessionSummarySchema` parses `{ preTestScore:number|null, postTestScore:number|null, growthMultiplier:number|null, timeOnTaskMs:number, transferSuccessRate:number, masteryStatus:'mastered'|'remediating'|'practicing'|'not_started', explainBackVerdict:{passed:boolean,reasons:string[]}, kcsMastered:string[], kcsStuck:string[], source:'experiment'|'in_session' }` and rejects extras (`.strict()`); export from `index.ts`. **This is the barrier-locked shape F-21/F-24/F-25 consume.**
- [x] TEST-FIRST (growth): `packages/graph/src/summary/growth.test.ts` pinning `computeGrowthMultiplier(pre,post)` — `(post-pre)/max(pre, BASELINE_NORMALISATION)`; `pre===null ⇒ null`; `pre===0` normalises against the constant (no divide-by-zero); exact values for synthetic pairs (AC#5).
- [x] Implement `packages/graph/src/summary/growth.ts` with the deterministic formula + exported `BASELINE_NORMALISATION` constant (**D1 = 0.25**).
- [x] TEST-FIRST (pipeline): `packages/graph/src/summary/subgraph.test.ts` driving `buildSessionSummary` against synthetic inputs — (a) experiment path ⇒ `source:'experiment'`, scores from `fractionCorrect`; (b) no `subjectId` ⇒ `source:'in_session'`, `preTestScore:null`, `postTestScore` from the events fold, `growthMultiplier:null`; (c) mastered vs practicing; (d) latched `explainBackVerdict` passes through; assert output validates against `SessionSummarySchema`.
- [x] Implement `packages/graph/src/summary/subgraph.ts` as a LangGraph `StateGraph` mirroring `explainback/subgraph.ts` (compile-once, channels, fail-closed). **Keep it PURE — no Drizzle import** (like `explainback` never imports DB); the agent does the I/O and passes data in. Export `buildSessionSummary` + re-export `SessionSummary` from `packages/graph/src/index.ts`.
- [x] Wire DB reads in the agent: `apps/agent/src/report/buildReport.ts` loads the session row + `subjectId`, the `pre/postTestResults` (reuse `experiment/csv.ts` `fractionCorrect`), the events fold via `deriveState` (**scoped `events.app IS NULL`**, `limit MAX_SESSION_EVENTS`) for the in-session fallback, `learner_state` rows for `masteryStatus`/`kcsMastered`/`kcsStuck`, and `timeOnTask` from `sessions.startedAt..endedAt` (or last event ts). Compose → `buildSessionSummary`. Unknown session id ⇒ `null` ⇒ 404.
- [x] TEST-FIRST (endpoint): agent test — `GET /api/session/:id/report` returns 200 + a `SessionSummarySchema`-valid body for a seeded session; 404 for unknown id; operator-gated (401 when `POLYMATH_OPERATOR_SECRET` set + no header; open in dev/CI when unset) — mirror the `/replay` auth test.
- [x] Add the route to `apps/agent/src/server.ts`: a `/^\/api\/session\/([^/]+)\/report$/` GET if-block beside the `replayMatch` block (~L1773), calling `checkOperatorAuth(req, deps.operatorSecret)` first (fail-closed identical to `/replay`), then `buildReport`, then `sendJson`.
- [x] TEST-FIRST (view): `apps/web/src/views/SessionReport.test.tsx` (vitest+jsdom) rendering each tile state — full experiment data, in-session fallback ("pre-test not run" tile), and the fetch-error/401 state — via a mocked fetch; assert the growth-multiplier tile + "pre-test not run" copy.
- [x] Create `apps/web/src/views/SessionReport.tsx`: a route component reading `useParams().id`, fetching `/api/session/:id/report` (relative, Caddy-proxied like `App.tsx` L217), rendering KPI tiles (pre, post, **growth multiplier prominent**, time-on-task, transfer success rate, mastery status, explain-back verdict, kcsMastered/kcsStuck). Pre-test absent ⇒ "pre-test not run" tile, never an empty field (AC#4). Handle 401/403 as an explicit auth-required state (operator secret supplied via an **in-page input → `Authorization`/`X-Operator-Secret` header**, never a query param — **D10**).
- [x] `apps/web/src/views/sessionReport.css`: tile-grid layout + "double growth" emphasis on the growth tile + `@media print` for a clean single-page PDF (AC#3). **View-scoped (BEM-ish prefix); consume F-19's `:root` tokens via `var(--token)` with local fallbacks if F-19's tokens aren't merged yet; NO competing `:root` block** (barrier B4 reconciliation rule).
- [x] Register the route in `apps/web/src/main.tsx` — **the barrier already adds `{ path:'/session/:id/report', element:<SessionReport/> }` as a placeholder; F-18 only fills the component.** NOT a ComponentSpec; `registry.tsx` untouched.
- [x] Add the print-stylesheet Playwright visual-regression spec as a DEFERRED/skipped scaffold (Playwright visual-regression is deferred in this codebase) so it documents intent without blocking CI.
- [x] Verify (below) + update this spec's Implementation notes with the locked `SessionSummarySchema` for F-21/F-24/F-25.

**Decisions (recommended defaults — see manifest):** D1 `BASELINE_NORMALISATION = 0.25` · D2 `masteryStatus` enum = `mastered|remediating|practicing|not_started` (default `not_started`, fail-soft not a pass) · D10 in-page operator-secret input → header · D11 plain KPI labels now, human aligns to varsitytutors.com/schools copy post-build.

**Verification:** `pnpm --filter @polymath/contract exec vitest run src/sessionReport.test.ts` · `pnpm --filter @polymath/graph exec vitest run src/summary/growth.test.ts src/summary/subgraph.test.ts` · `pnpm --filter @polymath/agent exec vitest run src/report/buildReport.test.ts` · `pnpm --filter @polymath/web exec vitest run src/views/SessionReport.test.tsx` · `pnpm typecheck` · `docker build -f apps/agent/Dockerfile -t polymath-agent-f18 . && docker run --rm polymath-agent-f18 ls packages/graph/src/summary` (confirm the existing COPY picks up the new subdir) · `pnpm build`.

## Implementation notes (filled in by the building agent)

### Locked output shape (for F-21 / F-24 / F-25)

The summary output is the barrier-frozen `SessionSummarySchema` in
`@polymath/contract` (`packages/contract/src/sessionReport.ts`, exported from the
package index, `.strict()` + append-only). F-21/F-24/F-25 consume this exact shape —
do NOT re-derive it:

```ts
SessionSummary = {
  preTestScore: number | null;       // null = pre-test NOT run (≠ a measured 0)
  postTestScore: number | null;
  growthMultiplier: number | null;   // null whenever pre is null (no baseline)
  timeOnTaskMs: number;              // guaranteed finite, ≥ 0
  transferSuccessRate: number;       // [0,1]; 0 when no probes (never NaN)
  masteryStatus: 'mastered' | 'remediating' | 'practicing' | 'not_started';
  explainBackVerdict: { passed: boolean; reasons: string[] };
  kcsMastered: string[];
  kcsStuck: string[];
  source: 'experiment' | 'in_session';
};
```

`computeGrowthMultiplier(pre, post)` (`@polymath/graph`, `summary/growth.ts`):
`(effectivePost − pre) / max(pre, BASELINE_NORMALISATION)`, `BASELINE_NORMALISATION =
0.25` (D1). `pre === null` ⇒ `null`; a null post is treated as no progress (post = pre
⇒ multiplier 0); residual NaN/Infinity ⇒ `null`. A future tile is an ADDITIVE optional
field, never a re-shape (contract change protocol).

### Architecture

- **Pure pipeline / DB-I/O split (mirrors `explainback/`).**
  `packages/graph/src/summary/subgraph.ts` is a compile-once LangGraph `StateGraph`
  with NO Drizzle import — it takes a `SummaryInput` of already-assembled numbers and
  owns only the composition (provenance → `source`, growth, transfer rate, the
  `SessionSummarySchema.parse` boundary). This is why F-24/F-25 can reuse it without
  agent deps. `packages/graph/src/summary/` is a SUBDIR of the existing
  `@polymath/graph` package (already COPYed in `apps/agent/Dockerfile`) — **not** a new
  workspace package, so no Dockerfile / WORKSPACE_PKG_NOT_FOUND change (verified with a
  real `docker build` + `ls packages/graph/src/summary` in the image).
- **Agent I/O (`apps/agent/src/report/buildReport.ts`).** Loads the session row +
  `subjectId`, the experiment `pre/post_test_results` (`fractionCorrect`; the post is
  the `condition='polymath'` arm) when a subject is linked, the bounded
  `events.app IS NULL` fold for the in-session post proxy (mean BKT P(mastered)) +
  transfer tally + latched explain-back verdict, and `learner_state` for the KC lists.
  Unknown id ⇒ `null` ⇒ 404. **Every events read is scoped `events.app IS NULL`** (D3).

### Decisions

- **D1** `BASELINE_NORMALISATION = 0.25` (denominator floor; no divide-by-zero).
- **D2** `masteryStatus` default `not_started`; a fail-soft default is never a pass.
  **Production mastery signal nuance:** `learner_state.mastery_state` is only ever
  written `rule_gate_passed` / `practicing` by the server's single writer — it NEVER
  writes `'mastered'`. The authoritative mastered signal is the persisted
  `mount MasteryCelebration` action in the (app-scoped) event log, so `buildReport`
  promotes `masteryStatus → 'mastered'` from that. Without this read a genuinely-
  mastered session would mis-report `practicing` (fails SOFT, not a forged pass — but
  it's the legitimate-path-must-produce-the-input rule: a state nobody can reach is a
  bug). A seeded `learner_state.mastery_state = 'mastered'` is still honored too.
- **D10** Operator secret entered via an **in-page input → `X-Operator-Secret` HEADER**
  on retry, NEVER a query param (a secret in a URL leaks into logs/history). A 401/403
  surfaces the input; the form's submit re-fetches with the header.
- **D11** Plain KPI labels for now; the human aligns wording/tile order to
  varsitytutors.com/schools post-build (the spec's manual-setup hour).

### QA evidence (real running stack, docker compose)

Operator gate live (`NODE_ENV=production`, `POLYMATH_OPERATOR_SECRET=demo-secret-123`):
- Endpoint matrix against the running agent (`buildReport` integration test seeds the
  experiment-arm path): `200` + a `SessionSummarySchema`-valid body with secret; `401`
  on absent/wrong secret (Bearer + `X-Operator-Secret`, constant-time); `404` on an
  unknown id (`{"error":"unknown session"}`); `503` when the secret is UNSET in
  production (fail-closed) — observed earlier on the default compose agent.
- Real-browser QA (Playwright, full compose stack on Caddy): the view first renders the
  **auth-required** state on the initial `401`; after entering the secret it retries
  with the header and renders the populated dashboard. A fresh in-session session shows
  the graceful tiles — Pre-test "**pre-test not run**", Growth "**not measured**",
  Time-on-task `0m 37s`, Mastery "Not started" — i.e. `source:"in_session"`,
  `preTestScore:null`, `growthMultiplier:null` (AC#4 confirmed in the DOM; never an
  empty/0 field). The only console error is the expected initial 401 the view handles.
- The experiment-arm `source:"experiment"` body with a real `growthMultiplier`
  (`(0.75−0.25)/max(0.25,0.25) = 2.0`) is verified by the `buildReport` integration
  test against a seeded subject; the in-page render of that arm awaits a demo subject.

### Deferred

- Print-stylesheet **Playwright visual-regression** is a `test.fixme` scaffold
  (`apps/web/e2e/sessionReport.print.spec.ts`) — visual-regression baselines are not
  wired in this codebase (no committed baseline, e2e not in CI), and the exact baseline
  awaits the final polish tokens + Nerdy-aligned copy. The print CSS structure is
  exercised by the jsdom component test; the `@media print` rules (single-page grid,
  hidden auth form) are in `views/sessionReport.css`.
