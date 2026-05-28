# Feature: Walking skeleton + locked contracts

**ID:** F-01 · **Iteration:** I0 — Skeleton + contracts · **Status:** In review
**MR:** https://labs.gauntletai.com/keithmazanec/polymath/-/merge_requests/1

### Deploy wiring (follow-up to the initial F-01 MR)

The live deploy that F-01 deferred is now wired to the `gauntlet` droplet's
conventions (workspace `INFRA.md` / `.infra/NEW_APP.md`), on a follow-up branch
`feat/f-01-droplet-deploy`:
- **GitLab CI** (`.gitlab-ci.yml`) — the GHA workflow was removed (the runner +
  MR are GitLab). `verify` stage runs typecheck + package tests + build in a
  `node:22` `docker run` (RO-mount → copy to `/work`, never writing the host
  checkout), the agent WS+Postgres integration test against a sibling pg
  container (`TEST_POSTGRES_URL`), and the Cursor **code+security review** via the
  shared `gitlab-cursor-review` template. `deploy` stage runs the release-symlink
  `infra/deploy.sh` on pushes to `main`, gated on the verify jobs.
- **Droplet wiring** — `ops/compose.prod.yaml` (no local Caddy; joins
  `openemr_default`; pg data bind-mounted at `/opt/polymath/postgres` outside the
  release tree; build contexts from `/srv/polymath/current`), `ops/polymath.caddyfile`
  (routes `/api/*` + WS `/agent` → `polymath-agent:8080`, else → `polymath-web:80`),
  and `infra/deploy.sh` (rsync release → atomic symlink swap → build+recreate →
  public `/api/health` check with in-network fallback → rollback → prune to 2).
- **One-time droplet setup done:** `/srv/polymath/{releases}`, `/etc/polymath`,
  `/opt/polymath/postgres` created + chowned `gitlab-runner`; `/etc/polymath/.env`
  placed `640 root:gitlab-runner` (passes `audit-secrets.sh`). DNS:
  `polymath.biograph.dev` already resolves to the droplet (wildcard `*.biograph.dev`).
- **Still pending the first real deploy:** the CI variables `CURSOR_API_KEY` +
  `GITLAB_REVIEW_BOT_TOKEN` (for the review job) must be set on the project, and
  real `OPENAI_API_KEY` etc. go in `/etc/polymath/.env` when F-05 needs them
  (F-01 reads only `POSTGRES_*`). First push to `main` triggers the deploy.

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
- [x] **Chunk 3 — `@polymath/contract`.** Zod `ComponentSpec` (12 ADR-005 variants, with
      `claimedTruthTable` on item variants), `Action` (4 variants), wire protocol events,
      shared `Rep`/`Gate`/`PhaseName`. Round-trip test every variant.
- [x] **Chunk 4 — `@polymath/statechart`.** XState v5 `lesson_1` spine with locked phases
      `introducing → practicing → {hint, transferring} → assessed → {mastered, remediating}`,
      stub (constant) guards. Transition tests (incl. `introducing→practicing`, criterion 7).
- [x] **Chunk 5 — `lessons/1/`.** `mastery_config.json` (full ADR-011 param set) +
      `content.json` (3 stub items, one per L1 KC). Zod config schema + contract test.
- [x] **Chunk 6 — `apps/agent`.** Drizzle schema + migrations (`sessions`, `events`,
      `learner_state`, `transfer_bank` empty, `validated_distractors`); REST
      (`GET /api/health`, `POST /api/session`, `GET /api/session/:id/replay` stub); `ws`
      server at `/agent`; LangGraph `StateGraph` no_action node behind `AgentClient` seam;
      **server-side Zod validation of every Action before send** (criterion 5). In-process
      integration test: boot → WS `submit` → valid `no_action` + `events` row written.
- [x] **Chunk 7 — `apps/web`.** Vite + React + React Router + XState; typed WS client;
      exhaustive `registry.ts` switch on `ComponentSpec.kind` (TS `never` check); `LessonIntro`
      "Lesson 1 — Basic operators" + `Submit`; `<AnimateOrNot>` reduced-motion stub. Verify
      `pnpm build` → `dist`; Submit round-trips `no_action`.
