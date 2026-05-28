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

## Implementation notes (filled in by the building agent)

> Empty.
