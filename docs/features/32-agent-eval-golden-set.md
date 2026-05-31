# Feature: Agent eval — golden set + labeled scenario banks

**ID:** F-32 · **Iteration:** I7 · **Status:** Not started

## What this delivers (before → after)
**Before:** Agent evals exist but ad-hoc (an inner-agent scenario bank + an explain-back bank), with no named "golden set we always run" and no coverage of the new I7 surfaces (generation, spoken turns, prompt-on-every-challenge).
**After:** There is a named **golden set** of deterministic agent scenarios that runs on every MR with no API key and must pass 100%, plus **labeled scenario banks** (adversarial/anti-gaming, generation quality & safety, spoken-turn tutoring, pedagogical soundness) judged live on protected main at stated agreement thresholds — one harness, one format, one owner.

## How it fits the roadmap
I7 feature realizing [ADR-017](../adrs/ADR-017-agent-eval-policy-golden-set.md). It owns the golden-set harness, the named always-run set, the CI policy, and the thresholds; F-29 and F-30 contribute their labeled scenarios to it as part of their own acceptance. It folds in the existing inner-agent + explain-back banks unchanged.

## Requirements traced (from the PRD)
The brief's false-positive-mastery / anti-gaming defense (the agent must not be trickable) and content-correctness (generated content validated); ADR-011's evaluation instrumentation; the product-owner requirement: a golden set always run + additional labeled scenarios.

## Dependencies (must exist before this starts)
- Soft: F-29 (generation) and F-30 (spoken turns) produce the behaviors the new banks label — F-32's harness can land first (folding in the existing banks), and the F-29/F-30 scenarios are added as those features land. Not a hard consume-unshipped-behavior dependency: the harness + golden-set policy + existing-bank fold-in build independently.

## Unblocks (what waits on this)
- Nothing blocks on it, but it is the **gate** F-29/F-30 are "done" against (their golden cases must be green; their live banks wired).

## Contracts touched
- **Agent eval contract** (source of truth: **ADR-017**) — the JSON fixture format, the golden-set/live-gate split, and the agreement thresholds. Introduced/owned here; F-29, F-30 (and the existing F-05/F-11 banks) contribute.
- **`@polymath/booleans` validator** (source of truth: ADR-005/010) — the golden-set generation-validity checks **reuse** the same var-capped validator the runtime gate uses (no second correctness source).
- CI policy (source of truth: ADR-006 secret-isolation + this ADR) — offline golden set in `verify`/`agent_test`; live banks key-gated on protected main only.

## Acceptance criteria (product behavior)
1. A named **golden set** of labeled agent scenarios runs in offline CI (no API key) and **must pass 100%** to merge — covering: tactical-move choice (vs. the keyless heuristic), generated-challenge validity (in-rails / wrong-keyed / over-var-cap / unparseable / **prompt-less** → reject), prompt-presence (schema), and topic classification.
2. **Labeled scenario banks** beyond the golden set are judged **live on protected `main`, never on MRs**, each at its stated threshold: live agent-provider move agreement **≥95%**, explain-back judge **≥90%** (unchanged), spoken-turn answer groundedness **≥90%**, generation appropriateness **≥95%**.
3. The banks cover all four emphases: **adversarial/anti-gaming** (forged-correct submit, guess streak, hint-then-claim-ready, forged/early transfer probe, off-topic spoken turn — none produce a false-positive advance/mastery), **generation quality & safety**, **spoken-turn tutoring**, **pedagogical soundness** (right teaching move for the state).
4. The existing inner-agent (`scenarios.json`) and explain-back (`fixtures.json`) banks fold in unchanged and keep passing at their current gates.
5. No provider secret is exposed to an MR pipeline; the live banks self-skip without a key and run only on trusted/protected code.
6. A documented way to add a new golden case + a new labeled scenario in the same format (so future agent behavior is gated the same way).