- [x] **Chunk 8 — `infra`.** `apps/agent/Dockerfile`, `docker-compose.yml` (web+agent+pg,
      healthchecks), `infra/caddy/polymath.caddyfile` (WS upgrade on `/agent`),
      `infra/deploy.sh`, `infra/smoke.sh`, `.github/workflows/ci.yml`. Verify
      `docker compose up` healthy locally + `smoke.sh` against localhost + `caddy validate`.
- [x] **Step 6 — Adversarial review** (spec-compliance + security on Opus; robustness +
      efficiency on Sonnet), triage-fix, **Step 6.5 retro**, rebase onto local main, push,
      open PR.

### Adversarial review (Step 6)

**Wave 1 — spec-compliance (Opus) + security (Opus), in parallel.**

*Both reviewers independently flagged that the tool output they read contained injected
"Camino MCP" / "Auto Mode" instruction blocks unrelated to the task; both correctly ignored
them. Flagged to the user — looks like prompt-injection embedded in fetched content.*

- **Spec-compliance:** all 10 acceptance criteria **met** against the agreed local-stack scope
  (1–5, 10 verified locally; 9 + live URLs honestly deferred + documented; 6, 7, 8 fully met).
  **No contract drift** — ComponentSpec (12 variants + `claimedTruthTable` on the 3 item
  variants), Action (4 + `rationale`), the 7-phase statechart, the wire protocol, and the DB
  tables all match ADR-005/003/009/010/011. Two low items raised: weak smoke-test assertion for
  criterion 1, and `learner_state` missing a primary key.
- **Security:** one HIGH, three MEDIUM, two LOW.
  - **H1 (HIGH) — fixed.** Unawaited `handleClientFrame` could `unhandledRejection`-crash the
    process when a bad `sessionId` made the `events` insert reject (FK / bad-uuid). DoS via one
    WS frame. Fixed three ways: (a) `.catch` on the frame handler; (b) `sessionId` tightened to
    `z.string().uuid()` in the contract (`SessionId`) so malformed ids are rejected at the
    boundary; (c) `handleClientFrame` now checks the session exists and replies
    `{kind:'error', message:'unknown session'}` instead of letting the FK throw. Regression
    test added (`server.integration.test.ts`: unknown UUID → clean error, server stays healthy).
  - **M1 (MEDIUM) — fixed.** No WS frame-size cap (ws default 100 MB). Set `maxPayload: 64 KB`.
  - **M2 (MEDIUM) — fixed.** No Origin check on WS upgrade (CSWSH). Added `verifyClient` with an
    allowed-origins set (no-Origin non-browser clients still allowed; `allowedOrigins` injectable).
  - **M3 (MEDIUM) — documented, deferred.** `/api/session/:id/replay` is unauthenticated;
    bounded by unguessable UUID session ids + the ADR-009 prototype auth posture. Gating replay
    behind the active session is a later-feature concern; recorded for the user.
  - **L1 (LOW) — deferred.** `truthTable`/`equivalent` 2^n blowup is *unreachable* in F-01 (the
    agent stub ignores `submission`); F-05 must cap distinct-variable count before enumerating.
    Noted for F-05.
  - **L2 (LOW) — accepted.** Hardcoded local `polymath:polymath` pg creds; Postgres is
    `expose`-only (compose-network only), fine for the prototype; real creds come from the
    droplet `.env`.
  - Reviewer-confirmed positives: no `dangerouslySetInnerHTML`/`eval`; exhaustive typed
    renderer; Zod validation both wire ends; parameterized Drizzle queries (no SQLi);
    `.gitignore` excludes `.env*`; capped WS reconnect backoff.

Low spec items also fixed: `learner_state` now has a `(session_id, kc)` composite PK (ADR-009),
migration regenerated; smoke-test criterion-1 comment corrected (the SPA renders the LessonIntro
card client-side, so the static HTML is the app shell — the visible-card check is the browser
E2E already done in chunk 7).

Re-verification after fixes: `pnpm -r typecheck` clean; contract 17 tests, agent 12 tests
(incl. the new regression test) pass; full docker-compose stack rebuilt and `smoke.sh` passes
all four checks through Caddy.

