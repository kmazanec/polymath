# Feature: Observability (PostHog session replay + LangSmith tracing + OTel)

**ID:** F-20 · **Iteration:** I5 — MVP+ polish · **Status:** Not started

## What this delivers (before → after)

**Before:** LangSmith traces fire from `apps/agent` (wired in F-05). OTel attributes are emitted from voice turns (wired in F-10). PostHog is unconfigured. No dashboards exist. The brief's "did the UI churn too much" counter-metric — which requires watching sessions — is unverifiable.

**After:** PostHog session replay is fully wired with opt-in flow (off by default; turned on for the N=5–8 baseline experiment subjects with informed consent). PostHog product analytics events fire on every UI mount, hint request, transfer-probe entry/exit, mastery transition. LangSmith trace integration is verified end-to-end and the project dashboards in the LangSmith UI are populated. OTel collector is running on the droplet and traces from voice turns are queryable.

## How it fits the roadmap

I5, **off the critical path**. Concurrent with F-18 and F-19. F-21 reads from all three observability surfaces.

## Dependencies (must exist before this starts)

- **F-12** — full mastery gate produces all the events worth tracking.
- **F-15** — multi-lesson flow generates lesson-transition events.

## Unblocks (what waits on this)

- **F-21** — counter-metrics dashboard composes data from PostHog, LangSmith, and OTel.

## Contracts touched

- **PostHog wiring** — `apps/web/src/observability/posthog.ts`. Event name conventions locked here.
- **LangSmith projects** — `polymath-dev`, `polymath-eval`, `polymath-demo`. Already created in F-05; F-20 verifies + adds dashboards.
- **OTel collector** — runs as a sidecar container on the droplet. `infra/otel/collector-config.yaml`.
- **No schema changes**.

## Sub-tasks

1. **T-20a — PostHog client + opt-in modal** `[parallel]`
   - `apps/web/src/observability/posthog.ts`.
   - Modal at session start asking consent; default off.
   - Group key = session ID per [ADR-006](../adrs/ADR-006-voice-and-agent-llm-stack.md).
2. **T-20b — Event emissions** `[parallel after T-20a]`
   - `mount`, `hint_request`, `transfer_probe_entered`, `transfer_probe_exited`, `mastery_declared`, `lesson_transition` events all fire to PostHog.
3. **T-20c — LangSmith project setup + dashboards** `[parallel]`
   - Confirm `polymath-dev` and `polymath-eval` are populated; create a `polymath-demo` project for the live evaluator session.
4. **T-20d — OTel collector deployment** `[parallel]`
   - `infra/otel/collector-config.yaml`.
   - Docker Compose sidecar.
   - Exports to a local file or a free OTel-compatible backend (e.g., Grafana Cloud free tier).
5. **T-20e — Voice-loop OTel verification** `[parallel after T-20d]`
   - Confirm every voice turn emits a trace with the F-10 attribute set.
6. **T-20f — UI churn rate counter** `[parallel after T-20b]`
   - Derived from PostHog mount events per minute of learner engagement — feeds F-21's metric 1.

## Acceptance criteria (product behavior)

1. **PostHog dashboard** shows live events from a deployed Polymath session (with opt-in granted in the test session).
2. **The opt-in modal** appears at session start and PostHog initializes only after acknowledgement.
3. **Every learner-facing UI mount** emits a `mount` event with the ComponentSpec.kind and current phase.
4. **LangSmith project `polymath-dev`** is populated with traces from a live session — verifiable in the LangSmith UI.
5. **OTel traces** for voice turns are queryable; one trace per voice turn with all F-10 attributes.
6. **UI churn rate** (mounts/min during practice phase) is computable from PostHog data and exposed via the agent's observability endpoint.
7. **PostHog session replay** is OFF by default and only ON for opted-in experiment subjects.

## Testing requirements

- Integration test: a synthetic session run produces the expected event sequence in PostHog (or a mock).
- Verification that opt-in modal blocks PostHog initialization until acknowledged.
- LangSmith project smoke test (a CI step that runs the agent eval suite and confirms traces land).

## Manual setup required

- Confirm PostHog account + project + API key.
- Confirm LangSmith projects exist (created in F-05).
- Provision OTel collector backend (free tier on Grafana Cloud or similar) — ~half day.

## Convergence and expected rework

None expected.

⚠ **PostHog opt-in copy** must align with F-19's privacy posture writeup. Strategy: F-19 writes the canonical privacy copy first; F-20's modal references it.

## Implementation notes (filled in by the building agent)

> Empty.
