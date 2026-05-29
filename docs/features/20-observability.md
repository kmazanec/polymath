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

## Build plan (approved)

**Iteration:** I5 (`i5-polish-observability-metrics`) · **Model tier:** Opus · **Runs:** concurrent with F-18, F-19 after the Step-0 barrier. Owns the `ui_mount` beacon + UI-churn endpoint **F-21 metric-1 reads**.

**Tier rationale:** First-wiring (not "verify + dashboards") of three independent env-gated external backends (OTel SDK+exporter, LangSmith, PostHog) that must each fail closed; owns a new shared contract (`ui_mount` WS event + the churn endpoint shape F-21 reads); crosses a CI secret-exposure boundary of the same class as `OPENAI_API_KEY` (`LANGCHAIN_API_KEY` must never enter MR pipelines); adds a new droplet container → Opus.

**Build summary — the spec's "Before" state is fiction against the code.** It claims LangSmith was "wired in F-05" and OTel "emitted in F-10": VERIFIED FALSE — **LangSmith is absent (only a comment), `voice/otel.ts` is OTel-API-ONLY (no SDK/exporter, a safe prod no-op), PostHog has zero wiring.** F-20 is first-real-wiring of all three. The load-bearing decision (**D5**, all three drafts converge): **F-21 metric-1 UI-churn is computed AGENT-SIDE from the event log, NOT from PostHog** — because the verified `ClientEvent` union has no mount event, UI mounts are client-only state that never reaches the agent, and PostHog is off-by-default at exactly demo time. Resolve by appending an **optional `ui_mount` WS beacon** (reusing the socket + the events-insert path, `app=null`, **NOT routed through the mastery/integrity fold** — that would be a fail-open integrity drift) and exposing `GET /api/session/:id/observability/ui-churn` gated by `checkOperatorAuth` like `/replay`; PostHog is a redundant view. The endpoint degrades to `status:'insufficient_data'` (never a divide-by-near-zero) on short/sparse sessions. **OTel reuse cut:** `sdk-trace-node` + the 9-attr `recordVoiceTurnSpan` already exist; F-20 only adds an OTLP exporter dep + a ~20-line `registerOtel()` called ONCE at the top of `main()` in `index.ts`, env-gated fail-closed. **LangSmith reuse cut:** `openaiClient.ts` uses LangChain `ChatOpenAI`, whose tracing is purely env-driven via `@langchain/core` — **NO `wrapOpenAI`/`traceable` code needed**; only set/validate env + a protected-main-only CI smoke job modeled byte-for-byte on `explain_back_live_eval`. **Path correction:** the collector goes in **`ops/` not `infra/`** (verified: `infra/` holds only caddy + deploy.sh + smoke.sh; the deployed stack is `ops/compose.prod.yaml` — a collector in `infra/` would never deploy). Net: every backend independently fail-closed, the headline metric works with ZERO external keys, the LangSmith secret isolated to protected CI.

**Checklist:**

