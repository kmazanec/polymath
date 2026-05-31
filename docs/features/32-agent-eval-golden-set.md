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

## Implementation notes (filled in by the building agent)