## Testing requirements
- The eval suites ARE the tests: vitest-based, JSON-fixture-driven, mirroring the established `eval.test.ts` pattern (offline 100%-agreement assertion + a key-gated `liveIt` ≥threshold assertion).
- Offline golden set runs in the keyless `verify`/`agent_test` jobs and gates the MR; the var-capped validity checks reuse `@polymath/booleans`.
- Live banks wired into the existing protected-main key-gated job (or a sibling), `when: never` on MRs.
- Meta-check: a deliberately-wrong fixture (e.g. an agent move that *should* fail) is caught — the harness actually fails when behavior regresses (guard against a vacuously-green suite).

## Manual setup required
`OPENAI_API_KEY` (+ `LANGCHAIN_API_KEY` for tracing) on protected `main` for the live banks; none for the offline golden set. No keys in MR pipelines (CLAUDE.md). Hand-labeling the scenario banks is human work (the labels are the ground truth).

## Build plan (kmaz-plan-iteration, I7 — one opus pass; verified against code 2026-05-31)

**Tier: Sonnet** (pattern-replication of two existing fully-worked runners + JSON fixtures + a near-byte-for-byte CI clone; escalate the single `agent_live_eval` YAML decision if it interacts badly with the shared workflow rules). **Lands FIRST/independently** — does not consume unshipped F-29/F-30 behavior; they append their fixtures as they land. F-32 is the gate they're "done" against.

**The buried finding (the real deliverable):** `eval.test.ts`'s `liveIt('OpenAI provider agrees ≥95%')` runs ONLY inside `agent_test`, which gets NO `OPENAI_API_KEY` — **even on main push**. So the inner-agent live ≥95% move gate **has never run live.** F-32's `agent_live_eval` job is the first place it (and generation/spoken live banks) actually fires.