- [ ] **(BARRIER — committed pre-fan-out, not in this worktree)** Append the optional `ui_mount` variant to `packages/contract/src/wire.ts` ClientEvent union: `{ kind:'ui_mount', sessionId: SessionId, componentKind: z.string().max(120), phase: z.string().max(60) }`. Append-only; existing 8 kinds unchanged. (F-21's `intelligibility_response` is appended in the same barrier commit.)
- [ ] TEST-FIRST (churn): `apps/agent/src/metrics/uiChurn.test.ts` for a pure `computeUiChurn(events)` over synthetic `ui_mount` — only `ui_mount` counted; **scoped `events.app IS NULL`** (mixed-app fixture rejects foreign rows); engagement-minutes from first→last ts; `byPhase` grouping; transfer-phase mounts surfaced separately (ADR-011 wants 0 during probes); **honesty guard** — denominator < ~0.5 min or count < threshold ⇒ `{ status:'insufficient_data', rawCounts }`, never a fabricated rate/NaN.
- [ ] Implement `apps/agent/src/metrics/uiChurn.ts` (pure fold, reuse the `app IS NULL` discriminator + the chronological ordering `/replay` uses). **Lock the response shape** (F-21 contract): `{ sessionId, status:'ok'|'insufficient_data', mountsPerMinute, byPhase:Record<phase,{mounts,mountsPerMinute}>, duringTransfer:{mounts}, rawCounts:{mountsTotal,engagementMinutes,windowStartTs,windowEndTs} }`.
- [ ] Persist the beacon: in the WS handler (`server.ts`, alongside the kind branches that insert events ~L1154/L1607) add a `kind==='ui_mount'` branch inserting an events row (`payload:{componentKind,phase}`, `app:null`) — append-only, NON-integrity, fire-and-forget. **MUST NOT route through the mastery/eventConsumer fold** (no BKT/streak/off-topic effect) and must not block the WS happy path. Test: a beacon writes a row but does not alter `learner_state`.
- [ ] TEST-FIRST (endpoint): `apps/agent/src/server.observability.test.ts` — `GET /api/session/:id/observability/ui-churn` gated by `checkOperatorAuth` EXACTLY like `/replay` (401 on bad secret when set, 503 unset+production, open dev/CI), returns the locked shape (or `insufficient_data`), 400 on bad sessionId. Then add the route in `createServer()` before the 404, `checkOperatorAuth` first, then `computeUiChurn` over the scoped ordered query.
- [ ] TEST-FIRST (OTel SDK): `apps/agent/src/voice/otelSdk.test.ts` — `registerOtel()` is a clean no-op (returns false, registers nothing, **never throws**) when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset/blank/partial; registers a `NodeTracerProvider` + OTLP exporter only on a complete URL; idempotent. Fail-closed per the LIVEKIT/realtime-session pattern.
- [ ] Add `@opentelemetry/exporter-trace-otlp-http` (pinned compatible with present `sdk-trace-node` 2.7.1 / api 1.9.1) to `apps/agent/package.json`. Implement `apps/agent/src/voice/otelSdk.ts` `registerOtel()`: reads `OTEL_EXPORTER_OTLP_ENDPOINT` (+ optional `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` default `polymath-agent`); missing/blank ⇒ false; else `NodeTracerProvider` + `Resource(service.name)` + `BatchSpanProcessor(OTLPTraceExporter)` + `register()`. **Do NOT touch `recordVoiceTurnSpan`'s signature or 9 attributes;** existing `voice/otel.test.ts` must still pass.
- [ ] Call `registerOtel()` ONCE at the top of `main()` in `apps/agent/src/index.ts` (verified entry point, BEFORE `createServer`), wrapped so a bad endpoint can never throw into boot.
- [ ] TEST-FIRST (PostHog gating): `apps/web/src/observability/posthog.test.ts` (vitest+jsdom) — `initPostHog()` is a NO-OP unless BOTH `import.meta.env.VITE_POSTHOG_KEY` AND `VITE_POSTHOG_HOST` are non-empty (**partial = not configured**) AND `consent===true`; `capture()` before init silently drops; group key = `sessionId` (ADR-006); session replay (`disable_session_recording`) stays OFF until consent. Add `posthog-js` to `apps/web/package.json` + `apps/web/src/vite-env.d.ts` declaring `VITE_POSTHOG_*`.
- [ ] Implement `apps/web/src/observability/posthog.ts`: lazy-load `posthog-js` only after consent; init guarded by `(key && host && consent)`; typed `capture` helpers for the LOCKED event names (`mount`, `hint_request`, `transfer_probe_entered`, `transfer_probe_exited`, `mastery_declared`, `lesson_transition`) + `groupBySession(sessionId)`; replay off until the consented branch.
- [ ] Build `apps/web/src/observability/ConsentModal.tsx` (+ test: PostHog stays uninitialized until explicit acknowledge, default OFF, decline leaves it off). Wire at session start in `App.tsx` (the L209-288 lifecycle effect). **D2/copy:** reference F-19's privacy copy behind a single exported constant with a TODO citing F-19 (one-line swap at integration — do NOT serially block F-20 on F-19).
- [ ] Wire emissions at the verified `App.tsx` hook points, each through the no-op-safe posthog wrapper AND each also firing the `ui_mount` beacon over the existing socket: mount (onMessage mount branch L244-263, `componentKind=spec.kind`+phase), `hint_request` (onRequestHint L363-370), `transfer_probe_entered/exited` (phase →/from `transferring`), `lesson_transition` (onContinue L413-425), `mastery_declared` (MasteryCelebration mount). No new sockets; every capture vanishes cleanly when PostHog unconfigured.
- [ ] LangSmith (reuse cut — NO code wrap): `openaiClient.ts` uses LangChain `ChatOpenAI`, env-driven tracing via `@langchain/core`. Do NOT add `wrapOpenAI`/`traceable` or a `langsmith` dep. Document/validate the env tuple (`LANGCHAIN_TRACING_V2=true`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT=polymath-{dev,demo}`) as self-gating (partial = off). Add an assertion that absent `LANGCHAIN_TRACING_V2` leaves the plain `ChatOpenAI` path unchanged.
- [ ] CI: add `langsmith_live_verify` to `.gitlab-ci.yml` modeled BYTE-FOR-BYTE on `explain_back_live_eval` — auto on protected `main`, `when: never` on `merge_request_event`, `manual`+`allow_failure` otherwise; inject `LANGCHAIN_API_KEY` ONLY there. **NOT in `verify`/`agent_test`.** grep-confirm the key appears nowhere in any `merge_request_event`-reachable job.
- [ ] INFRA (path = `ops/`, NOT `infra/`): `ops/otel-collector-config.yaml` (OTLP receiver 4317/4318; **default exporter = file/debug** as the always-on key-free demo fallback — **D8**; optional Grafana-Cloud OTLP behind env). Add an `otel-collector` service to `ops/compose.prod.yaml` on the internal network; point the agent at `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`. The YAML is read by the collector container (no agent-Dockerfile COPY). Droplet provisioning = MANUAL.
- [ ] Update `.env.example` (commented + blank, fail-closed notes): `OTEL_EXPORTER_OTLP_ENDPOINT/HEADERS`, `OTEL_SERVICE_NAME`, `LANGCHAIN_TRACING_V2/API_KEY/PROJECT`, `VITE_POSTHOG_KEY/HOST`. Confirm `apps/web/Dockerfile` plumbs `VITE_POSTHOG_*` as **build ARGs** (Vite inlines `import.meta.env` at BUILD time) or the deployed bundle silently lacks the key.
- [ ] Verify (below).

**Decisions (recommended defaults — see manifest):** D5 agent-side `ui_mount` beacon as the churn source (PostHog redundant) · D8 collector defaults to file/debug exporter, Grafana Cloud optional/manual · D12 PostHog session replay off-by-default, on only in the consented branch · copy: ship placeholder + TODO citing F-19, one-line swap at integration.

**Verification:** `pnpm typecheck` · `pnpm test` · `pnpm --filter @polymath/contract exec vitest run -t "ui_mount"` · `pnpm --filter @polymath/agent exec vitest run src/metrics/uiChurn.test.ts src/voice/otelSdk.test.ts src/server.observability.test.ts` · `pnpm --filter @polymath/web exec vitest run src/observability/posthog.test.ts src/observability/ConsentModal.test.tsx` · `pnpm --filter @polymath/web build` · `docker build -f apps/agent/Dockerfile -t polymath-agent-otel-check .` (OTLP exporter resolves in-image) · `docker compose -f ops/compose.prod.yaml config` · `grep -n 'LANGCHAIN_API_KEY' .gitlab-ci.yml` (ONLY under the protected job) · DEMO-PATH (no keys): PostHog no-op, LangSmith plain ChatOpenAI, OTel silent no-op, modal never blocks, `…/ui-churn` (with operator secret) returns data or `insufficient_data`, never a crash.

## Implementation notes (filled in by the building agent)

> Empty.
