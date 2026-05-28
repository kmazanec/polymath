# Feature: Walking skeleton + locked contracts

**ID:** F-01 · **Iteration:** I0 — Skeleton + contracts · **Status:** Not started

## What this delivers (before → after)

**Before:** There is no Polymath app. `polymath.biograph.dev` does not exist. Nothing is deployed. There is no shared schema between any future browser and any future agent service. No team member can start work because there are no contracts to build against.

**After:** A visitor to `https://polymath.biograph.dev/` sees a `LessonIntro` card for "Lesson 1 — Basic operators." They can click a `Submit` button that round-trips through the deployed agent service via WebSocket, with the agent emitting a stub `no_action` Action (validated server-side against the locked Zod schema) and the statechart receiving an event acknowledgment. Postgres is up; the `sessions` row is written. Every contract that downstream features will extend (`ComponentSpec`, `Action`, `packages/booleans` validator, statechart spine, WebSocket protocol, `lesson_config` JSON shape) is locked in committed code.

This is the walking skeleton. It is thin in every layer — *intentionally*. Iteration 0's job is to convert wall-clock into parallelism budget for everything downstream.

## How it fits the roadmap

Iteration 0, sole feature. **On the critical path.** Blocks F-02 through F-26. Cannot run concurrent with any other feature; everything downstream consumes contracts that don't exist until F-01 lands. The most important investment in the roadmap — see ROADMAP.md § "Iteration 0 is the most important investment."

## Dependencies (must exist before this starts)

None — can start immediately. The architecture and all 12 ADRs are the input.

External:
- DigitalOcean droplet `gauntlet` (already provisioned per workspace CLAUDE.md)
- Caddy reverse proxy on the droplet (already running for sibling projects)
- Domain `polymath.biograph.dev` (subdomain to be added)
- OpenAI API key in `.env` on the droplet (provisioned ahead of time)
- GitHub repo + Actions runner

## Unblocks (what waits on this)

Every other feature in the roadmap. F-02..F-26 all depend on at least one of F-01's locked contracts (`ComponentSpec`, `Action`, `packages/booleans`, the statechart spine, the WebSocket protocol, or the deploy pipeline).

## Contracts touched

This feature **introduces** every cross-cutting contract:

- **`ComponentSpec` registry** — the typed discriminated union from [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md). Minimum viable form: includes at least `LessonIntro` (so the walking skeleton renders something) and stub branches for the 12 named variants (each variant in the union, but only `LessonIntro` actually rendered in this feature; others are placeholder `case` arms that render a "TBD" component).
- **`Action` schema** — `mount | transition | answer_question | no_action`, all four variants present in the Zod schema; only `no_action` actually emitted by F-01's agent stub.
- **`packages/booleans`** — parser for the L1 grammar (variables, `AND`, `OR`, `NOT`, parens), AST, truth-table generator, equivalence check. Sufficient to support L1 only — NAND/XOR/etc. come in later features. Public API surface (`parse`, `truthTable`, `equivalent`) is the locked contract; the alphabet of supported gates can grow.
- **Statechart spine** — `packages/statechart/src/lesson.ts`. lesson_1 sub-statechart with phases `introducing → practicing → {hint, transferring} → assessed → {mastered, remediating}`. Guards present but trivially-true at F-01 (real predicates land in F-09/F-12).
- **WebSocket message protocol** — `packages/contract/src/wire.ts`. Event kinds: `submit`, `request_hint`, `transfer_submitted`, `explain_back_recording_ended`, `learner_question`, `session_start`, `session_end`. Outbound: wrapped `Action`. The shape is locked; new event kinds are append-only.
- **Mastery gate predicate signature** — `apps/agent/src/mastery/gate.ts` exposes a stub returning `false`. Signature is locked; F-09/F-12 implement the body.
- **Lesson config JSON shape** — `lessons/1/mastery_config.json` (full parameter set per [ADR-011](../adrs/ADR-011-evaluation-and-mastery-instrumentation.md)) + `lessons/1/content.json` (3 stub items). Shape is locked; lesson_2/3/4 directories will follow the same shape.
- **Curated component registry (rendering)** — `apps/web/src/components/registry.ts` switch on `ComponentSpec.kind`. Exhaustive switch with TODO stubs for variants F-01 doesn't render itself.
- **`transfer_bank` Postgres table schema** — table created by migration; seed data deferred to F-08. Schema is the contract; rows come later.

