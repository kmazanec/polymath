# Feature: Validator-gated challenge generation

**ID:** F-29 · **Iteration:** I7 · **Status:** Not started

## What this delivers (before → after)
**Before:** The agent selects the next practice item from a fixed pre-authored array (`items[(idx+1) % len]`); it never invents a challenge.
**After:** On the keyed path the agent *generates* the next challenge — expression, rep, visible scaffolds, difficulty — from the learner's live state, the engine computes the answer key from that expression, and the unchanged validation gate accepts it or forces a regenerate; authored `content.json` remains the seed and the keyless/offline fallback.

## How it fits the roadmap
Third feature of I7 and the realization of [ADR-014](../adrs/ADR-014-validator-gated-generative-agent.md). It fills the `realize` node of F-28's graph with generation-within-rails for the keyed provider. It is the brief's *"the agent generates the content that drives the multimodal UI"* — made safe by the engine owning the key.

## Requirements traced (from the PRD)
Brief: *"the agent should be generating the content that drives the multi-modal UI"* **and** *"content correctness is non-negotiable"* **and** *"do not declare mastery because the learner completed the flow."* This feature satisfies all three simultaneously via validator-gated generation.

## Dependencies (must exist before this starts)
- **F-28 (stateful agent flow)** — HARD dep: generation is the `realize` node of F-28's `StateGraph`; without the graph there is no seam to generate into.

## Unblocks (what waits on this)
- F-32 (agent eval) — F-29 contributes the generation validity/quality labeled scenarios to the golden set + live bank; F-29 is "done" only when those cases are green.

## Contracts touched
- **`ComponentSpec` registry** (source of truth: ADR-005) — generation targets the **existing** item-generating kinds (`TruthTablePractice`/`CircuitBuilder`/`PseudocodeChallenge`); no new kind. The generated item's `claimedTruthTable` is **engine-computed**, never model-asserted.
- **`packages/booleans` validator** (source of truth: ADR-005/ADR-010) — a NEW call site computes the generated expression's table; **must be distinct-variable-capped** like every other call site (over-cap → reject, never enumerate).
- **Inner-agent flow / generation rails** (source of truth: **ADR-014**) — introduces the rails (operator alphabet, var count, target tier) and the regenerate-on-reject loop (widening the existing retry-once → fallback contract).

## Acceptance criteria (product behavior)
1. On the keyed path, the agent generates a `targetExpression` within the lesson's rails (allowed operators incl. L3 NAND-only; var count ≤ lesson max and ≤ the distinct-var cap; target tier from BKT/streak), with **broad creative latitude** over which rep to mount, the scaffolds, and the difficulty — and may compose freely across already-taught concepts (no current-lesson-KC-only restriction; bounded only by the rails + gates).
2. The server computes the generated expression's truth table via `@polymath/booleans` (var-capped) and uses it as the item's `claimedTruthTable` — the model's asserted key (if any) is never trusted.
3. **Every generated challenge carries a grounding prompt** (instruction/question) — a generation with no prompt is invalid and regenerated, exactly like a wrong-keyed one. The agent never mounts a bare workspace.
4. A generated item whose expression is un-parseable, over the var cap, mis-keyed, **or prompt-less** is **rejected and regenerated once**, then falls back to an authored item, then `no_action` — never mounting a malformed, wrong-keyed, or ungrounded challenge.
5. The keyless path is unchanged: the heuristic still selects from `content.json` (whose items carry their authored prompt); offline/CI behavior and tests are identical.
6. Generation drives **practice only** — it never generates a transfer probe (the bank stays hand-curated, read-only), and a generated streak cannot fast-path the mastery gate, transfer probe, or explain-back. Mastery remains the locked, server-minted gate.

## Testing requirements
- Unit: rails enforcement (out-of-alphabet / over-var-cap / wrong-tier rejected); engine-computed key matches `@polymath/booleans`; regenerate-on-reject path.
- **Adversarial (the safety core):** a generation that asserts a wrong `claimedTruthTable`, an over-cap expression, or an un-parseable expression is rejected by Layer-2 and never mounts — proving "generate" is strictly as safe as "author."
- Integration (agent suite, isolated): a keyed turn produces a validated generated item; the keyless turn produces the authored item; mastery is unreachable from a generated practice streak alone.
- Live LLM eval (protected/`main` only, keyed): generated items stay in-rails and validate at the project's eval bar.
- **Eval contribution (F-32):** add generation scenarios to the golden set (deterministic validity: in-rails / wrong-keyed / over-var-cap / unparseable / prompt-less → reject, 100% offline) and the live bank (generation appropriateness ≥95%). These cases gate F-29 "done" per [ADR-017](../adrs/ADR-017-agent-eval-policy-golden-set.md).

## Manual setup required
`OPENAI_API_KEY` on the protected branch + locally for the keyed/generation path. None for the keyless fallback. No key in MR pipelines.

## Implementation notes (filled in by the building agent)