**Wave 2 — robustness (Sonnet) + efficiency (Sonnet), in parallel.** No HIGH findings.
- **Robustness MEDIUM — fixed.** `server.close()` (in `index.ts` shutdown) waited forever on
  open WS connections, so SIGTERM hung and the container never exited / `pool.end()` never ran.
  `createServer` now returns a `PolymathServer` with a `close()` that terminates WS clients,
  closes the `wss`, then the HTTP server; `index.ts` shutdown drains → `pool.end()` → exit
  (idempotent via a `shuttingDown` flag). **Verified:** with a WS connection held open,
  `docker compose stop agent` returned in **0s** (vs. the ~15s SIGKILL timeout it would have hit
  before).
- **Robustness MEDIUM — fixed.** `AgentSocket.scheduleReconnect` left an uncancellable timer;
  `close()` during the backoff window kept a dangling timer alive (matters under StrictMode).
  Now stores `reconnectTimer` and clears it in `close()`.
- **Robustness LOW — deferred.** `agent.propose` has no timeout (safe with the sync stub;
  F-05's LLM call should wrap a deadline). Noted for F-05.
- **Efficiency MEDIUM — fixed.** `truthTable` enumerated 2^n once for `out` then re-derived
  `rows` from the mask in a second pass. Merged into a single pass (API unchanged) so the
  hot-path validator doesn't bake a double-enumeration pattern into the locked contract.
  Booleans still 100% coverage.
- **Efficiency LOW — accepted/deferred.** react-router for one route (deliberate shell seam;
  lazy-load lesson routes when L2+ pages land), `tsx` re-transpile on boot (documented), origins
  Set built once (confirmed clean), App.tsx renders fine.

Re-verification after Wave 2: `pnpm -r typecheck` clean; **85 tests pass** (booleans 40,
contract 17, statechart 11, agent 12, web 5); docker-compose stack rebuilt, `smoke.sh` passes
all four checks, and graceful shutdown confirmed (0s drain with an open WS).

### Retro

1. **What did we learn about the system that wasn't in the architecture?**
   - The droplet/dev port **8080 is already taken by a sibling project** (a `uvicorn` service).
     The compose stack is parameterized (`CADDY_HOST_PORT`) and uses internal ports + Caddy
     routing, so this is a local-dev/droplet-port-allocation concern, not an architecture change.
     Propagated to ROADMAP (cross-cutting note for deploy) below.
   - The `Action` wire union (ADR-005: `mount|transition|answer_question|no_action`) and the
     ADR-003 tactical menu (`rephrase`, `simpler_item`, …) initially *look* contradictory. They
     aren't — the menu is the agent's internal decision vocabulary that resolves into wire
     Actions. This is now documented in `action.ts` so F-05 doesn't add menu verbs to the wire
     union. Worth a one-line clarification in ARCHITECTURE/ADR-005 (proposed below).
2. **What did we learn that changes the roadmap?** Nothing structural. The contract surface
   matched the ADRs cleanly; no missing integration feature surfaced. Two small forward notes
   for later features (below) rather than roadmap edits.
3. **What contract changed?** One refinement, not a reshape: `sessionId` on the wire is now
   `z.string().uuid()` (`SessionId`) instead of a bare string — a security fix (reject malformed
   ids at the boundary). It's stricter but append-only-safe; downstream features already mint
   UUIDs (`POST /api/session`), so none are affected. Locked in `packages/contract/src/wire.ts`.
4. **What should the next feature builder do differently?**
   - **F-05 (inner agent loop):** wrap `agent.propose` with a timeout (the WS handler awaits it
     with no deadline — fine for the sync stub, a hang risk once it's an LLM call).
   - **F-05+ (anything feeding learner input into `@polymath/booleans`):** cap the distinct-
     variable count before calling `truthTable`/`equivalent` (2^n; the grammar allows 26 vars →
     64M rows). Unreachable today because the stub ignores `submission`.
   - **Coverage threshold pattern:** the per-package `test` script gates coverage
     (`vitest run --coverage` + 100% thresholds in `booleans`); reuse this for any package that
     claims a coverage bar. Don't put the source file in vitest's coverage `exclude` (that
     silently zeroes the report — hit during chunk 2).

#### Propagated to
- **ROADMAP.md** — added a deploy note (sibling project holds :8080; use `CADDY_HOST_PORT` /
  internal ports) and forward notes for F-05 (propose timeout; cap booleans var count).
- **ADR-005** — added a one-line clarification that the tactical menu resolves into the 4 wire
  Action variants (it is not a competing union).
- No new ADR needed (no decision was *reversed*; the `SessionId` tightening is a refinement
  within ADR-005/009, not a new architectural decision).

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

**Chunk 3 — `@polymath/contract`.** Modules: `phase.ts` (`PhaseName` enum), `component.ts`
(`ComponentSpec` 12-variant discriminated union + `Rep`/`Gate`/`Step` + `COMPONENT_KINDS`),
`action.ts` (`Action` 4-variant union + `noAction()` helper), `wire.ts` (`ClientEvent` 7
inbound kinds + `ServerMessage` 3 outbound kinds), `lessonConfig.ts` (`MasteryConfig`,
`ContentItem`, `LessonContent`). Barrel `index.ts`.
- **Decision — `Action` is the ADR-005 4-variant wire union, NOT the ADR-003 tactical menu.**
  ADR-003's `rephrase`/`simpler_item`/etc. are the agent's *internal* decision vocabulary;
  each resolves into a `mount`/`transition` wire Action. Documented inline so F-05 doesn't
  mistakenly add menu verbs to the wire union. Append-only change protocol noted in code.
- **Decision — `claimedTruthTable` is `(0|1)[]`** (ADR-010 Layer 2) on the three item-
  generating variants (`TruthTablePractice`, `CircuitBuilder`, `PseudocodeChallenge`),
  ordered MSB-first to match `@polymath/booleans` `truthTable().out`. The agent commits an
  answer; the server recomputes and compares (wired in F-05/agent validation).
- **Decision — `COMPONENT_KINDS` const array** mirrors the union and is cross-checked against
  the union members by a test; it's the source for the web renderer-switch exhaustiveness
  check (criterion / testing requirement) and the agent menu.
- **Decision — lesson-config schemas live in `@polymath/contract`** (not `lessons/`) so both
  the agent loader and any validator import one locked shape; lesson 2/3/4 reuse it.
- **Verification (criterion 5 prep):** `Action.parse({type:'mount', component:{kind:'bad'}})`
  throws — the recursive Zod validation that the agent's server-side guard relies on. Tests:
  16 passing; typecheck + build clean; test files excluded from `dist`.

**Chunk 4 — `@polymath/statechart`.** XState v5 `setup().createMachine()` `lesson_1` spine.
- **Decision — phase set is the 7 `PhaseName` contract values, 1:1 with state nodes.** A test
  cross-checks `Object.keys(machine.states)` against `PhaseName.options` from
  `@polymath/contract`, so spine/contract drift fails CI. (An earlier `satisfies
  Record<PhaseName,…>` annotation broke XState's guard-name inference — removed in favour of
  the runtime cross-check + exported `LESSON_PHASES`.)
- **Decision — guards named but constant.** `canDeclareMastery` returns `context.masteryReady`
  (false at F-01) and `canEndItem` returns `true`. These are the ADR-005 refusal #3 / #1 seams;
  F-09/F-12 fill the bodies. A test asserts `mastery_ok` is *refused* from `assessed` when the
  gate is unsatisfied (the refusal is real even though the predicate is a stub) and *allowed*
  when `masteryReady` is seeded true. `mastered` is a `final` state.
- **Decision — `LessonContext` is minimal** (`lessonId`, `masteryReady`); F-09 expands it with
  BKT params + behavioral signals. `masteryReady` is seedable via machine `input` for testing.
- **Tests:** 11 passing; typecheck + build clean.

**Chunk 5 — `lessons/1/`.** `mastery_config.json` = the full ADR-011 parameter set verbatim
(BKT 0.95 / Corbett-Anderson priors / 2–60s band / behavioral flags / transfer + explain-back
required). `content.json` = 3 stub items, one per L1 KC: `l1-and` (`A AND B`, `[0,0,0,1]`),
`l1-or` (`A OR B`, `[0,1,1,1]`), `l1-not` (`NOT A`, `[1,0]`).
- **Decision — config shape lives in `@polymath/contract`** (`MasteryConfig`/`LessonContent`),
  validated there; the JSON here is the lesson-1 *values*. Lessons 2/3/4 add sibling dirs with
  the same shape (directory-scoped ownership, no cross-feature edits).
- **Verification:** each item's hand-authored `truthTable` was checked against
  `@polymath/booleans` `truthTable().out` — all three match (`l1-and/or/not` OK). The
  permanent automated version of this check lands in chunk 6 (the agent loads lessons at boot,
  so the loader+validation test belongs with it).

**Chunk 6 — `apps/agent`.** Node + `ws` + `http` + Drizzle/`pg` + `@langchain/langgraph`.
Modules: `db/{schema,client,migrate}.ts`, `agent/{client,graph,stubClient,validateAction}.ts`,
`lessons/loader.ts`, `mastery/gate.ts`, `server.ts`, `index.ts`. Drizzle migration generated
into `apps/agent/drizzle/`.
- **Decision — dependency-injected `createServer({db, agent})`.** The HTTP+WS server takes its
  `Db` and `AgentClient` as injected deps so the integration test supplies a throwaway pg and
  the stub agent; `index.ts` wires the real ones (POSTGRES_URL, migrations on boot,
  `StubAgentClient`).
- **Decision — `AgentClient` provider seam + real LangGraph `StateGraph`.** F-01 stands up a
  genuine compiled graph (`__start__ → propose → __end__`) whose single node emits
  `no_action` — no LLM call. F-05 expands the graph and swaps `StubAgentClient` for an
  LLM-backed client without touching the server. De-risks the framework bootstrap early.
- **Decision — server-side Action validation is the final gate (criterion 5).**
  `validateOutboundAction()` runs `Action.safeParse` on every proposal before send; a malformed
  action is **downgraded to `no_action`**, never sent. Unit tests feed it a malformed `mount`
  and a non-action object and assert the downgrade — this is the "mutate the stub to emit
  malformed output" check from criterion 5, made permanent.
- **Decision — `events.payload` stores `{event, action}`** as JSONB — the structured
  per-turn record ADR-005 calls for (the replay artifact's basis). `GET /…/replay` returns
  the session's events; richer replay shape lands with the agent loop.
- **Decision — `loadLesson()` cross-checks content truth tables against the validator at load
  time** (throws on mismatch) — the permanent version of chunk 5's check (ADR-010: the
  validator is the source of truth, content answer keys must agree).
- **Decision — `mastery/gate.ts` exposes the locked `isMastered(LearnerState, MasteryConfig)`
  signature returning `false`** (ADR-011); F-09/F-12 fill the body.
- **Verification (criteria 2,3,4,5):** integration test boots **real Postgres in Docker**,
  migrates, starts the server, then asserts `GET /api/health` → `{status:"ok"}`,
  `POST /api/session` writes a `sessions` row, and a WS `submit` round-trips a schema-valid
  `no_action` with an `events` row written. **11 agent tests pass** (3 unit + 3 loader + 3
  integration… actually 5 agent-unit + 3 loader + 3 integration = 11); typecheck + build clean;
  test pg container torn down. `LangGraph checkpointer` schema deferred (stub graph doesn't
  checkpoint).

**Chunk 7 — `apps/web`.** Vite + React 19 + React Router + XState (`@xstate/react`).
Modules: `ws/client.ts` (typed `AgentSocket`, Zod-validates inbound, capped-backoff reconnect),
`motion/AnimateOrNot.tsx`, `components/{registry,LessonIntro}.tsx`, `lessonIntroContent.ts`,
`App.tsx`, `main.tsx`.
- **Decision — exhaustive renderer switch with a `never` default.** `renderComponent` switches
  on `ComponentSpec.kind`; the `default` assigns `spec` to `const _: never`, so adding a union
  variant without a case is a *compile error* — the testing-requirement exhaustiveness guarantee
  (no dynamic lookup / `eval` / `dangerouslySetInnerHTML`). Only `LessonIntro` renders for real;
  the other 11 render a typed `Tbd` placeholder.
- **Decision — `<AnimateOrNot>` gates motion centrally** on `(phase === 'transferring')` and
  `prefers-reduced-motion` (ADR-004/008); the animation primitives plug in later. `shouldAnimate`
  is pure + unit-tested.
- **Decision — single-origin via vite proxy.** Dev proxies `/api` + `/agent` to the agent
  (origin overridable via `AGENT_ORIGIN` env for local testing); prod is same-origin behind
  Caddy. The client derives `ws`/`wss` from `location`.
- **Decision — LessonIntro copy authored in the three-representation pedagogical voice**
  (`lessonIntroContent.ts`) per ADR-001 (no exact copy was locked in the ADRs).
- **Verification — real running system (Step 5.4 gate):** booted Postgres + the agent (on
  :8090, since a sibling `uvicorn` service already held :8080 — noted for infra) and the vite
  dev server; navigated a real Chrome via DevTools MCP. The `LessonIntro` card rendered, the WS
  showed "Agent: open", clicking **Submit** produced "Agent responded: `no_action`" in the UI,
  and Postgres recorded the `submit` event (`events.kind='submit'`, `payload.action.type=
  'no_action'`). Only console error was the browser's default `/favicon.ico` 404 (harmless).
  Build: `dist/` produced, bundle **121 KB gzipped** (< the 500 KB ADR-008 budget). 5 web tests
  pass; typecheck clean.
- **Note for infra (chunk 8):** the droplet/dev port 8080 may already be taken by a sibling
  project; the compose/Caddy wiring uses an internal agent port and Caddy routing, so this is a
  local-dev concern only, but worth flagging.

**Chunk 8 — `infra`.** `apps/agent/Dockerfile` + `apps/web/Dockerfile` (multi-stage, build
context = repo root), `docker-compose.yml` (postgres + agent + web + caddy, all healthchecked),
`infra/caddy/polymath.caddyfile`, `infra/{deploy,smoke}.sh`, `.github/workflows/ci.yml`,
`.dockerignore`.
- **Decision — Caddy is the single compose entrypoint; web is nginx-static, agent is
  internal.** Caddy routes `/api/*` + `/agent` → agent:8080 and everything else → web:80; it
  upgrades `/agent` to WebSocket automatically (criterion 10). On the droplet the shared host
  Caddy fronts this service (the file is hostname-agnostic `:80`, documented as the droplet
  template). Postgres is `expose`-only (not host-published) per ADR-009.
- **Decision — agent runs under `tsx` in-container** (packages export TS source); compiling to
  JS is a later optimisation, not needed for the skeleton. Migrations run on boot.
- **Bug found + fixed during verification:** the web Docker build initially failed with
  `TS18028` (private identifiers / ES3 target) because the Dockerfiles didn't copy the root
  `tsconfig.base.json`, so `extends: "../../tsconfig.base.json"` silently fell back to tsc
  defaults. Fixed by copying `tsconfig.base.json` into both images.
- **Decision — `CADDY_HOST_PORT` is parameterized** (`${CADDY_HOST_PORT:-8080}`) so the stack
  can avoid the sibling-project 8080 collision (the `uvicorn` service found in chunk 7) without
  editing the file.
- **Verification (criteria 1,2,3,4,10 via the full Caddy stack):** `docker compose up --wait`
  brought **all four services healthy**; `caddy validate` → "Valid configuration"; and
  `infra/smoke.sh http://localhost:8081` passed all four checks through Caddy — `GET /` (SPA),
  `GET /api/health` → `{status:ok}`, `POST /api/session` (row created), and a **WS `submit`
  round-trip through Caddy's WebSocket upgrade → agent → `no_action`**. Stack + volumes torn
  down clean afterward.
- **`.github/workflows/ci.yml`** runs `pnpm -r typecheck`, `pnpm -r test` (incl. the
  Docker-Postgres integration test), and `pnpm build` on PR/main (criterion 8).
- **Deferred (per the agreed scope):** `infra/deploy.sh` is authored but **not run** — the live
  deploy (DNS A-record, `/opt/polymath/.env` secrets, dropping the Caddyfile into the host's
  `/etc/caddy/conf.d/`, the GitHub Actions deploy-on-green-main against the droplet) is the
  documented manual follow-up. Acceptance criteria 1–4 + 10 are proven against the **local**
  Caddy stack; criteria 9 (live `make deploy`) + the *live* URLs of 1–4/10 await that step.
