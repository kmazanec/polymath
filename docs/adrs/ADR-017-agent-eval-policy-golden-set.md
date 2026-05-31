# ADR-017: The agent has a deterministic golden set that always runs offline (100%-gating on every MR) plus labeled scenario banks judged live on protected main

**Status:** Accepted · **Date:** 2026-05-31 · **Stretch:** no
**Supersedes:** none · **Refines:** [ADR-006](./ADR-006-voice-and-agent-llm-stack.md), [ADR-010](./ADR-010-content-correctness-and-validation.md), [ADR-011](./ADR-011-evaluation-and-mastery-instrumentation.md) · **Related:** [ADR-014](./ADR-014-validator-gated-generative-agent.md), [ADR-016](./ADR-016-spoken-turns-and-tablet-touch.md) · **Superseded by:** none
**Contract:** yes — the eval fixture format + the golden-set/live-gate split + the agreement thresholds are a cross-cutting contract every agent-behavior feature contributes to.

## Context

Agent evals already exist but were never formalized as a *policy*: there is an inner-agent scenario bank (`apps/agent/src/agent/eval/scenarios.json`, run by `eval.test.ts`) and an explain-back fixture bank (`evals/explain_back/fixtures.json`), each with the same de-facto pattern — a deterministic/offline half that gates MRs (no key) and an LLM-judged live half that runs key-gated on protected `main` at an agreement threshold. The I7 re-architecture adds **new agent failure surfaces** that must be evaluated, not just unit-tested:

- The agent now **generates** challenge content ([ADR-014](./ADR-014-validator-gated-generative-agent.md)) — a generated item can be out-of-rails, wrong-keyed, over the var-cap, or prompt-less.
- The agent now **answers spoken turns** as the front-line tutor ([ADR-016](./ADR-016-spoken-turns-and-tablet-touch.md)) — an answer can be off-topic or ungrounded.
- The agent has **broad creative latitude** — more freedom means more ways to make a *legal-but-bad* move, which only a behavior eval (not a type check) catches.

The product owner's requirement: **a golden set we always run, at minimum, plus additional labeled scenarios beyond that.** This ADR makes the existing de-facto pattern an explicit, named contract and extends it to the I7 surfaces.

## Decision

### 1. A named GOLDEN SET that always runs, decided deterministically, gating every MR at 100%

The **golden set** is the canonical bank of labeled agent scenarios whose correct outcome is decided **deterministically** — no LLM in the loop — so it runs on **every MR with no API key** and **must pass 100%**. What makes a golden case deterministic:

- **Tactical-move choice** judged against the **keyless `HeuristicMoveProvider`** (the existing offline gate): given an event + server-derived learner state, the agent picks the expected move (or one of an allowed set).
- **Generated-challenge validity** judged against **`@polymath/booleans`** + the rails: a labeled generated item is `valid` or `reject_for_<reason>` (out-of-alphabet / over-var-cap / unparseable / **prompt-less** / wrong-keyed), checked by the same validator the runtime gate uses.
- **Prompt-on-every-challenge:** a pure schema assertion — every item-bearing spec carries a grounding prompt.
- **Topic classification** of a learner question/utterance: on/off-topic against the deterministic classifier.

The golden set is the floor. It is fast, key-free, and **non-negotiable** — a red golden set blocks the MR.

### 2. Labeled scenario banks BEYOND the golden set, judged LIVE on protected main at an agreement threshold

Above the floor, **labeled scenario banks** capture quality that only an LLM judge (or the live LLM provider) can assess. These run **key-gated, auto on protected `main`, never on MRs** (CLAUDE.md secret-isolation), each passing at a stated **agreement threshold** against hand labels:

- **Live agent-provider agreement** — the `OpenAIMoveProvider`'s move choice agrees with the labeled scenarios at **≥95%** (the existing inner-agent live bar).
- **Explain-back judge agreement** — unchanged at **≥90%** (ADR-011 / `explainBackJudgeAgreementThreshold`).
- **Spoken-turn answer groundedness** — the tutor's answer to a labeled learner utterance is on-topic and grounded in the current item, judged at **≥90%**.
- **Generation quality** — generated challenges are in-rails and well-targeted to the learner state at **≥95%** (validity itself is golden/offline; *quality/appropriateness* is the live bar).

The four labeled emphases the banks must cover (product-owner direction): **adversarial / anti-gaming** (forged-correct submits, guess streaks, hint-then-claim-ready, forged/early probe, off-topic spoken turns), **generation quality & safety**, **spoken-turn tutoring**, and **pedagogical soundness** (the agent makes the right *teaching* move for a state, not merely a legal one).

### 3. One harness, one format, one ownership

All banks share the established **JSON-fixture + vitest-runner** shape (`{ id, …input…, expect… }`), the **offline-gate / live-gate** split, and thresholds in config where per-lesson tuning helps (the explain-back pattern). A single I7 feature owns the harness, the named golden set, the CI wiring, and the thresholds; each behavior feature contributes its labeled scenarios to it.

## Options considered

**Golden-set gate — A: deterministic, 100% offline (chosen).** Always-green floor on every MR, no secrets, fast feedback. **B: golden set includes live-LLM cases.** Richer per run, but can't gate MRs (no MR secrets) so "always run" degrades to "runs on main." *Rejected* — the floor must be the fast, key-free, MR-blocking gate; LLM quality is the *additional* live layer, not the floor.

**Ownership — C: one eval feature owns the harness; features contribute banks (chosen).** Single owner of "the golden set always runs," one harness + threshold policy. **D: evals folded per-feature, no owner.** *Rejected* — scatters the harness and lets "always run" erode silently.

## Consequences for the build

- **Source of truth:** the golden-set harness + named set + CI policy live in the agent eval tree (`apps/agent/src/agent/eval/` + `evals/`), owned by the I7 eval feature (F-32). F-29 contributes generation-validity/quality scenarios; F-30 contributes spoken-turn scenarios; the existing inner-agent + explain-back banks fold in as-is.
- **CI:** the deterministic golden set runs in the existing offline `verify`/`agent_test` jobs (100%-gating, no key). The live banks run in the existing key-gated, protected-main-only jobs (`explain_back_live_eval` / a sibling), never on MRs.
- **Invariants honored:** no provider secret in MR pipelines (CLAUDE.md); the live eval is the only place a key is exposed and only on trusted code. The golden set's validity checks reuse the **same** `@polymath/booleans` var-capped validator the runtime gate uses (no second source of truth for correctness).
- **Definition of done extends:** a new agent-behavior feature is not done until its golden-set cases are added (offline) and, where quality is LLM-judged, its labeled bank + live threshold are wired.

## Status note

Accepted as the basis for the I7 eval feature (F-32, ROADMAP I7). Extends the existing inner-agent + explain-back eval banks rather than replacing them.
