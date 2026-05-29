# Feature: Counter-metrics dashboard (6 metrics)

**ID:** F-21 · **Iteration:** I5 — MVP+ polish · **Status:** Not started

## What this delivers (before → after)

**Before:** The 6 counter-metrics from [ADR-011](../adrs/ADR-011-evaluation-and-mastery-instrumentation.md) — UI churn rate, intelligibility, visual utility, dependency check, sensor κ, false-positive rate — are *defined* but have no dashboard. The brief's "include counter-metrics that protect against bad responsiveness and shallow learning" has no surface.

**After:** A dashboard view at `/metrics` (operator/evaluator only, not learner-facing) computes and displays each of the 6 metrics against thresholds. Sourced from PostHog (metrics 1 + 2), the events table (metrics 3 + 4), LangSmith + Postgres correlation (metric 5), and experiment results (metric 6). Each metric shows: current value, threshold, pass/fail flag. The display is *honest* — if a metric is below threshold, the dashboard says so and that becomes part of the limitations memo. The dashboard is print-ready for embedding in the demo deck.

## How it fits the roadmap

I5, **off the critical path** but the final MVP+ piece. Merge sink for I5.

## Dependencies (must exist before this starts)

- **F-17** — experiment data for metrics 6 (false-positive) and parts of 4, 5.
- **F-18** — SessionReport pattern reused for some tiles.
- **F-19** — accessibility properties needed for intelligibility sampling UX.
- **F-20** — observability wiring is the data source for metrics 1, 2.

## Unblocks (what waits on this)

None within MVP+. F-21 is the terminal feature of I5.

## Contracts touched

