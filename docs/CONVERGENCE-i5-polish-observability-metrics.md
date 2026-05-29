# Convergence report — I5 (MVP+ polish: SessionReport · privacy/a11y · observability · counter-metrics)

- **Integration branch:** `integration/i5-polish-observability-metrics`
- **Cut from:** `build/i5-polish-observability-metrics` @ `5e6a273` (frozen I5 contracts)
- **Tip:** `4d41df1` — 27 commits, all cherry-picked (linear, zero merge commits)
- **Date:** 2026-05-29
- **Assembled by:** autonomous integrator (cherry-pick only)

## Decision summary

Four features built off the frozen contract barrier. The dispatch's "preliminary
blocked" list was a **stale early snapshot** (e.g. F-21 captured at chunk 1/14 mid
duplicate-dispatch). The actual branch tips are complete, clean, all-green, with
`unresolvedGating: []` on every feature; the high-severity findings on F-20/F-21
were fixed-now on their branches. **All four are SHIPPED.** Nothing left out / blocked.

| Feature | Title | Shippable | Branch tip |
| ------- | ----- | --------- | ---------- |
| F-18 | SessionReport dashboard | YES | `0e0e8a8` |
| F-19 | Privacy + accessibility audit + global stylesheet | YES | `7f2ab50` |
| F-20 | Observability (PostHog + LangSmith + OTel + ui-churn) | YES | `ca126d4` |
| F-21 | Counter-metrics dashboard (6 metrics, four-state) | YES | `8785f51` |

## Batch-level evidence

### Integrated suite (full `pnpm test` on the assembled branch)

```
Test Files  2 failed | 95 passed (97)
     Tests  2 failed | 820 passed | 2 skipped (824)
```

The 2 "failures" are **shared-Postgres write-contention between parallel test
files**, not integration defects:
`src/privacy/sessionDeletion.integration.test.ts` and `src/voice/bridge.test.ts`
(barge-in). Both **pass in isolation** (`vitest run <both files>` → 12/12) and the
**entire agent suite passes serially** (`vitest run --no-file-parallelism` → 386
passed, 1 skipped, 49 files, exit 0). This is the documented pre-existing flake
class (F-19/F-20 reports both flagged shared-DB contention); CI's `agent_test` job
runs against a sibling Postgres and does not hit it. The 2 skips are the pre-existing
voice cross-platform deferrals.

`pnpm typecheck` → all 8 projects "Done", no errors (validates the merged wiring:
combined imports in `index.ts`/`server.ts`/`App.tsx`, both metric routes, both
telemetry-persistence blocks all compile).

### Smoke (live Dockerized full stack — Postgres + agent + web + Caddy)

Stack came up healthy on `CADDY_HOST_PORT=8091` (agent reported **Healthy** →
migrations + boot-time seeding + the new OTel registration + the new
deletion-sweep all succeeded; the new metrics/privacy/report code is COPYed into
the image and boots). `infra/smoke.sh`: checks 1-3 PASS (`GET /` app shell, `GET
/api/health` → `{"status":"ok"}`, `POST /api/session` → uuid). Check 4 (WS
round-trip) reports "timeout" **only because the smoke probe's `node -e` sends no
`Origin` header** and the CSWSH defense correctly 401s it — a pre-existing probe
limitation, not a regression. Verified the WS path works with a proper origin:

```
OPEN
MSG kind=action actionType=mount    # deterministic L1 first-item mount
```

**Primary new path (the three new operator endpoints), live:**

- Fail-closed (NODE_ENV=production, secret unset): `/api/metrics` → **503**,
  `/api/session/:id/report` → **503**, `/api/session/:id/observability/ui-churn`
  → **503** (`{"error":"operator routes not configured"}`).
- Authorized (operator secret set via override): wrong secret → **401**; good
  secret →
  - `GET /api/metrics` **200** — honest four-state payload (`state:"unconfigured"`
    / `"insufficient_data"`, `value:null`, `pass:null` — the defensible gray
    dashboard at empty N).
  - `GET /report` **200** — contract-valid `SessionSummary`, `source:"in_session"`,
    graceful nulls (`masteryStatus:"not_started"`, `explainBackVerdict.passed:false`).
  - `GET .../observability/ui-churn` **200** — `status:"insufficient_data"`,
    fail-closed nulls.

**Neighbouring existing path (regression):** the WS submit learner-loop returns a
`mount` action (core loop intact); the existing F-17 `POST /api/experiment/subjects`
still works — **201** with good secret, **401** with wrong secret — confirming I5's
shared `checkOperatorAuth` integrates cleanly with prior gated routes.

### Proof of linear history

```
$ git log --merges build/i5-polish-observability-metrics..integration/i5-polish-observability-metrics
(empty — no output)
```

Zero merge commits. Assembled entirely by `git cherry-pick` in DAG order
(F-18 → F-19 → F-20 → F-21).

