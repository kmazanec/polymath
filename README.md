<div align="center">

# Polymath

**A multimodal, hyperresponsive mastery interface for Boolean logic.**

*You haven't mastered an idea until you're fluent in it three different ways.*

[Live demo](https://polymath.biograph.dev) · [Architecture](docs/ARCHITECTURE.md) · [Brand system](docs/BRAND.md) · [Roadmap](docs/ROADMAP.md)

</div>

---

## The thesis

Most "mastery" signals are easy to fake. A learner can pattern-match a worked
example, paste an LLM's answer, or get lucky on a multiple-choice item and look
mastered without understanding anything. Polymath is built around a stricter
definition:

> A learner has **mastered** a concept only when they are fluent across three
> *irreducibly different* representations of it — **truth tables**, **logic-gate
> circuits**, and **pseudocode** — and that fluency is gated so strictly that a
> "mastered" learner *cannot* have been pattern-matching.

The gate is deliberately hard to clear. To be declared mastered, a learner must
satisfy **all** of:

- **BKT ≥ 0.95** — a Bayesian Knowledge Tracing posterior that they know the skill,
- **consecutive correct** answers with **no hints used**,
- a **response-time band** (too-fast = guessing, too-slow = struggling),
- a **held-out transfer item** — same deep structure, new surface, no scaffolding,
- a **voice explain-back** — say it back in your own words; deterministic
  preconditions (duration, vocabulary, item-specific reference) run first, then an
  LLM judges the content.

A satisfied *sub*-condition is never mastery. The gate **fails closed**: a missing
input blocks, never passes.

## Why three representations

The same Boolean idea looks completely different as a table, a circuit, and a line
of code — and *recognising it in all three* is what conceptual understanding
actually is. So the learner meets each operator (AND, OR, NOT, then NAND, NOR,
De Morgan's laws) in all three forms at once, and a transfer probe can **hide** one
representation to check they can work without the crutch.

| Truth table | Logic circuit | Pseudocode |
|---|---|---|
| Toggle the output column; the only place "true" turns green. | Wire real ANSI gate shapes; press **Pulse** and the signal flows gate-by-gate. | A friendly editor; correctness shows as a gentle inline check. |

## The architecture *is* the pedagogy

The interesting engineering claim of Polymath is **how** the adaptive UI stays
honest. Three ideas do the heavy lifting:

1. **High-frequency interaction never touches the network.** Toggling a truth-table
   cell, dragging a gate, running the pulse, and the immediate correctness verdict
   all happen in the browser (a <5ms compare via `@polymath/booleans`). The learner
   sees their answer marked correct *before* the agent decides what to do next. That
   separation is what makes the UI feel alive.

2. **The LLM is on the critical path only at phase boundaries** (~5–10 calls per
   lesson). It never invents UI. It picks a `kind` from a typed, finite component
   registry and fills slots; an **XState statechart** owns *when* the UI may change.
   "Generative UI" in the freeform-JSX sense is an explicit non-goal — every legal
   UI state is something a human designed, every transition is auditable.

3. **The server never trusts the agent — or the client.** Every proposed action is
   re-validated against a locked schema before it crosses the wire; every
   integrity signal (correctness, hint count, the rule gate) is recomputed
   server-side from the event log, never read from a client flag. A privileged
   action the learner hasn't *earned* is refused.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full data-flow and the
[ADRs](docs/adrs/) for every consequential decision *with its why*.

## Monorepo layout

pnpm workspace, Node ≥ 22, ESM-only, TypeScript project references (strict).

| Package | What it is |
|---|---|
| [`packages/contract`](packages/contract) | `@polymath/contract` — Zod schemas + types for **every** cross-cutting contract: the component registry, the agent's wire `Action`, the WebSocket protocol, lesson config. The most load-bearing package. |
| [`packages/booleans`](packages/booleans) | `@polymath/booleans` — the single source of truth for Boolean correctness (`parse / evaluate / variables / truthTable / equivalent`). Pure, no deps, 100% coverage, locked signatures. |
| [`packages/statechart`](packages/statechart) | `@polymath/statechart` — the XState v5 lesson spine. Owns *when* the UI may change. The phase shape is locked. |
| [`packages/bkt`](packages/bkt) | `@polymath/bkt` — the Bayesian Knowledge Tracing model behind the mastery posterior. |
| [`packages/graph`](packages/graph) | `@polymath/graph` — LangGraph subgraphs for content evaluation: the explain-back rubric (5 deterministic preconditions, then an LLM judge) and the session-summary pipeline. Everything fails closed. |
| [`apps/agent`](apps/agent) | `@polymath/agent` — Node HTTP + WebSocket service; LangGraph inner agent, Drizzle/Postgres persistence, the server-side validation + earned-it gates. |
| [`apps/web`](apps/web) | `@polymath/web` — Vite + React 19 SPA. Renders the component registry via one exhaustive switch (no dynamic lookup, no `eval`, no `dangerouslySetInnerHTML`). |
| [`lessons/`](lessons) | `content.json` + `mastery_config.json` per lesson, validated against the contract at load time. |

## Quick start

Prerequisites: **Node ≥ 22**, **pnpm ≥ 11** (via corepack), Docker for the full stack.

```bash
pnpm install                  # install workspace deps

# Run the full stack (Postgres + agent + web + Caddy on one port):
cp .env.example .env          # fill secrets as features need them
docker compose up --build     # → http://localhost:8080

# Or dev servers without Docker:
pnpm --filter @polymath/web dev     # Vite dev server  (:5173)
pnpm --filter @polymath/agent dev   # agent (needs a reachable POSTGRES_URL)
```

### Develop & verify

```bash
pnpm test                     # all unit/integration suites (vitest)
pnpm typecheck                # tsc --noEmit across every package
pnpm build                    # build packages/** then apps/** (order matters)

# A single package:
pnpm --filter @polymath/booleans test
pnpm --filter @polymath/web test
```

> **Note on the test suite.** A whole-workspace `pnpm test` shares one Postgres
> container across parallel runners, which can produce *non-deterministic* false
> failures in the DB-backed agent suites. The authoritative signal is the **isolated**
> run: `pnpm --filter @polymath/agent test` (serial, owns the DB) plus the non-agent
> projects separately. A flaky full run is not a regression. See
> [`CLAUDE.md`](CLAUDE.md) for the details.

## Design & brand

Polymath is a **standalone** tool, but it's built to feel like it belongs in a
modern learning-product family: a light, airy, indigo-grounded surface where a
single signal-green means *true / correct* across all three representations, real
ANSI gate shapes carry the circuit, and motion is a budget, not a style. The full,
buildable design system — tokens, typography, the three-modality visual language,
and the accessibility contract (WCAG 2.1 AA, deuteranopia-safe, reduced-motion) —
lives in [`docs/BRAND.md`](docs/BRAND.md), with prototypes under
[`docs/design-prototypes/`](docs/design-prototypes).

## Deploy

A single DigitalOcean droplet behind a shared Caddy, live at
**https://polymath.biograph.dev**. CI runs typecheck + tests + build on merge
requests; a push to `main` deploys via `infra/deploy.sh` (release-symlink, atomic
swap, health-check with rollback, migrations on agent boot).

## Documentation map

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — executive summary, data-flow, decision index.
- [`docs/adrs/`](docs/adrs) — every consequential decision, immutable once accepted.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — 7 iterations, 26 vertical-slice features, the iteration DAG.
- [`docs/features/`](docs/features) — per-feature specs (`F-NN` ↔ `docs/features/NN-*.md`).
- [`docs/BRAND.md`](docs/BRAND.md) — the visual system.
- [`CLAUDE.md`](CLAUDE.md) — the load-bearing invariants and contributor guardrails.