- **`/metrics` route** in `apps/web` — operator/evaluator only; auth via a small password or env var.
- **REST API** — adds `GET /api/metrics` returning the 6-metric JSON payload.
- **PostHog dashboard** — pre-configured dashboards for metrics 1 + 2.
- **LangSmith eval bucket** — for metric 5 (rubric vs. transfer Cohen's κ).
- **Intelligibility sampling UI** — `apps/web/src/components/IntelligibilityCheck.tsx` — a small post-mount prompt that fires at ~1 in 3 mounts.

## Sub-tasks

1. **T-21a — Metric 1 (UI churn rate) computation + tile** `[parallel]`
2. **T-21b — Metric 2 (intelligibility) — sampling UI + tile** `[parallel]`
   - Inline "Did the change make sense?" yes/no/skip prompt at 1-in-3 sample rate.
3. **T-21c — Metric 3 (visual utility) — split-test infrastructure** `[parallel]`
   - For a small set of items, randomly suppress the circuit view; compare time-to-correct.
4. **T-21d — Metric 4 (dependency check) computation** `[parallel]`
   - Median time-to-correct on transfer items vs. final practice items.
5. **T-21e — Metric 5 (rubric ↔ transfer Cohen's κ)** `[parallel after F-17 data]`
6. **T-21f — Metric 6 (false-positive rate)** `[parallel after F-17 data]`
   - From the 24h follow-up data captured by F-17.
7. **T-21g — Dashboard view + print stylesheet** `[parallel after T-21a..T-21f]`

## Acceptance criteria (product behavior)

1. **Visiting `/metrics`** renders 6 tiles, one per counter-metric, with current value + threshold + pass/fail flag.
2. **The dashboard reads from real data** — not stubs. Each tile's source is documented in a tooltip.
3. **Honest reporting**: if a metric fails its threshold, the tile shows red and the limitations memo references the failure.
4. **The print stylesheet** produces a clean dashboard for the demo deck.
5. **Metric 6 explicitly notes "designed-for, measured on N=5–8"** per [ADR-011](../adrs/ADR-011-evaluation-and-mastery-instrumentation.md).
6. **Auth on the route** prevents random visitors from seeing operator data.

## Testing requirements

- Unit tests for each metric's computation given synthetic event data.
- Visual regression for the dashboard.
- Auth test: unauthorized request returns 401.

## Manual setup required

- Threshold tuning per [ADR-011](../adrs/ADR-011-evaluation-and-mastery-instrumentation.md) defaults.
- Demo-deck embedding: capture screenshots after running the live experiment.

## Convergence and expected rework

⚠ **F-21 is the convergence point for I5.** It reads from F-17, F-18, F-19, F-20. If any of those features' data shapes drifted, F-21 absorbs the rebase. Mitigation: lock data shapes in each producer's PR; F-21's PR is opened last.

## Build plan (approved)

**Iteration:** I5 (`i5-polish-observability-metrics`) · **Model tier:** Opus · **Runs:** LAST — the **I5 merge sink** (opens its PR last, absorbs the rebase). Reads F-17 experiment tables, F-18's locked summary shape, F-19's a11y patterns, F-20's churn endpoint.

**Tier rationale:** The merge sink reading from four siblings, touches the locked `ClientEvent` contract (append-only `intelligibility_response`), adds an operator-gated route, an intrusive lesson-loop split-test (metric 3, not a pure read), and must define honest fail-closed `insufficient_data`/`unconfigured` semantics for tiny/absent N → Opus. (The six metric computations are pure and individually testable once the result contract + event shapes are frozen.)

**Build summary:** Six independently unit-testable **pure** metric computations + a thin honest-rendering web layer, deriving everything **agent-side from data Polymath already persists** (the `events` table under `events.app IS NULL`, plus F-17's experiment tables) — **NOT from PostHog/LangSmith** (zero wiring, no keys at demo time; **D-source**, all reviewers agree). The headline decision (**the four-state result contract**): every metric returns `state: 'pass'|'fail'|'insufficient_data'|'unconfigured'` with `value`/`pass` nullable, so **null data NEVER defaults to a green or red tile** (the fail-open trap). At demo time most tiles WILL be gray — that is the correct, defensible output and the acceptance bar, not a bug. The four-state enum beats three states because **metric 1 (UI churn) has no agent-side source today** (no mount event, no phase in `events`) ⇒ `unconfigured (source: F-20)` rather than a fabricated number. **Metric 4 (dependency check)** is the safest real metric, built first from `events.app IS NULL` + `responseTimeMs`. **Metrics 5/6** read F-17 tables and report explicit N. **Metric 2** needs the new append-only `intelligibility_response` WS event + `IntelligibilityCheck.tsx`. **Metric 3**'s circuit-suppression split-test is the only genuinely intrusive change — shipped **designed-for + DORMANT** (flag off by default, `state:'unconfigured'`) so it never perturbs the `spec.visibleReps` probe-integrity boundary; a half-wired suppression is worse than an honest gray tile. `GET /api/metrics` mirrors the `/replay` operator gate exactly; `/metrics` is a regular React Router route (registry untouched), unguarded SPA with protection on the data endpoint's 401 (operator secret via an in-page input → header, never a query param or bundled).

**Checklist:**

- [x] TEST-FIRST: `apps/agent/src/metrics/types.ts` — the discriminated `MetricResult { id, label, value:number|null, threshold, unit, pass:boolean|null, state:'pass'|'fail'|'insufficient_data'|'unconfigured', sampleN, source, note? }` + `MetricsPayload { metrics:MetricResult[], generatedAt }`. **The four-state enum (NOT a bare `pass:boolean`) is the anti-fail-open spine** — null/absent data ⇒ `insufficient_data`/`unconfigured`, never a default pass and never a default fail. Lock this first.
- [x] TEST-FIRST: `metric4.test.ts` → `metric4.ts` — **Dependency check** (safest real metric): median time-to-correct on transfer items vs final practice items. Pure over `events` (ordering via `ts`, `responseTimeMs` from payload; transfer via `payload.event.kind==='transfer_submitted'`, practice via `'submit'`+correct). **Every query scopes `events.app IS NULL`** (mixed-app fixture asserts baseline rows excluded). `pass` = transfer median within 25% of practice; `insufficient_data` if either side has <3 correct samples.
- [x] TEST-FIRST: `metric5.ts/.test.ts` (Cohen's κ: explain-back from `payload.explainBackVerdict` vs held-out transfer from `payload.transferVerdict`) and `metric6.ts/.test.ts` (false-positive: % declared-mastered who fail a 3rd-rep followup, from F-17 `followupResults`). Both: `sampleN` from real rows; N < **MIN_N (=5, D7)** ⇒ `insufficient_data`, `value:null`. Metric 6's note MUST read literally `'designed-for; measured on N=<actual>'` (AC#5). **Test κ on the degenerate all-agree/single-class 2×2 — guard the denominator ⇒ `insufficient_data`, never NaN or a false 1.0.**
- [x] TEST-FIRST: `metric2.ts/.test.ts` — Intelligibility = `yes/(yes+no)`, skips excluded, from `intelligibility_response` events (`app IS NULL`); <MIN_N ⇒ `insufficient_data`. **(BARRIER)** the `intelligibility_response` kind is appended to `wire.ts` in the Step-0 barrier commit: `{ kind:'intelligibility_response', sessionId, mountedKind:z.string(), answer:z.enum(['yes','no','skip']) }` (append-only; `index.test.ts` parses it + asserts existing kinds unchanged).
- [x] TEST-FIRST: `metric1.ts/.test.ts` — UI churn. **VERIFIED there is no mount event/phase in `events` today**, so metric1 defaults to `state:'unconfigured'` (`source:'F-20 churn endpoint'`) unless an explicit churn adapter is provided. `compute()` accepts an OPTIONAL churn adapter; none ⇒ unconfigured. **Do NOT add a competing client mount event in F-21** (duplicates F-20, risks two divergent churn definitions — **D-metric1**).
- [x] Wire the agent to PERSIST `intelligibility_response` into `events` with `app` NULL (the polymath turn-write convention ~server.ts L1154-1166) so the metric-2 fold reads it under `events.app IS NULL`. Verify the row carries `mountedKind` + `answer`.
- [x] `apps/agent/src/metrics/fetchMetricInputs.ts`: ONE function returning all rows the six computations need (it does the DB I/O so the compute fns stay pure/DB-free for tests). **Every events query includes `AND events.app IS NULL`** (mirror `countOffTopicAnswers` L193-210). Experiment reads hit `postTestResults`/`followupResults`/`experiment_subjects` and honor the FROZEN CSV semantics (missing `''` ≠ `0.0`; `csv.ts` L16-27). `apps/agent/src/metrics/index.ts` (`computeAllMetrics`) aggregates the six into `MetricsPayload`.
- [x] Wire `GET /api/metrics` into `createServer()` before the 404 (~L1815): `const denied = checkOperatorAuth(req, deps.operatorSecret); if (denied) { sendJson(res, denied.status, denied.body); return; }` — IDENTICAL to the `/replay` block — then `fetchMetricInputs` + `computeAllMetrics` + `sendJson`. Integration test: 401 with `POLYMATH_OPERATOR_SECRET` set + wrong/absent header, 200 with the correct header.
- [x] Web route: **the barrier already appends `{ path:'/metrics', element:<MetricsDashboard/> }` to `main.tsx`** (alongside F-18's report route); F-21 only fills the component. Regular route, `registry.tsx` untouched.
- [x] `apps/web/src/MetricsDashboard.tsx`: fetch `GET /api/metrics` with the operator secret supplied at request time from a small **in-page operator-secret input → `Authorization`/`X-Operator-Secret` header** (never a query param, never bundled — **D10**). Render 6 tiles with FOUR visual states: green (pass), red (fail — feeds the limitations memo), gray "insufficient data (N=k)", gray "not configured (source pending)". Value/threshold + source tooltip (AC#2). **Do NOT collapse `insufficient_data`/`unconfigured` into red or green.** Test covers all four states + fetch-error.
- [x] `apps/web/src/components/IntelligibilityCheck.tsx` (+ test): a post-mount "Did the change make sense?" yes/no/skip prompt firing ~1-in-3 mounts (deterministic under a seeded RNG — test the gate), emitting `intelligibility_response`. Use F-19's a11y patterns (aria-live, visually-hidden, focus) if present, else minimal self-contained. Mount from the App mount path (~L244-263), sampled 1-in-3.
- [x] Limitations memo: a failing OR insufficient/unconfigured tile surfaces a one-line honest note in the dashboard (AC#3), copy-able for the deck. Plain text + the tile component; no new infra.
- [x] `apps/web/src/metrics.css`: **self-contained, dependency-free**, with an `@media print` block scoped to the dashboard, imported by `MetricsDashboard.tsx` only. Don't assume F-18/F-19 tokens exist on main; **consume F-19's `var(--token)` with local fallbacks**; reuse F-18's tile/print classes only if present at integration.
- [x] Metric 3 split-test (intrusive — LAST, **designed-for + DORMANT, D6**): add an append-only optional split-arm marker (`circuitSuppressed`) to the existing per-turn `events` payload (~L1154-1166) so metric3 reads which arm a matched item ran in — **no new WS kind, no reshape of `ComponentSpec` required fields**. Suppression flag OFF by default behind explicit opt-in env, scoped to a small matched item set, **orthogonal to `spec.visibleReps`** (probe-integrity boundary). Flag off ⇒ metric3 `unconfigured`. Test: suppression decision deterministic under a seed, applies only to matched items. **(Reconcile the payload field name with F-20's optional fields at integration — append-only, no silent overwrite.)**
- [x] Verify (below) + the manual honest-output check.

**Decisions (recommended defaults — see manifest):** D-source agent-side derivation (PostHog/LangSmith are corroborating sources in the tile `source` only) · D-metric1 ship `unconfigured` pointing at F-20, optional adapter · D6 metric-3 designed-for + dormant · D7 `MIN_N=5` · D10 in-page operator-secret input → header.

**Verification:** `pnpm typecheck` · `pnpm --filter @polymath/agent exec vitest run src/metrics` · `pnpm --filter @polymath/agent exec vitest run src/server.integration.test.ts` (`/api/metrics` 401/200) · `pnpm --filter @polymath/contract test` (`intelligibility_response` parses; existing kinds unchanged) · `pnpm --filter @polymath/web test` (four-state dashboard + seeded 1-in-3 sampling) · `pnpm test` · `pnpm build` · `docker build -f apps/agent/Dockerfile -t polymath-agent-f21 . && docker run --rm polymath-agent-f21 ls apps/agent/src/metrics` · MANUAL fresh-DB (N=0): `GET /api/metrics` with operator header confirms the honest gray-heavy state (5/6 `insufficient_data` N=0, 1 `unconfigured`, 3 `unconfigured` dormant), no fabricated green/red.

## Implementation notes (filled in by the building agent)

**Contracts consumed unchanged (no drift).** `MetricResult`/`MetricsPayload` (the
four-state contract), the `intelligibility_response` + `ui_mount` append-only wire
kinds, the `/api/metrics` operator-gated route + `buildMetricsPayload` stub, the
`/metrics` web route, and the global token stylesheet were all already frozen on the
build branch's barrier commit. This feature filled the producers/components behind
them; it did not touch a frozen signature.

**Architecture.** Six PURE, DB-free metric computations (`metric1..6.ts`) over the
`MetricInputs` projection (`inputs.ts`), aggregated by `computeAllMetrics.ts`. All DB
I/O is isolated in `fetchMetricInputs.ts` (the single seam) so the metrics are unit-
testable on tiny/degenerate N without Postgres. `index.ts#buildMetricsPayload` =
`fetchMetricInputs` → `computeAllMetrics`.

**The anti-fail-open spine.** Every metric returns `state ∈ {pass,fail,
insufficient_data,unconfigured}` with `value`/`pass` nullable. Null/absent data is
NEVER a default green or red. Confirmed live against real Postgres: a near-fresh DB
yields intelligibility=pass (real beacons), dependency_check=insufficient (transfer=0),
ui_churn + visual_utility=unconfigured, κ + false-positive=insufficient (N=0). The
gray-heavy state is the correct, defensible output.

**Per-metric notes.**
- *Metric 4 (dependency check)* — the safest real metric, built first: ratio of
  transfer median to practice median time-to-CORRECT; only correct + timed rows count;
  pass = ratio ≤ 1.25; insufficient if either side < 3 samples.
- *Metric 5 (κ)* — guards the degenerate single-class 2×2 (denominator `1-p_e`=0) →
  insufficient, never NaN/false-1.0; needs ≥ MIN_N (=5) complete verdict pairs.
- *Metric 6 (false-positive)* — denominator = declared-mastered subjects WITH a
  follow-up result; note reads literally `designed-for; measured on N=<actual>` (AC#5).
- *Metric 2 (intelligibility)* — yes/(yes+no), skips excluded; the legitimate path is
  proven end-to-end (a WS beacon persists under `events.app IS NULL` and folds in).
- *Metric 1 (UI churn)* — VERIFIED no agent-side mount/phase source today, so it ships
  `unconfigured` pointing at the observability churn endpoint with an OPTIONAL adapter
  seam (D-metric1). No competing client mount event was added.
- *Metric 3 (visual utility)* — DORMANT (D6): a deterministic, matched-item-only
  circuit-suppression arm marker (`splitTest.ts`) appended to the submit-turn payload
  behind `POLYMATH_ENABLE_CIRCUIT_SPLIT_TEST` (default off ⇒ unconfigured). Orthogonal
  to `spec.visibleReps`; never reshapes a probe.

**Discriminator discipline.** Every `events` read in `fetchMetricInputs` scopes to
`events.app IS NULL` (the D3 baseline/foreign-app guard), uniformly, mirroring
`countOffTopicAnswers`.

**Web.** `MetricsDashboard.tsx` renders four visually-distinct tile states (text badge
+ deuteranopia-safe blue/orange, never hue alone), a source tooltip per tile (AC#2), a
copy-able limitations memo listing every non-passing tile (AC#3), and a print-scoped
`metrics.css` consuming the global tokens with local fallbacks. The operator secret is
entered in-page and sent as the `X-Operator-Secret` HEADER — never a query param, never
bundled (D10); verified the URL stays `/metrics` and a 401 surfaces a `role="alert"`.
`IntelligibilityCheck.tsx` is a 1-in-3 seeded-deterministic post-mount prompt wired
into App's mount path, suppressed during transfer probes.

**Deferred / not applicable.** Threshold tuning and demo-deck screenshots are the
spec's MANUAL setup. PostHog/LangSmith wiring is explicitly out of scope (D-source:
agent-side derivation only; those remain corroborating tile `source` labels).