**Core decisions (resolved):**
- **Golden set = a NEW named bank + runner, existing banks re-run IN PLACE** (not re-homed — re-homing churns files F-29/F-30 are concurrently editing and re-triggers the explain-back path resolution). New `evals/golden/{move,generation,prompt,spoken}.json` + `apps/agent/src/agent/eval/golden.test.ts` (offline 100% + meta-check + live blocks). `scenarios.json`/`eval.test.ts` and `explainback/eval.test.ts`/`fixtures.json` fold in unchanged. "Golden set" = the policy union of all offline 100% assertions, anchored by `golden.test.ts`.
- **Unified fixture format** = the superset of the two existing interfaces; every new file is `{ note, fixtures: Fixture[] }` with an `id`, a `bank` discriminator, and an `expectFail` meta flag.
- **Offline/live split:** offline golden rides the EXISTING keyless `agent_test` (gates MRs, picked up free by `pnpm --filter @polymath/agent test`). Live banks run in a NEW `agent_live_eval` job (protected-main auto + `when:never` on MR + manual), mirroring `explain_back_live_eval`. `deploy.needs:` adds it.
- **Four live banks + judges:** move ≥95% → live `OpenAIMoveProvider` (exists). explain-back ≥90% → `OpenAIExplainBackJudge` (exists, unchanged, its own runner). generation-appropriateness ≥95% → the **live keyed generator itself** (validity is the offline oracle; appropriateness = the provider's actual output quality). spoken-groundedness ≥90% → a NEW `OpenAISpokenGroundednessJudge` (sibling of the explain-back judge).
- **Four emphases golden-vs-live:** adversarial/anti-gaming = **GOLDEN/offline** (the gate fails closed regardless of provider — the heuristic must NOT advance/master; deterministic). pedagogical-soundness = golden where deterministic, live where "best legal move." generation/spoken quality = LIVE. Validity/schema/topic-classification of all = GOLDEN.
- **Meta-check (first-class):** `expectFail:true` negative-control fixtures the runner asserts the oracle REJECTS + non-empty/unique-id bank assertions. Guards vacuous green.
- **Single correctness source:** generation-validity reuses the SAME `@polymath/booleans` var-capped path `layer2.ts` uses (import, don't fork). `evals/` is NOT in the Docker image (no COPY change).

**Frozen artifacts** (see BUILD-PLAN-i7 §Frozen contracts): the unified Fixture JSON shape; `evals/golden/{move,generation,prompt,spoken}.json` + `README.md`; `apps/agent/src/agent/eval/golden.test.ts`; `judges/spokenGroundedness.ts`; the `agent_live_eval` `.gitlab-ci.yml` job (real YAML).

**Ordered checklist (test-first; meta-check first-class; CI edits flagged):**
- [ ] 1. `evals/golden/README.md` — frozen fixture format + "add a golden case"/"add a live scenario" recipes + the `expectFail` meta rule (AC#6). Format-first so F-29/F-30 target it.
- [ ] 2. Write the **meta-check** first: an `expectFail:true` fixture per new bank + the runner assertion the oracle rejects it (red before oracle wiring).
- [ ] 3. Seed `move.json`: reference the heuristic oracle (do NOT move `scenarios.json`); adversarial/anti-gaming + pedagogical golden cases; non-empty.
- [ ] 4. Seed `generation.json`: the five reject reasons + `valid` cases (`expectValidity`). F-29 expands.
- [ ] 5. Seed `prompt.json`: prompt-present + (meta) prompt-less `expectFail` ComponentSpec fixtures.
- [ ] 6. Seed `spoken.json`: topic-classification golden + grounded/ungrounded live fixtures. F-30 expands.
- [ ] 7. Implement `golden.test.ts` offline oracles: heuristic-move (reuse `inputFor`/`matches`), generation-validity via the **same var-capped `@polymath/booleans` recompute** `layer2.ts` uses, prompt-schema, topic-classification. Assert 100%.
- [ ] 8. Wire the meta-check + non-empty/unique-id assertions into `golden.test.ts`; confirm a deliberately-broken fixture reds the suite.
- [ ] 9. Implement `judges/spokenGroundedness.ts` (`OpenAISpokenGroundednessJudge`, sibling of the explain-back judge).
- [ ] 10. Add the 3 `liveIt` blocks: move ≥0.95, generation-appropriateness ≥0.95, spoken-groundedness ≥0.90; all `OPENAI_API_KEY ? it : it.skip`.
- [ ] 11. Confirm `golden.test.ts` passes 100% offline (live blocks skipped) in the keyless `agent_test` — the MR gate.
- [ ] 12. **[CI EDIT]** Add `agent_live_eval` job (protected-main auto + `when:never` on MR + manual) running `golden.test.ts` + `eval.test.ts` WITH the key.
- [ ] 13. **[CI EDIT]** Add `- agent_live_eval` to `deploy.needs:` (only on main push; never blocks MRs).
- [ ] 14. Verify secret isolation: grep `.gitlab-ci.yml` — `OPENAI_API_KEY` in NO `merge_request_event`-reachable job; `verify`/`agent_test` keyless.
- [ ] 15. Update `eval.test.ts` header → ADR-017 + note its live gate now fires in `agent_live_eval` (it never did before). No behavior change.
- [ ] 16. Isolated `pnpm --filter @polymath/agent test` green; confirm no `apps/agent/Dockerfile` COPY change (`evals/` is CI/test-only).
- [ ] 17. Update Implementation notes: golden set = `golden.test.ts` + `evals/golden/*` ∪ existing banks re-run; the `agent_live_eval` job; the dead-live-gate finding.

**Open questions for Keith:** (1) confirm the inner-agent live ≥95% gate was NEVER running (and whether to ship `agent_live_eval` `allow_failure` initially in case the provider has drifted and would red main on first run). (2) re-run existing banks in place (recommended) vs physically re-home under `evals/golden/`? (3) generation-appropriateness judge = the live keyed generator itself (recommended) vs a separate LLM judge? (4) does F-32 or F-30 own `OpenAISpokenGroundednessJudge`? (5) `deploy.needs: agent_live_eval` (blocks deploy on red live eval) vs advisory? (6) non-empty-bank floor per bank at the F-32 barrier (explain-back uses ≥30)?

**Invariants:** no provider secret in any MR-reachable job (`agent_live_eval` `when:never` on MR + `liveIt` self-skips — belt-and-suspenders); offline golden 100%-gates MRs in the keyless `agent_test`; live banks protected-main only; single correctness source (var-capped `@polymath/booleans`, over-cap = `reject_over_var_cap` never enumerated); meta-check guards vacuous green; `evals/` NOT in the Docker image; fold in don't reshape (existing banks + runners unchanged).

## Implementation notes (filled in by the building agent)
