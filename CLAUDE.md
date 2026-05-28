# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Polymath** is a multimodal hyperresponsive mastery interface for Boolean logic. The pedagogical thesis: a learner has *mastered* a concept only when fluent across three irreducibly different representations — **truth tables, gate circuits, and pseudocode** — and that mastery is gated so strictly (BKT ≥0.95 + consecutive-correct + no-hints + response-time band + held-out transfer item + voice explain-back) that a "mastered" learner cannot have been pattern-matching or pasting LLM answers.

The architecture *is* the pedagogy. Read these before non-trivial work — they are the source of truth, not the code:
- `docs/ARCHITECTURE.md` — executive summary, data-flow diagrams, decision index.
- `docs/adrs/ADR-NNN-*.md` — every consequential decision **with its WHY**. ADRs are immutable after acceptance; a superseded decision gets a new ADR (`Supersedes: ADR-NNN`), never an edit.
- `docs/ROADMAP.md` — 7 iterations, 26 vertical-slice features, the iteration DAG, and the **contract change protocol**.
- `docs/features/NN-*.md` — per-feature specs. A feature ID like `F-05` maps to `docs/features/05-*.md`.

## Monorepo layout

pnpm workspace (`pnpm-workspace.yaml`), Node ≥22, ESM-only (`"type": "module"`). TypeScript project references off `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).

- `packages/contract` — `@polymath/contract`. Zod schemas + types for **all cross-cutting contracts**: `ComponentSpec` (the 12-variant component registry), `Action` (the agent's 4-variant wire output), the `ClientEvent`/`ServerMessage` WebSocket protocol, `PhaseName`, lesson-config schemas. **This is the most load-bearing package.** Imports are `.js`-suffixed (ESM).
- `packages/booleans` — `@polymath/booleans`. The single source of truth for Boolean correctness: `parse / evaluate / variables / truthTable / equivalent`. Pure, no deps. Its public signatures are **locked** (see the header comment in `src/index.ts`). Truth tables are MSB-first (first variable = most significant bit).
- `packages/statechart` — `@polymath/statechart`. The XState v5 lesson spine. Owns *when* the UI may change. The **phase shape** (`introducing → practicing → {hint, transferring} → assessed → {mastered, remediating}`) is locked; downstream features fill in guard *bodies* (`canDeclareMastery`, `canEndItem`), never re-shape the spine.
- `apps/agent` — `@polymath/agent`. Node HTTP + WebSocket service. LangGraph inner agent (stubbed until F-05), Drizzle/Postgres persistence, the server-side Action validation gate.
- `apps/web` — `@polymath/web`. Vite + React 19 + React Router SPA. Renders `ComponentSpec` via one **exhaustive switch** (`src/components/registry.tsx`) — no dynamic lookup, no `eval`, no `dangerouslySetInnerHTML`.
- `lessons/<id>/` — `content.json` + `mastery_config.json` per lesson, validated against the contract at load time.
- `infra/` (local + CI helpers: `deploy.sh`, `smoke.sh`, `caddy/`) and `ops/` (production compose + caddyfile synced to the droplet).

## Commands

Run from the repo root unless noted. Package manager is **pnpm** (via corepack).

```bash
pnpm install                       # install workspace deps
pnpm test                          # all unit/integration suites (vitest run, projects = packages/* + apps/*)
pnpm test:watch                    # watch mode
pnpm typecheck                     # tsc --noEmit across every package
pnpm build                         # build packages/** then apps/** (order matters: packages first)

# A single package's tests:
pnpm --filter @polymath/booleans test
pnpm --filter @polymath/agent test          # includes the WS+Postgres integration test (needs a DB — see below)

# A single test file / test name (vitest):
pnpm --filter @polymath/agent exec vitest run src/server.integration.test.ts
pnpm --filter @polymath/booleans exec vitest run -t "equivalent"

# Run the stack locally (Postgres + agent + web + Caddy, single entrypoint on :8080):
cp .env.example .env               # then fill secrets as features need them
docker compose up --build          # http://localhost:8080  (override port with CADDY_HOST_PORT)
./infra/smoke.sh                   # post-deploy smoke test (health, session, WS round-trip)

# Dev servers (without Docker):
pnpm --filter @polymath/web dev    # Vite dev server (:5173)
pnpm --filter @polymath/agent dev  # tsx watch; needs a reachable POSTGRES_URL

