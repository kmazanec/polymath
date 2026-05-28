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

## Implementation notes (filled in by the building agent)

> Empty.