This is more contracts than any other feature touches. Every one of them being introduced *here* and *only* extended (not changed) downstream is the entire point of the iteration.

## Sub-tasks

1. **T-01a — Monorepo + `packages/contract` Zod schemas + types** `[parallel]` (~1 day)
   - pnpm workspaces, root `package.json`, `tsconfig.base.json`.
   - `packages/contract` with `ComponentSpec`, `Action`, `wire.ts` event types — all as Zod schemas with inferred TS types.
2. **T-01b — `packages/booleans` validator (AND/OR/NOT only)** `[parallel]` (~1 day)
   - Parser (recursive descent or peg.js — choose one), AST, evaluator over `Record<string, boolean>`, truth-table generator, equivalence check.
   - 100% unit test coverage at this stage (the validator is the single source of truth for correctness; it cannot have bugs).
3. **T-01c — `packages/statechart` lesson_1 spine** `[parallel]` (~1 day)
   - XState v5 machine with the named phases.
   - Stub guards (return constants).
   - Exported visualisable model.
4. **T-01d — `apps/web` shell** `[parallel after T-01a, T-01c]` (~1.5 days)
   - Vite + React + React Router + XState integration.
   - WebSocket client (reconnect, message-typing via `packages/contract`).
   - Renderer switch on `ComponentSpec.kind` (just `LessonIntro` rendered; others stub-render "TBD").
   - `<AnimateOrNot>` wrapper from [ADR-008](../adrs/ADR-008-frontend-and-client-architecture.md) with reduced-motion stub.
5. **T-01e — `apps/agent` skeleton** `[parallel after T-01a]` (~1.5 days)
   - Node + TypeScript + LangGraph-js + LangChain (provider abstraction only).
   - WebSocket server.
   - REST: `POST /api/session`, `GET /api/session/:id/replay` (stub), `GET /api/health`.
   - Drizzle ORM + Postgres connection.
   - Initial migrations: `sessions`, `events`, `learner_state`, `transfer_bank` (empty), `validated_distractors`, plus LangGraph's checkpointer schema.
   - LangGraph graph that emits `no_action` on any incoming event (sufficient for the round-trip test).
6. **T-01f — Deploy infra** `[serial after T-01a..T-01e]` (~1 day)
   - `docker-compose.yml` (web static asset volume, agent container, postgres container).
   - `apps/agent/Dockerfile` (multi-stage Node build).
   - `polymath.caddyfile` in `infra/caddy/` with WebSocket upgrade allowed on `/agent`.
   - Deploy script: rsync to droplet, `docker compose pull && up -d`, health-check verify.
   - DNS A-record for `polymath.biograph.dev` → droplet IP (manual one-time).
   - GitHub Actions workflow: build, push image, deploy on green main.

**Convergence:** all sub-tasks merge into the single F-01 PR. T-01f is the serial bottleneck; everything else runs concurrent.

## Acceptance criteria (product behavior)

A reviewer who has never seen this code can verify each of these by visiting the deployed URL or running a CLI command. *No unit-test acceptance criteria here* — those belong in "Testing requirements" below.