### Convergence conflicts + resolution

All resolved in place as ordinary commits (no merge commits, no feature left out):

1. **`apps/agent/src/index.ts`** (F-20 `fb81e88` vs F-19) — import-only conflict;
   kept both `startSessionDeletionSweep` (F-19) and `registerOtel` (F-20); both boot
   wirings auto-merged in the body. Verified at boot (agent Healthy).
2. **`apps/web/src/App.tsx`** (F-20 `6f4584f` vs F-19) — import-only; kept
   `AboutSessionData` (F-19) + `ConsentModal`/`posthog` (F-20). Bodies auto-merged;
   confirmed both feature surfaces survived (AboutSessionData×2, ConsentModal×2,
   6 `capture()`, groupBySession×2).
3. **`apps/agent/src/metrics/index.ts`** (F-21 `9d572f7` vs F-20) — kept the
   `computeUiChurn` export (F-20) **and** the `computeAllMetrics`/`fetchMetricInputs`
   exports + `metric3Enabled` helper (F-21).
4. **`apps/agent/src/server.ts`** (F-21 `9d572f7` vs F-20) — combined the two
   telemetry-persistence blocks so **both** `ui_mount` (F-20, `app:null`) **and**
   `intelligibility_response` (F-21, durable) persist; the `buildMetricsPayload`
   (F-21) + `computeUiChurn` (F-20) route imports were already auto-merged.
5. **`apps/web/src/App.tsx`** (F-21 `8785f51` vs F-19/F-20) — import-only; added
   `IntelligibilityCheck`/`shouldSampleIntelligibility` alongside the prior three
   import groups. Body (5 IntelligibilityCheck uses) auto-merged.
6. **`apps/agent/src/server.ts`** (F-21 `8785f51` vs F-20) — import-only; added
   `circuitSuppressionArm` (used at the split-test mount site, body auto-merged)
   alongside the combined metrics import.

All conflicts were import-line / adjacent-block collisions from features that
independently extended the same boot file, the same React shell, the same metrics
barrel, and the same WS frame handler — i.e. the predicted I5 convergence. **No
conflict required human judgment; nothing was forced or skipped.**

### Features left out (blocked)

**None.** All four shippable.

---

## Per-feature verdicts

### F-18 — SessionReport dashboard — SHIPPABLE

