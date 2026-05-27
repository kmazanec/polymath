# ADR-009: WebSocket + thin REST API; Postgres in a Docker container with Drizzle ORM; deploy to the existing DigitalOcean droplet behind Caddy at `polymath.biograph.dev`; LiveKit Cloud for realtime

**Status:** Accepted · **Date:** 2026-05-27 · **Stretch:** no
**Supersedes:** none · **Superseded by:** none

## Context

The Nerdy challenge portal lists AWS and GCP under "cloud platforms" alongside other tech stack items (React, Docker, Node.js, etc.); the submission requirement is a working prototype, not a specific cloud provider. The portal also lists **Docker** as a required dev tool.

Keith maintains an existing **DigitalOcean droplet (`gauntlet`, biograph.dev)** that already hosts several Gauntlet projects behind a shared Caddy reverse proxy with automatic subdomain routing (per the workspace CLAUDE.md). The droplet runs Docker as the standard runtime and uses Postgres in containerised form for other projects.

Earlier ADRs lock in:
- Vite-built static frontend ([ADR-008](./ADR-008-frontend-and-client-architecture.md))
- Node + LangGraph agent service ([ADR-007](./ADR-007-orchestration-division-of-labor.md))
- OpenAI Realtime via LiveKit Agents for voice ([ADR-006](./ADR-006-voice-and-agent-llm-stack.md))
- WebSocket streaming of typed `Action` objects between agent and web app ([ADR-005](./ADR-005-adaptive-ui-runtime-contract.md))

This ADR locks the API surface, persistence, and hosting.

## Options considered

### API shape

**A — WebSocket for the agent stream + thin REST for session bootstrap (chosen).** WebSocket is the right tool for streaming Actions; REST handles `POST /api/session` (mint a session ID and a LiveKit ephemeral token), `GET /api/session/:id/replay` (eval-tool replay endpoint), and `GET /api/health` (liveness for Caddy).

**B — tRPC for everything.** End-to-end type safety; mostly duplicates the Zod schemas in `packages/contract` that already make the WebSocket message types fully typed.

**C — WebSocket only, no REST.** Session bootstrap moves into the initial WebSocket handshake. Slightly less standard; harder to instrument with conventional HTTP middleware.

### Persistence

**D — Postgres in a Docker container, volume-mounted, with Drizzle ORM (chosen).** Production-shape from day one. LangGraph supports a native Postgres checkpointer. Matches Keith's existing infra pattern (other projects on the droplet use the same shape).

**E — SQLite (file-backed) for MVP, migration to Postgres documented.** Lighter; the SQLite approach was the original recommendation. Superseded by the droplet-with-Postgres reality.

**F — Postgres on the host (non-containerised).** Slightly faster I/O; breaks the docker-everywhere convention; harder to back up consistently.

**G — Turso (SQLite-as-a-service).** Edge-distributed SQLite; adds a 4th-party dependency; defensible at production scale, unnecessary at prototype scale.

### Frontend hosting

**H — Same DigitalOcean droplet via Caddy at `polymath.biograph.dev` (chosen).** Drops into existing infra pattern. SSL via Caddy. One deploy target. Slightly slower global TTFB (single US region) but acceptable for a US-based evaluation audience.

**I — Cloudflare Pages with CNAME to `polymath.biograph.dev`.** Free global CDN, faster TTFB; splits deployment across two providers; adds CI complexity.

**J — Vercel.** Fastest CI/CD; preview deploys per branch; adds a third deploy target; doesn't match existing infra pattern.

### Agent service hosting

**K — Docker container on the same droplet (chosen).** Co-located with the Postgres container; one `docker-compose.yml` orchestrates web + agent + db; Caddy reverse-proxies `wss://polymath.biograph.dev/agent` to the agent container's WebSocket port.

**L — Separate VPS or cloud service.** Splits the deploy; adds latency between agent and DB.

**M — AWS App Runner or Fargate.** Cloud-managed container hosting; off-pattern for Keith's existing infra; defensible if the prototype graduates to production.

### Realtime infrastructure

**N — LiveKit Cloud (chosen).** Hosted WebRTC SFU + TURN/STUN; free tier covers prototype scale (~10,000 minutes/month); zero ops; LiveKit Agents integrates natively.

**O — Self-hosted LiveKit on the droplet.** All-in-one; defensible. TURN/STUN configuration is non-trivial; the SFU consumes droplet resources shared across other Gauntlet projects.

## Decision

### API surface