1. **`https://polymath.biograph.dev/` returns HTTP 200** with the Vite static bundle and a visible "Lesson 1 — Basic operators" `LessonIntro` card.
2. **`https://polymath.biograph.dev/api/health` returns HTTP 200** with body `{"status":"ok"}`.
3. **Clicking the `Submit` button in the browser** opens a WebSocket to `wss://polymath.biograph.dev/agent`, sends a `submit` event, receives a `no_action` Action back within 1 second, and a row appears in the `events` table of the deployed Postgres.
4. **Submitting from a fresh browser session creates a row in the `sessions` table** with a non-null session ID and `started_at`.
5. **The agent's `no_action` Action validates against the locked Zod schema** server-side before being sent over the wire — verifiable by mutating the agent stub to emit a malformed object and observing it gets caught and downgraded to a no-op.
6. **`packages/booleans` correctly evaluates `(A AND B) OR (NOT C)`** for all 8 assignments of A, B, C — verifiable from a node REPL in the deployed container: `import { equivalent } from '@polymath/booleans'; equivalent('(A AND B) OR (NOT C)', '(NOT C) OR (B AND A)')` returns `true`.
7. **The XState `lesson_1` machine transitions `introducing → practicing` on a `start_practice` event** in isolation, visible via Stately Studio's import of the machine definition (or a screenshot if Stately is not used).
8. **GitHub Actions CI on a PR runs the package-level tests** (booleans, contract schema, statechart) and reports green before merge.
9. **The deploy script (`make deploy` or equivalent), run from a workstation, rebuilds containers and brings them up on the droplet without manual intervention** beyond `ssh gauntlet` credentials.
10. **Caddy correctly upgrades the `/agent` path to WebSocket** — verifiable via `wscat -c wss://polymath.biograph.dev/agent` opening the connection.

## Testing requirements

- **Unit tests:** `packages/booleans` at 100% coverage (parser, AST, evaluator, equivalence). `packages/contract` round-trips every Action and every ComponentSpec variant through Zod and back to TS (a single property test suffices). `packages/statechart` covers each named transition.
- **Integration test:** A test harness that boots the agent service in-process, opens a WebSocket connection, sends a `submit` event, asserts a valid `Action` comes back. Runs in CI.
- **Deployed smoke test:** A shell script in `infra/smoke.sh` that runs after deploy and hits the four URLs from acceptance criteria 1–4. Failure rolls back the deploy.
- **Contract tests:** Every `ComponentSpec.kind` listed in the registry has a rendering case in `apps/web/src/components/registry.ts` (TS exhaustiveness check enforces this at compile time). Every `Action.type` similarly.

## Manual setup required

- Create DNS A-record `polymath.biograph.dev` → droplet IP. One-time.
- Provision OpenAI API key, LiveKit API key/secret (LiveKit not yet used in F-01 but env var slot is wired so F-10 has no infra change), LangSmith API key, PostHog key. Store in `/opt/polymath/.env` on the droplet, root-owned, mode 0600.
- Confirm Caddy's `/etc/caddy/conf.d/` directory exists on the droplet (per workspace CLAUDE.md) and drop in `polymath.caddyfile`. Reload Caddy.
- Create the GitHub Actions deploy SSH key, add the public key to `~/.ssh/authorized_keys` for the deploy user on the droplet, add the private key as a GitHub Actions secret.

## Convergence and expected rework

None expected — F-01 has no concurrent peers. Its outputs *are* the contracts everything else consumes.

