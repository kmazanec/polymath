# Feature: Chat-baseline app (`apps/baseline`)

**ID:** F-16 · **Iteration:** I4 — Chat-baseline experiment · **Status:** Not started

## What this delivers (before → after)

**Before:** The brief explicitly demands "evidence the adaptive UI helps compared with a static or chat-only baseline" — but no baseline exists. The within-subject experiment design in [ADR-011](../adrs/ADR-011-evaluation-and-mastery-instrumentation.md) cannot run.

**After:** A separate web app `apps/baseline/` exists at `baseline.polymath.biograph.dev` (or `polymath.biograph.dev/baseline`). It is a minimal chat app: text + LaTeX responses, GPT-5-powered, *shares `packages/booleans` for correctness validation* (so the baseline doesn't have a worse content-correctness story than Polymath — which would be unfair per [ADR-011](../adrs/ADR-011-evaluation-and-mastery-instrumentation.md) tradeoffs). No statechart, no curated components, no mastery gate, no transfer probe beyond a stock end-of-session check. A learner can complete an L1 session via chat alone, with the same content from `lessons/1/content.json`.

The baseline is designed to be a fair comparison — the *only* differences from Polymath are the omitted architectural pieces ([ADR-011](../adrs/ADR-011-evaluation-and-mastery-instrumentation.md) names them precisely).

## How it fits the roadmap

I4, **off the critical path**. Concurrent with I2 and I3 against locked contracts (`packages/booleans`, `transfer_bank`, `lessons/1/content.json`).

## Dependencies (must exist before this starts)

- **F-08** — transfer bank seeded for pre/post tests.
- **`packages/booleans`** + **`lessons/1/content.json`** — both locked at end of I1.

That's it. Crucially, **F-16 does not depend on F-09, F-10, F-11, F-12, F-13, F-14, or F-15.** This is what makes I4 cross-iteration-concurrent with I2 and I3.

## Unblocks (what waits on this)

- **F-17** — experiment scaffolding wraps F-16.
- **F-21** — chat-baseline data feeds the counter-metrics dashboard.

## Contracts touched

- **`packages/booleans`** — consumes the validator; does not extend.
- **`transfer_bank`** — read-only consumer for pre/post tests.
- **`lessons/1/content.json`** — read-only consumer.
- **`apps/baseline`** — new top-level app. New routing, new build, new Caddy route.

## Sub-tasks

1. **T-16a — `apps/baseline` Vite (or Next.js) shell** `[parallel]`
   - Minimal chat interface: input box, message history.
   - Shares the OpenAI client config with `apps/agent` but uses GPT-5 directly (no LangGraph).
2. **T-16b — Chat loop with content from `lessons/1/content.json`** `[parallel after T-16a]`
   - System prompt: "You are a tutor for Boolean logic Lesson 1. Use the items from <content>. Use LaTeX for expressions."
   - Items are presented in chat sequence; learner responds in text.
3. **T-16c — Correctness check via `packages/booleans`** `[parallel after T-16a]`
   - Learner responses parsed; if they include a Boolean expression, validated against the target via the shared validator.
4. **T-16d — Stock end-of-session transfer check** `[parallel after T-16b]`
   - At session end: 2 transfer items from `transfer_bank` (L1) presented as text questions.
5. **T-16e — Caddy route + deploy** `[parallel after T-16a]`
   - Subroute or subdomain for the baseline app.
6. **T-16f — Session event logging** `[parallel after T-16b]`
   - Baseline sessions log to the same Postgres `events` table with `app: 'baseline'` field for later analysis.

## Acceptance criteria (product behavior)

1. **A learner visits `baseline.polymath.biograph.dev` (or equivalent path)** and sees a chat interface introducing L1.
2. **The chat tutor presents the same L1 content** as Polymath — items from `lessons/1/content.json`.
3. **The learner can submit a Boolean expression in text** and have it correctness-validated via `packages/booleans` — fair comparison maintained.
4. **The session logs to Postgres** with `app: 'baseline'` so analytics can distinguish Polymath sessions from baseline sessions.
5. **At session end**, the learner is presented with 2 transfer items from `transfer_bank` (L1, held out from this session); their answers are scored.
6. **The baseline session takes a comparable amount of time to a Polymath L1 session** (rough target: 10–15 minutes).
7. **No statechart, no curated components, no mastery gate, no explain-back** — verifiable by reading the codebase; the brief's "what we omitted from the baseline" is observable.

## Testing requirements

- Component tests for the chat shell.
- Unit test: `packages/booleans` import path works from `apps/baseline` (cross-package import sanity).
- Integration test: a scripted "subject" walks through 3 items + 2 transfer items; logs land in the events table with `app: 'baseline'`.

## Manual setup required

- Caddy route configuration for the baseline app — small change to `polymath.caddyfile`, deploy.
- Decide subdomain vs. subpath. **Recommendation**: subpath `polymath.biograph.dev/baseline` to avoid DNS work.

## Convergence and expected rework

None expected — F-16 is fully isolated by app boundary. Zero shared files with Polymath's web/agent code beyond the contract packages.

⚠ **F-17 absorbs F-16's interface** for the experiment scaffolding. Lock the baseline's "what data does it log per session" early in F-16 so F-17 can read it.

## Build plan (approved)

> Planned by kmaz-plan-iteration (architect + researcher + contrarian, reconciled). Iteration slug
> **`i3i4-lessons2-baseline`**. **Build order: FIRST in I4** (F-16 → F-17); concurrent with all of
> I3 (different files). **Model tier: Opus for the topology/persistence wiring** (deploy +
> events-tagging + fairness-correctness decisions), **Sonnet for the SPA + chat shell** once the
> topology is fixed.

**The fairness mandate is the whole point (ADR-011) — the build must NOT drift into an unfair baseline:**
- **Same correctness path.** Score learner expressions via the *same* logic as Polymath — `equivalent()` **with the ≤10 distinct-variable cap AND parse-error→incorrect** (the `recomputeCorrect`/`computeTransferVerdict` triad). A chat learner types free text (prose, partial), so the parse-catch is mandatory (a thoughtful prose answer → re-prompt, not "wrong"; an unparseable string → `false`, never a crash; >10 vars → `false`, never a 2^n enumeration DoS). **Do NOT ask the LLM "is this right?"** and **do NOT reimplement scoring** — reuse the path (lift it into a shared module if needed).
- **Same model, same content.** Use the **strong model (`gpt-5`)** for the whole baseline (documented as "never disadvantaged on model strength"); inject the exact `lessons/1/content.json` items (don't let the LLM invent problems).
- **Document what the baseline does WELL** (ADR-011 requires it): same model, same content, real `@polymath/booleans` validation, genuine LaTeX dialogue. A strawman baseline is as invalid as a too-weak one.

**Security/CI hard rules:**
- **LLM call is SERVER-SIDE only** — a Vite SPA calling OpenAI exposes `OPENAI_API_KEY` in the browser bundle. Fail closed if the key is absent (`503`, like `/api/realtime/session`).
- **MR CI is offline** — no `OPENAI_API_KEY` in `verify`/`agent_test`. All baseline tests **mock the LLM** (an injectable chat-provider seam, like the agent's `StubAgentClient`).

**Fixed-length session (resolves AC#6's vagueness):** no mastery gate → no natural end. Use a fixed structure: **all 3 L1 content items → then the 2 held-out transfer items → end.** The fair comparator is *item exposure*, not Polymath's gate.

**TWO TOPOLOGY DECISIONS for Keith (manifest Q1/Q2) — build is gated on these.** Recommended defaults below; the build adopts them unless overridden:

1. **Where the chat server + event logging live.** *Recommended:* a **`/api/baseline/*` route group on `apps/agent`** + a thin static SPA `apps/baseline`. Reuses the agent's Postgres pool, Dockerfile, deploy health-check, and `agent_test` CI-DB; the OpenAI key is already wired there; it touches *zero* existing agent code paths (purely additive routes). The "isolation" ADR-011 cares about is omitted *pedagogy*, not process boundary. *Alternative (architect):* a standalone `apps/baseline-server` — cleaner process isolation but doubles infra (new Dockerfile + compose service in **both** compose files + Caddy + a regenerated lockfile that forces `COPY` edits in the agent AND web Dockerfiles). **The standalone Vite-SPA-only reading is rejected** (key exposure + workspace-glob ripple).
2. **Event/session tagging + Polymath-metric contamination.** Baseline sessions go in the shared `sessions`/`events` tables (FK requires a `sessions` row). Polymath's analytics/replay/counter-metric queries filter by `sessionId` only — they'd silently fold baseline rows in. *Recommended:* a **nullable `app text` column on `sessions` and `events`** (additive migration, NULL = polymath), with F-17/F-21 explicitly filtering `app='baseline'` — structural, not a payload-dig everyone must remember. *Alternatives:* `app:'baseline'` in `payload` jsonb (no migration, but `payload->>'app'` digs + implicit NULL=polymath rot), or fully separate `baseline_sessions`/`baseline_events` tables (zero contamination, more plumbing). **Lock the per-session log shape before F-17** (F-17 reads it).

**Checklist (assuming recommended topology):**

- [ ] **`app` discriminator (barrier-adjacent).** Add nullable `app` to `sessions`+`events` (Drizzle migration, additive). Lock the baseline per-session event shape (kinds: `session_started`/`chat_turn`/`transfer_submitted`/`session_ended`; fields incl. `app`, `correct: bool|null`, `itemId`, `score:{correct,total}`).
- [ ] **Shared correctness module.** Extract the var-capped + parse-catch equivalence scorer so both Polymath and baseline call identical code (don't reimplement).
- [ ] **Baseline chat routes on `apps/agent`** (`/api/baseline/session`, `/api/baseline/chat`, `/api/baseline/transfer`): inject `lessons/1/content.json`; chat via an injectable provider (real = `gpt-5`, test = stub); score user expressions via the shared module; log every turn with `app:'baseline'`; fixed-length end. Fail closed without the key.
- [ ] **SPA `apps/baseline`.** Clone the `apps/web` Vite scaffold minimally (React 19; `<base href="/baseline/">`); chat UI + LaTeX (`react-katex`) + transfer-check screen. NO statechart/XState/curated-components/voice/CodeMirror/xyflow (AC#7 verifiable by reading deps). Proxy `/api` in dev.
- [ ] **Deploy.** Caddy `handle /baseline*` + (if routes are on the agent) nothing else; Dockerfile `COPY apps/baseline` for the static build; docker-compose `baseline` web service in **both** `docker-compose.yml` and `ops/compose.prod.yaml`; verify with a real `docker build`. (If standalone server chosen, add its Dockerfile/service/Caddy-api-route too.)
- [ ] **Tests (all OFFLINE).** Chat-shell component tests; cross-package import sanity (`equivalent` reachable from baseline); integration (scripted subject, mocked LLM: 3 items + 2 transfer → events land with `app:'baseline'`, exact shape F-17 reads). DB-backed test rides `agent_test`.
- [ ] **Verify:** `pnpm typecheck` · `pnpm --filter @polymath/baseline test` · baseline route tests · `pnpm test` · `docker build` (agent + baseline) · `docker compose up --build` then `curl localhost:8080/baseline/`.

**Convergence:** isolated by app boundary EXCEPT the shared-`events`/`sessions` tagging (additive migration) and the deploy files (append-only). The F-16↔F-17 contract is the locked per-session log shape + the `app` discriminator + (if added) the `sessions.subjectId` linkage — F-17 reads all three.

## Implementation notes (filled in by the building agent)

> Empty.