- **WebSocket** at `wss://polymath.biograph.dev/agent` carries the bidirectional message stream between the web app and the agent service. Message types are typed via the `Action` Zod schema in `packages/contract` ([ADR-005](./ADR-005-adaptive-ui-runtime-contract.md)).
- **REST** endpoints on the agent service:
  - `POST /api/session` — mint a session ID, create a session row in Postgres, mint a LiveKit ephemeral token, return both to the client.
  - `GET /api/session/:id/replay` — return the full per-session event log for the eval/replay tool.
  - `GET /api/health` — liveness probe for Caddy.
- **Authentication** is intentionally minimal for the prototype: session IDs are opaque random tokens, validated server-side; no user accounts. The privacy posture (see [Round 8 — stretch features]) documents this explicitly.

### Persistence

- **Postgres 16** in its own Docker container, named volume `polymath-pg-data` mounted to `/var/lib/postgresql/data`. Backed up daily to a sibling volume via a small cron container.
- **Drizzle ORM** for application data access. Migrations checked into `apps/agent/drizzle/migrations/` and run on container startup.
- **LangGraph's Postgres checkpointer** uses the same Postgres instance, in a separate schema (`langgraph_checkpoints`).
- **Data persisted:**
  - `sessions` — one row per learner session (ID, started_at, ended_at, lesson_progress)
  - `events` — every learner action + agent decision (timestamp, kind, payload JSONB, session_id FK)
  - `learner_state` — per-session BKT params per KC, mastery state, behavioral signal aggregates
  - `transfer_bank` — hand-authored transfer items (held-out from generators)
  - `eval_scenarios` — labelled cases for LangSmith eval runs
  - `langgraph_checkpoints.*` — LangGraph's tables (managed by their migrations)

### Hosting

- **Frontend:** Vite static build deployed to the droplet at `/opt/polymath/web/dist/`, served by the existing Caddy reverse proxy on `polymath.biograph.dev`. Cache-Control headers for assets with content hashes; HTML uncached.
- **Agent service:** Docker container on the droplet, exposes port 8080 internally, Caddy reverse-proxies `polymath.biograph.dev/api/*` and `wss://polymath.biograph.dev/agent` to it.
- **Postgres:** Docker container on the droplet, exposes port 5432 only on the Docker network (not on the host).
- **Caddy configuration:** A new `polymath.caddyfile` dropped into `/etc/caddy/conf.d/` on the droplet, following the existing pattern for sibling projects.
- **deployment via `docker compose` push-to-deploy** from a `Makefile` target: `make deploy` builds containers, runs migrations, restarts services with zero-downtime via Caddy's request-buffering.

### Realtime infrastructure

- **LiveKit Cloud** for WebRTC SFU and TURN/STUN. The agent service mints ephemeral session tokens server-side; browsers connect directly to LiveKit Cloud.
- The agent service runs the LiveKit Agents bridge (Node integration), which proxies between OpenAI Realtime and the LiveKit room.

## Rationale

### Why droplet over AWS

The portal lists AWS and GCP under cloud platforms, but the submission criterion is a working prototype, not the specific cloud. The honest defense:

> "We deployed to the existing DigitalOcean droplet that already hosts several production projects, behind a shared Caddy reverse proxy. The architecture (Docker + Postgres + Node + Caddy SSL) is structurally identical to what would run on AWS Fargate + RDS + CloudFront; the migration path is one `docker-compose.yml` translation away. Choosing the droplet bought us a working SSL'd production URL on day one and lets the prototype be reviewed live, which we judged a higher-value signal than 'we ran it on the listed cloud.'"

For Nerdy specifically, that framing lands because:
- They're operationally lean (Q1 2026: 20% headcount reduction; "AI-Native" engineering org valuing builders who ship fast — per COMPANY.md). A "we shipped on what we already had" answer is more on-brand than "we spun up new AWS infra for a 4-week prototype."
- Dalmia (VP Eng) will recognise the docker-compose-on-VPS pattern as the appropriate scale-for-purpose choice. He'll respect that we *can* describe the AWS equivalent rather than claiming the droplet is the right answer at scale.

### Why Postgres in a container, not SQLite

Two reasons:
1. **It matches Keith's existing droplet infra pattern.** The other projects in `/Users/keith/dev/gauntlet/` already use Postgres in containers; reusing the pattern is lower-friction than introducing SQLite-as-an-exception.
2. **Production-shape from day one** simplifies the migration story. We don't have to defend "we used SQLite in prototype but would use Postgres in production" — we used Postgres in both.

The LangGraph Postgres checkpointer is mature; the small overhead of a Postgres container vs. SQLite is negligible.

### Why WebSocket + thin REST, not tRPC

The Action schema in `packages/contract` already provides end-to-end type safety: it's a Zod schema imported by both `apps/web` and `apps/agent`. tRPC would re-implement what we already have using a different mechanism, adding a dependency and a build step for marginal gain.