If a downstream iteration discovers a contract bug (e.g., a field that should have been there isn't), the fix is a coordinated change to `packages/contract` plus a coordinated PR across `apps/web` and `apps/agent`. The risk this happens is real but bounded: the contract was designed against [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md), [ADR-007](../adrs/ADR-007-orchestration-division-of-labor.md), [ADR-009](../adrs/ADR-009-backend-persistence-and-hosting.md), all of which think through the full MVP shape.

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records implementation decisions and rationale here as it builds — chosen libraries/patterns within the architecture's constraints, trade-offs made, deviations from assumptions and why, and anything the next agent or the integrator needs to know.

### Approved plan (checklist)

Branch `feat/f-01-walking-skeleton`, worktree at `<repo>/.worktrees/f-01-walking-skeleton`.
Built on `@polymath/*` scoped package names, minimal real LangGraph stub (no LLM call),
infra configs authored + locally verified but **not deployed** (live deploy + DNS + droplet
secrets deferred to a manual follow-up; acceptance criteria 9–10 live verification deferred).

- [ ] **Chunk 1 — Monorepo scaffold.** pnpm workspaces, root `package.json`,
      `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore` (incl. `.worktrees/`),
      `.nvmrc`, vitest workspace. Verify `pnpm install`.
- [x] **Chunk 2 — `@polymath/booleans`** (test-first, 100% cov). `parse`, `evaluate`,
      `truthTable`, `equivalent`; recursive-descent, AND/OR/NOT, precedence NOT>AND>OR.
      Verify acceptance criterion 6 expression equivalence + 8-assignment truth table.
- [ ] **Chunk 3 — `@polymath/contract`.** Zod `ComponentSpec` (12 ADR-005 variants, with
      `claimedTruthTable` on item variants), `Action` (4 variants), wire protocol events,
      shared `Rep`/`Gate`/`PhaseName`. Round-trip test every variant.
- [ ] **Chunk 4 — `@polymath/statechart`.** XState v5 `lesson_1` spine with locked phases
      `introducing → practicing → {hint, transferring} → assessed → {mastered, remediating}`,
      stub (constant) guards. Transition tests (incl. `introducing→practicing`, criterion 7).
- [ ] **Chunk 5 — `lessons/1/`.** `mastery_config.json` (full ADR-011 param set) +
      `content.json` (3 stub items, one per L1 KC). Zod config schema + contract test.
- [ ] **Chunk 6 — `apps/agent`.** Drizzle schema + migrations (`sessions`, `events`,
      `learner_state`, `transfer_bank` empty, `validated_distractors`); REST
      (`GET /api/health`, `POST /api/session`, `GET /api/session/:id/replay` stub); `ws`
      server at `/agent`; LangGraph `StateGraph` no_action node behind `AgentClient` seam;
      **server-side Zod validation of every Action before send** (criterion 5). In-process
      integration test: boot → WS `submit` → valid `no_action` + `events` row written.
- [ ] **Chunk 7 — `apps/web`.** Vite + React + React Router + XState; typed WS client;
      exhaustive `registry.ts` switch on `ComponentSpec.kind` (TS `never` check); `LessonIntro`
      "Lesson 1 — Basic operators" + `Submit`; `<AnimateOrNot>` reduced-motion stub. Verify
      `pnpm build` → `dist`; Submit round-trips `no_action`.
- [ ] **Chunk 8 — `infra`.** `apps/agent/Dockerfile`, `docker-compose.yml` (web+agent+pg,
      healthchecks), `infra/caddy/polymath.caddyfile` (WS upgrade on `/agent`),
      `infra/deploy.sh`, `infra/smoke.sh`, `.github/workflows/ci.yml`. Verify
      `docker compose up` healthy locally + `smoke.sh` against localhost + `caddy validate`.
- [ ] **Step 6 — Adversarial review** (spec-compliance + security on Opus; robustness +
      efficiency on Sonnet), triage-fix, **Step 6.5 retro**, rebase onto local main, push,
      open PR.

### Decisions & evidence (appended as chunks complete)

**Chunk 2 — `@polymath/booleans`.**
- Locked API: `parse(expr): Ast`, `evaluate(ast, env): boolean`, `variables(ast): string[]`,
  `truthTable(expr): {vars, rows, out}`, `equivalent(a, b): boolean`, plus `BooleanParseError`
  and the `Ast` type. Recursive-descent parser (no peg dep); grammar = single-letter
  variables (canonicalised uppercase), NOT/AND/OR (case-insensitive input), parens;
  precedence NOT>AND>OR; AND/OR left-associative.
- **Decision — truth-table row order:** first variable is the MSB, rows enumerate a binary
  counter (`000,001,…`). Locked so F-02 (TruthTable rep) and ADR-010 Layer-2
  `claimedTruthTable` agree on ordering. `out` is the boolean vector in that order.
- **Decision — `equivalent` over differing variable sets:** compares both expressions over
  the *union* of their variables, so a tautological no-op variable (e.g. `B AND NOT B`)
  compares equal. Matches the "shape preserved, alphabet grows" contract note.
- **Verification (criterion 6, compiled package):** `equivalent('(A AND B) OR (NOT C)',
  '(NOT C) OR (B AND A)')` → `true`; `truthTable('(A AND B) OR (NOT C)').out` →
  `[true,false,true,false,true,false,true,true]` (matches hand-computed `!C | (A&B)`).
- **Tests:** 40 tests, **100% coverage** (statements/branches/functions/lines), gated in the
  package `test` script via `vitest run --coverage` with a 100% threshold.
