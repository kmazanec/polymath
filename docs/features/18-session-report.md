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

## Build plan (approved)

**Iteration:** I5 (`i5-polish-observability-metrics`) · **Model tier:** Opus · **Runs:** concurrent with F-19, F-20 after the Step-0 barrier. **Not a dependency of any other I5 feature** (F-21 reads its locked output shape, but builds against the barrier-frozen schema, not F-18's merge).

**Tier rationale:** F-18 owns the most downstream-read contract in I5 — the summary-pipeline output shape (F-21 reads tiles; future F-24/F-25 wrap the pipeline). It must be locked correctly the first time, and the data derivation carries fail-closed/fail-open semantics (experiment-vs-in-session fallback, `events.app IS NULL` scoping, "not run" vs `0.0`). Contract-defining, multi-surface coordination → Opus.

**Build summary:** Reuse the seams that already exist. **`packages/graph` ALREADY EXISTS**, is `@polymath/graph` (an agent dep), and is already `COPY`ed in `apps/agent/Dockerfile` (deps + runtime) — so F-18 adds a `packages/graph/src/summary/` subdir mirroring the established `explainback/` subgraph pattern; **NOT a new workspace package, NOT a Dockerfile change** (the spec's "introduced here" + WORKSPACE_PKG_NOT_FOUND risk is verified false). The summary OUTPUT shape is locked as a Zod schema in `@polymath/contract` (precedent: `ExplainBackVerdict` lives there so the agent reads it without a graph dep). The pipeline reads experiment pre/post tables when the session carries a `subjectId` (reusing `experiment/csv.ts` `fractionCorrect`), and falls back to an in-session post-test from the bounded `deriveState` fold (scoped `events.app IS NULL`) + `learner_state` — no LLM call, fully deterministic. `GET /api/session/:id/report` is operator-gated via `checkOperatorAuth` exactly like `/replay`. The web route is a regular React Router route (registry untouched). **Demo reality:** most demo sessions have no `subjectId`, so the pre-test tile reads "pre-test not run" and `growthMultiplier` is `null` — the designed graceful state, not a failure; the "double growth" tile fully lights up only on an F-17 experiment-subject session.

**Checklist:**

- [ ] TEST-FIRST (contract): add `packages/contract/src/sessionReport.ts` + `sessionReport.test.ts` asserting `SessionSummarySchema` parses `{ preTestScore:number|null, postTestScore:number|null, growthMultiplier:number|null, timeOnTaskMs:number, transferSuccessRate:number, masteryStatus:'mastered'|'remediating'|'practicing'|'not_started', explainBackVerdict:{passed:boolean,reasons:string[]}, kcsMastered:string[], kcsStuck:string[], source:'experiment'|'in_session' }` and rejects extras (`.strict()`); export from `index.ts`. **This is the barrier-locked shape F-21/F-24/F-25 consume.**
- [ ] TEST-FIRST (growth): `packages/graph/src/summary/growth.test.ts` pinning `computeGrowthMultiplier(pre,post)` — `(post-pre)/max(pre, BASELINE_NORMALISATION)`; `pre===null ⇒ null`; `pre===0` normalises against the constant (no divide-by-zero); exact values for synthetic pairs (AC#5).
- [ ] Implement `packages/graph/src/summary/growth.ts` with the deterministic formula + exported `BASELINE_NORMALISATION` constant (**D1 = 0.25**).
- [ ] TEST-FIRST (pipeline): `packages/graph/src/summary/subgraph.test.ts` driving `buildSessionSummary` against synthetic inputs — (a) experiment path ⇒ `source:'experiment'`, scores from `fractionCorrect`; (b) no `subjectId` ⇒ `source:'in_session'`, `preTestScore:null`, `postTestScore` from the events fold, `growthMultiplier:null`; (c) mastered vs practicing; (d) latched `explainBackVerdict` passes through; assert output validates against `SessionSummarySchema`.
- [ ] Implement `packages/graph/src/summary/subgraph.ts` as a LangGraph `StateGraph` mirroring `explainback/subgraph.ts` (compile-once, channels, fail-closed). **Keep it PURE — no Drizzle import** (like `explainback` never imports DB); the agent does the I/O and passes data in. Export `buildSessionSummary` + re-export `SessionSummary` from `packages/graph/src/index.ts`.
- [ ] Wire DB reads in the agent: `apps/agent/src/report/buildReport.ts` loads the session row + `subjectId`, the `pre/postTestResults` (reuse `experiment/csv.ts` `fractionCorrect`), the events fold via `deriveState` (**scoped `events.app IS NULL`**, `limit MAX_SESSION_EVENTS`) for the in-session fallback, `learner_state` rows for `masteryStatus`/`kcsMastered`/`kcsStuck`, and `timeOnTask` from `sessions.startedAt..endedAt` (or last event ts). Compose → `buildSessionSummary`. Unknown session id ⇒ `null` ⇒ 404.
- [ ] TEST-FIRST (endpoint): agent test — `GET /api/session/:id/report` returns 200 + a `SessionSummarySchema`-valid body for a seeded session; 404 for unknown id; operator-gated (401 when `POLYMATH_OPERATOR_SECRET` set + no header; open in dev/CI when unset) — mirror the `/replay` auth test.
- [ ] Add the route to `apps/agent/src/server.ts`: a `/^\/api\/session\/([^/]+)\/report$/` GET if-block beside the `replayMatch` block (~L1773), calling `checkOperatorAuth(req, deps.operatorSecret)` first (fail-closed identical to `/replay`), then `buildReport`, then `sendJson`.
- [ ] TEST-FIRST (view): `apps/web/src/views/SessionReport.test.tsx` (vitest+jsdom) rendering each tile state — full experiment data, in-session fallback ("pre-test not run" tile), and the fetch-error/401 state — via a mocked fetch; assert the growth-multiplier tile + "pre-test not run" copy.
- [ ] Create `apps/web/src/views/SessionReport.tsx`: a route component reading `useParams().id`, fetching `/api/session/:id/report` (relative, Caddy-proxied like `App.tsx` L217), rendering KPI tiles (pre, post, **growth multiplier prominent**, time-on-task, transfer success rate, mastery status, explain-back verdict, kcsMastered/kcsStuck). Pre-test absent ⇒ "pre-test not run" tile, never an empty field (AC#4). Handle 401/403 as an explicit auth-required state (operator secret supplied via an **in-page input → `Authorization`/`X-Operator-Secret` header**, never a query param — **D10**).
- [ ] `apps/web/src/views/sessionReport.css`: tile-grid layout + "double growth" emphasis on the growth tile + `@media print` for a clean single-page PDF (AC#3). **View-scoped (BEM-ish prefix); consume F-19's `:root` tokens via `var(--token)` with local fallbacks if F-19's tokens aren't merged yet; NO competing `:root` block** (barrier B4 reconciliation rule).
- [ ] Register the route in `apps/web/src/main.tsx` — **the barrier already adds `{ path:'/session/:id/report', element:<SessionReport/> }` as a placeholder; F-18 only fills the component.** NOT a ComponentSpec; `registry.tsx` untouched.
- [ ] Add the print-stylesheet Playwright visual-regression spec as a DEFERRED/skipped scaffold (Playwright visual-regression is deferred in this codebase) so it documents intent without blocking CI.
- [ ] Verify (below) + update this spec's Implementation notes with the locked `SessionSummarySchema` for F-21/F-24/F-25.

**Decisions (recommended defaults — see manifest):** D1 `BASELINE_NORMALISATION = 0.25` · D2 `masteryStatus` enum = `mastered|remediating|practicing|not_started` (default `not_started`, fail-soft not a pass) · D10 in-page operator-secret input → header · D11 plain KPI labels now, human aligns to varsitytutors.com/schools copy post-build.

**Verification:** `pnpm --filter @polymath/contract exec vitest run src/sessionReport.test.ts` · `pnpm --filter @polymath/graph exec vitest run src/summary/growth.test.ts src/summary/subgraph.test.ts` · `pnpm --filter @polymath/agent exec vitest run src/report/buildReport.test.ts` · `pnpm --filter @polymath/web exec vitest run src/views/SessionReport.test.tsx` · `pnpm typecheck` · `docker build -f apps/agent/Dockerfile -t polymath-agent-f18 . && docker run --rm polymath-agent-f18 ls packages/graph/src/summary` (confirm the existing COPY picks up the new subdir) · `pnpm build`.

## Implementation notes (filled in by the building agent)

> Empty.