# Database (from apps/agent):
pnpm --filter @polymath/agent exec drizzle-kit generate   # new migration from schema.ts changes
pnpm --filter @polymath/agent run db:migrate              # apply migrations (also runs on agent boot)
```

The agent integration test needs Postgres. Locally it can spin its own; in CI it connects to a sibling container via `TEST_POSTGRES_URL` (the shell-executor test container has no Docker socket). If `@polymath/agent` tests hang or fail on connection, that's a missing/unreachable DB, not a code bug.

## How the pieces talk (the load-bearing invariants)

- **High-frequency interaction is client-only, and never touches the network.** Toggling truth-table inputs, dragging gates, the learner-triggered pulse animation, and the immediate correctness verdict (truth-table compare via `@polymath/booleans`, <5ms) all happen in the browser. The learner sees their answer marked correct *before* the agent decides what to mount next. This separation is what makes the UI feel alive — do not move correctness checking server-side.
- **The LLM is on the critical path only at phase boundaries** (~5–10 calls/lesson). It never invents UI. It picks a `kind` from the typed `ComponentSpec` registry and fills slots; the XState guards are the truth-maker. "Generative UI" in the freeform-JSX sense is an explicit non-goal (ADR-005).
- **The server never trusts the agent.** Every proposed `Action` is re-validated against the locked Zod schema before crossing the wire; a malformed action is downgraded to `no_action` (`apps/agent/src/agent/validateAction.ts`). Item-generating components carry a `claimedTruthTable` the server independently recomputes via `@polymath/booleans` (ADR-010 Layer 2).
- **Lesson content must agree with the validator.** `loadLesson` (`apps/agent/src/lessons/loader.ts`) throws if a hand-authored `truthTable` disagrees with the computed one. The validator wins; fix the content.
- **The explain-back is the integrity boundary.** Deterministic preconditions (duration, word-count, KC-vocab, item-specific reference) run *first*; only if they pass does the LLM judge content (ADR-010/011).

## Contract change protocol (read before touching `packages/contract`)

Contracts lock at the end of iteration 0 specifically so iterations 1–6 can fan out across parallel feature branches. Changing them ripples everywhere, so:

- The WebSocket event/message kinds and the `Action` wire union are **append-only** — never re-shape an existing kind's payload. New variants are added behind a version, per `docs/ROADMAP.md`. Adding a **new optional field** to an existing event is allowed (it doesn't break existing senders) — e.g. `submit.repSubmission`, the optional rep-native learner-input union added in I1 alongside the unchanged required `submission` string.
- Adding a `ComponentSpec` `kind` is a **coordinated change across three places**: the union in `packages/contract/src/component.ts`, the `COMPONENT_KINDS` array, the web renderer switch in `apps/web/src/components/registry.tsx` (the `never` default makes a missing case a compile error), and the agent's prompt+validator. Removals require a deprecation window.
- `@polymath/booleans` public signatures are locked; the gate alphabet may grow but the function shapes don't.

## Deploy

Single DigitalOcean droplet (`ssh gauntlet`) behind a shared Caddy, live at **https://polymath.biograph.dev**. GitLab CI (`.gitlab-ci.yml`): `verify` (typecheck + non-agent tests + build) and `agent_test` (agent suite against a sibling Postgres) run on MRs; on a push to `main`, `deploy` runs `infra/deploy.sh` (release-symlink pattern, atomic swap, health-check with rollback, Drizzle migrations on agent boot). CI runs on a **shell executor** — jobs do real work inside `node:22` containers and must never write build artifacts back into the checkout dir (root-owned files there break the next pipeline's checkout). Postgres data lives at `/opt/polymath/postgres` on the host, outside the release tree.

- **If a feature reads a file at runtime, confirm it's COPYed into the Docker image.** `apps/agent/Dockerfile` copies a curated set of dirs (`apps/agent`, `lessons`, `seed_data`, …) — it is *not* the whole repo. A path that resolves in local dev / CI (which have the full checkout) can still be `ENOENT` in the deployed image, and since migrations + the transfer-bank seed run at boot, a missing file crashes the agent before it serves `/api/health`, so the deploy's health-check rolls back. Unit/diff review won't catch this (the file exists on disk); only an image build does. When adding a runtime-read data dir, add the matching `COPY` and verify with `docker build` + an `ls` in the image. Boot-time seeding should also be **non-fatal** (degrade to a read-only/empty bank, don't crash) so a bad data file is a degraded read path, not a total outage.
- **Rep/workspace components must honor `spec.visibleReps` (the probe-integrity boundary).** A `ComponentSpec` carries `visibleReps`; a transfer probe (F-07) mounts a rep with the held-out reps excluded. Every rep component (`TruthTable`, `CircuitBuilder`, `PseudocodeChallenge`, …) must render `null` when its own rep isn't in `visibleReps` — otherwise a hidden rep stays reachable and the probe's "can the learner transfer without the crutch?" measurement is void. Don't gate only on a future `hiddenReps` prop; gate on `visibleReps`, which exists from F-01.