The streaming nature of the agent emission is fundamentally WebSocket-shaped; wrapping it in tRPC subscriptions works but loses the directness.

### Why LiveKit Cloud, not self-hosted

Self-hosting LiveKit adds TURN/STUN configuration, SFU operation, and ongoing resource competition with the other Gauntlet projects sharing the droplet. LiveKit Cloud's free tier (~10,000 minutes/month) covers prototype scale comfortably; the 4-week budget is better spent elsewhere.

The integration code is identical between self-hosted and cloud; a future migration is config-only.

### Defensibility for Nerdy

- **Cohn (CEO)** — won't engage at this level; this ADR is downstream of his concerns.
- **Dalmia (VP Eng)** — will recognise the docker-compose-on-VPS pattern as scale-for-purpose engineering; will appreciate the explicit migration story for AWS; will respect that we picked Postgres-from-day-one rather than carrying SQLite migration debt.
- **Hunigan (VP AI)** — will care that LiveKit Cloud is the production-grade WebRTC choice; will recognise we didn't roll our own.

The phrase to defend it: *"Right-sized infrastructure: containerised stack that ports trivially to AWS Fargate + RDS + CloudFront, deployed to existing production infrastructure for fastest learn-and-ship cycle."*

## Tradeoffs & risks

- **Single droplet is a single point of failure.** Mitigation: this is a prototype; the demo URL is live for the evaluation window; if the droplet goes down during eval, a small inconvenience but not a blocker. The migration path to AWS is documented.

- **Sharing the droplet with other Gauntlet projects** means resource contention. Mitigation: the agent service is mostly I/O-bound; Postgres footprint is small (a few hundred MB); LiveKit is hosted externally. Resource budget on the droplet is enough.

- **Caddy configuration as a separate `.caddyfile` for this project** could conflict with existing sibling projects. Mitigation: follow the existing pattern (per CLAUDE.md, sibling projects add their own `*.caddyfile` to `/etc/caddy/conf.d/`); name it `polymath.caddyfile`.

- **No automated rollback on failed deploy.** Mitigation: `docker compose` with health-check gates and `--wait`; if a new container fails health check, the old one stays up. Manual rollback is `make rollback` (reverts to previous compose-file tag).

- **LiveKit Cloud bills if we exceed the free tier.** Mitigation: ~10,000 minutes/month is more than enough for prototype eval; cap session length at the application layer (30-minute auto-terminate) as a defense.

- **No backup off the droplet** in MVP. Mitigation: daily volume snapshot via DigitalOcean's snapshot feature (existing infra); document the restore path in operations notes.

- **Cross-origin / CORS** between `polymath.biograph.dev` (frontend) and `polymath.biograph.dev/api` (backend) — same origin, no CORS needed. Caddy handles routing.

- **WebSocket connection lifecycle** through Caddy's reverse proxy needs explicit configuration. Mitigation: Caddy supports WebSocket upgrade natively; just need to allow the `/agent` path to upgrade.

## Consequences for the build

- **`docker-compose.yml`** at the repo root orchestrates `web` (or its static-asset volume), `agent`, `postgres`. Healthchecks on each service.
- **`apps/agent/Dockerfile`** — multi-stage Node + LangGraph build. ~150MB image.
- **`apps/web` builds to `dist/`** — a small `web` container (nginx or just a volume) serves the static assets, or a directory volume mounted into Caddy serves them directly.
- **`packages/db`** — Drizzle ORM schema, migrations, query helpers. Imported by `apps/agent`.
- **Caddy config snippet** — `polymath.caddyfile` in `infra/caddy/`, copied to droplet at deploy.
- **Deploy script** — `infra/deploy.sh` rsyncs the build to the droplet, runs `docker compose pull && docker compose up -d` over SSH, verifies the health endpoint.
- **Environment variables**: `OPENAI_API_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `POSTGRES_URL`, `LANGCHAIN_API_KEY` (for LangSmith), `POSTHOG_KEY`. All managed via a `.env` on the droplet, not checked into git.
- **CI**: GitHub Actions builds the agent Docker image, builds the Vite static bundle, runs LangSmith evals against a snapshot of the agent code, deploys on green main.
- **The repo structure aligns with the existing workspace pattern**: this project's root is `/Users/keith/dev/gauntlet/nerdy/polymath/`.
- **The Limitations memo documents the AWS migration path** at one-paragraph fidelity: "S3 + CloudFront for the static frontend; ECS Fargate or App Runner for the agent service; RDS Postgres replacing the Postgres container; LiveKit Cloud unchanged."