- **Branch:** `feat/f-18` (tip `0e0e8a8`, 6 commits)
- **Acceptance:** met. Pure summary subgraph (`packages/graph`), agent `buildReport`
  producer, operator-gated `GET /api/session/:id/report`, web `SessionReport` view +
  print CSS. Verified live: 401/200/404 gate + 503 fail-closed; 200 returns a
  contract-valid `SessionSummary` with `source:"in_session"` and graceful nulls
  (AC#4). Docker image build picks up the new `packages/graph/src/summary/` subdir
  (no WORKSPACE_PKG_NOT_FOUND / ENOENT).
- **Unresolved gating:** none.
- **Deferred low findings:** (1) `explainBackVerdict.reasons` always `[]` even on a
  failed latched verdict — the report's reasons[] UI path is effectively dead;
  contract only requires `passed` pass-through, which is correct. (2) `MAX_SESSION_EVENTS`
  duplicated locally in `buildReport.ts` rather than imported — value matches; the
  report is a bounded read-only snapshot, not an integrity-accumulating counter, so a
  bounded window is correct per the monotonic-counter invariant.
- **Deferred checkbox:** print-stylesheet Playwright visual-regression shipped as a
  `test.fixme` scaffold (no committed baseline harness; e2e not in CI). Print CSS is
  exercised by the jsdom component test.
- **QA:** see batch smoke (report endpoint 200/404/503/auth). Build's own QA: real
  agent + Playwright DOM confirmed the auth form → populated dashboard.
- **Retro propagated:** nothing material (both findings are low/cosmetic).

### F-19 — Privacy + accessibility audit + global stylesheet — SHIPPABLE

- **Branch:** `feat/f-19` (tip `7f2ab50`, 7 commits)
- **Acceptance:** met. Global a11y stylesheet + tokens (now bundles on every route),
  deuteranopia-safe status colours, focus-trapped "About this session's data" modal,
  no-webcam source guard, additive `sessions.delete_after` column + drizzle 0004,
  session-data deletion on WS close with configurable grace (fail-closed, non-fatal
  sweep). jest-axe (jsdom) + @axe-core/playwright (real Chromium, contrast enabled)
  both pass with no serious/critical violations.
- **Unresolved gating:** none.
- **Deferred low findings:** (1) the COALESCE end-time comment was inaccurate — **fixed
  on-branch** by the trailing commit `7f2ab50` (re-close now honors the existing
  endedAt). (2) WS-close deletion is keyed by client-supplied sessionId with no
  per-socket auth — consistent with the pre-existing WS trust model (sessionId is the
  bearer credential); no new trust boundary. (3) the Playwright axe e2e cannot reach
  agent-mounted react-flow/CodeMirror (WS not interceptable) — honestly documented;
  rich widgets covered structurally by jsdom. (4) `sweepExpiredSessions` N+1 — bounded
  hourly background sweep, non-hot-path.
- **Deferred checkboxes:** manual VoiceOver + NVDA narration-order passes (human at a
  screen reader; no Windows VM) — the machine-checkable half is covered by axe.
- **QA:** real-browser axe (2 passed, contrast enabled); deletion path vs real
  Postgres (5 integration tests + WS open→start→close stamps endedAt + delete_after).
  Verified live at integration smoke (stack boots with the sweep running).
- **Retro propagated:** nothing material (the durable lesson here — fail-closed env
  config — is already in CLAUDE.md).

### F-20 — Observability (PostHog + LangSmith + OTel + ui-churn) — SHIPPABLE

- **Branch:** `feat/f-20` (tip `ca126d4`, 10 commits)
- **Acceptance:** met. `computeUiChurn` pure fold; persisted `ui_mount` beacon +
  operator-gated `GET /api/session/:id/observability/ui-churn` (verified 503/401/200
  live); env-gated OTLP exporter (`registerOtel`, clean no-op boot without endpoint —
  confirmed at integration boot); consent-gated PostHog client + consent modal;
  LangSmith env-driven CI verify job; OTel collector sidecar + env templates.
- **Unresolved gating:** none.
- **Resolved high finding (fixed-now on-branch, `ca126d4`):** **production-bundle DCE
  silently dropped four PostHog emissions** (`mastery_declared`,
  `transfer_probe_entered/exited`, `lesson_transition`). They were the trailing
  statement of their effect/callback bodies; Rollup tree-shook them out of the
  *minified* build only, so the jsdom (unbundled) vitest suite stayed green — a
  deploy-only loss. Fixed by giving `capture()`/`groupBySession()` an unconditional
  `globalThis` side effect the bundler can't prove dead; verified all six locked event
  names survive the minified artifact.
- **Deferred low findings:** ui_mount beacon awaits the insert before the ack
  (try/catch-wrapped, single fast insert — happy path not meaningfully degraded);
  beacon `phase` label can lag one render at a phase boundary (per-phase bucket only);
  `langsmith_live_verify` reuses the explain-back eval test (by-design reuse-cut; the
  env tuple is the whole integration, human confirms in the UI).
- **Deferred checkboxes:** LangSmith UI trace + PostHog live dashboard (need real
  keys + a deployed session); OTel collector backend provisioning (manual per spec);
  voice-loop OTel end-to-end (behind the unbuilt live LiveKit capture path).
- **QA:** ui-churn endpoint live 503/401/200 (batch smoke); OTel clean boot
  with/without endpoint; agent image builds + boots.
- **Retro propagated:** **YES — added a CLAUDE.md Deploy bullet** on the
  side-effect-free-DCE trap (analytics/telemetry calls must have an
  externally-observable side effect; web features whose acceptance depends on emitted
  events must be verified against the `vite build` artifact, not just jsdom).

### F-21 — Counter-metrics dashboard (six metrics, four-state) — SHIPPABLE

- **Branch:** `feat/f-21` (tip `8785f51`, 4 commits)
- **Acceptance:** met. Six pure four-state counter-metric computations (fail-closed:
  empty N → `insufficient_data`/`unconfigured`, never a default green/red);
  `fetchMetricInputs` single DB seam (`events.app IS NULL`-scoped) + `computeAllMetrics`;
  durable `intelligibility_response` persistence + operator-gated `GET /api/metrics`
  (verified 503/401/200 live, honest gray payload); web `MetricsDashboard` four-state
  render + `IntelligibilityCheck` 1-in-3 sampling; dormant (env-gated) circuit-suppression
  split-test (`circuitSuppressionArm`, default-off so it never perturbs probe integrity).
  The dispatch snapshot was stale (chunk 1/14, duplicate-dispatch); the branch tip is
  the complete feature, clean and green.
- **Unresolved gating:** none.
- **Resolved high finding (fixed-now on-branch, `0665ec1`):** the intelligibility
  integration test asserted an absolute global `sampleN` against a shared,
  never-truncated Postgres (red on every re-run); fixed to assert the delta
  (`beforeN + 5`) — production aggregation across sessions is correct.
- **Deferred low finding:** `fetchMetricInputs` N+1 (2 queries per experiment subject
  for metrics 5/6) — infrequently-hit operator route over a small cohort (N≈5-8).
- **QA:** `/api/metrics` live 503/401/200 with the honest four-state payload (batch
  smoke). Metric units green in isolation (34/34) + full serial agent suite.
- **Retro propagated:** nothing material (its high finding is a test-isolation fix; the
  shared-DB-contention lesson is already known and re-confirmed at batch level).
