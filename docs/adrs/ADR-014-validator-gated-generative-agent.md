# ADR-014: The inner agent GENERATES challenge content within rails; the engine owns the answer key and the existing validation gate disposes

**Status:** Accepted · **Date:** 2026-05-31 (amended 2026-05-31 — broad creative latitude within rails; prompt-on-every-challenge) · **Stretch:** no
**Supersedes:** none · **Refines:** [ADR-005](./ADR-005-adaptive-ui-runtime-contract.md), [ADR-003](./ADR-003-statechart-plus-bounded-inner-agent.md) · **Related:** [ADR-015](./ADR-015-coherent-learning-surface-transcript.md) (prompt-on-every-challenge surface rule) · **Superseded by:** none
**Contract:** yes — extends the `ComponentSpec` registry contract (generation source) and the inner-agent flow; no wire reshape.

## Context

The shipped product (I0–I6) gives the inner agent a **selection** role: it picks the next practice item from the lesson's pre-authored `lessons/<id>/content.json` item bank (`HeuristicMoveProvider.pickLessonItem` cycles `items[(idx+1) % len]`; even the keyed `OpenAIMoveProvider`, when it chooses `next_practice_item`, selects from that authored array). [ADR-005](./ADR-005-adaptive-ui-runtime-contract.md) framed this as "the LLM never invents UI; it picks a `kind` from the typed registry and fills slots," and [ADR-003](./ADR-003-statechart-plus-bounded-inner-agent.md) bounded the agent to a finite typed action menu.

The [brief](../../hyperresponsive-mastery-ui.pdf) is explicit that a strong submission makes the *interface itself part of the tutoring* — the agent should be *generating the content that drives the multimodal UI* and deciding what to challenge the learner with next, not replaying a fixed array. The product owner's direction is unambiguous: **the agent should generate the challenges.** At the same time the brief is equally explicit that **content correctness is non-negotiable** and warns against an interface that **declares mastery because the learner completed the flow.**

These two requirements look opposed only if "generate" is taken to mean "the model also asserts the answer key the system trusts." This ADR resolves the tension.

## Decision

**The agent generates the next challenge within rails; the deterministic engine (`@polymath/booleans`) computes the answer key; the existing, unchanged validation gate disposes.** Generation proposes; the validator disposes. Concretely:

1. **The engine, not the model, owns the answer key.** When the agent commits to a generated `targetExpression`, the server computes its truth table with `@polymath/booleans` `truthTable(expression)` (distinct-variable-capped) and *that* becomes the item's `claimedTruthTable`. The model never supplies a trusted key; the item-generating `ComponentSpec` kinds already carry `claimedTruthTable`, and **Layer-2 already recomputes it** (`apps/agent/src/agent/layer2.ts`) before any action ships. A generated item is therefore *exactly* an authored item whose `expression` came from the model — and it runs the **identical** gate. This is the spirit of "the model supplies the question, the engine supplies the answer."

2. **Generation is bounded by rails** derived from the lesson + the server's learner-state fold: the allowed operator alphabet (the lesson's KCs + grammar — e.g. L3 is NAND-only), the variable count (≤ the lesson's max, hard-capped at the `@polymath/booleans` distinct-variable cap), and a target difficulty tier derived from BKT/streak. An out-of-rails or un-computable generation is **rejected and regenerated** — the existing retry-once-then-fallback contract in the agent flow, widened from "re-ask the model" to "regenerate."

   **Within those rails the agent has broad creative latitude** (amended 2026-05-31): it freely chooses *which* challenge to pose next — the representation to mount it in (truth table vs. circuit vs. pseudocode), the specific expression, the visible scaffolds, the difficulty, **and the framing prompt** — driven by the learner's live spoken + typed state. The rails are a *safety bound* (correctness + computability), not a script: the front-line tutor is meant to be inventive about *how* to challenge and ground the student, not to walk a fixed list. A **current-lesson-KC restriction is deliberately NOT imposed** — the agent may compose freely across concepts the curriculum has already taught; it is bounded only by the rails (operator alphabet, variable cap, computability) and the fail-closed gates. (Transfer probes remain the exception — see Consequences.)

3. **Every generated challenge carries a grounding prompt.** The agent must emit an instruction or question with every item-bearing mount — never a bare truth table / circuit / code box. The prompt is part of the generated artifact (ADR-015's append-only optional `prompt` field, required at the surface boundary). A generation with no prompt is treated like any other invalid generation: rejected and regenerated. This is the generation-side half of ADR-015's "every challenge carries a prompt" rule.

4. **Authored content becomes seed + fallback, not the menu.** `lessons/<id>/content.json` remains the source of the intro/worked-example copy, the (locked, read-only) `transfer_bank`, and the **deterministic offline fallback** when no provider key is present or generation fails twice. The keyless `HeuristicMoveProvider` keeps *selecting* from it, so the offline/CI path and every keyless test are unchanged; generation is the *new* path the keyed provider takes.

## Options considered

**A — Keep selection from a larger authored bank.** Make the bank richer and the selection genuinely adaptive (reason over learner state to pick item/difficulty/rep/scaffold), no generation. *Rejected* as the primary mode: it does not satisfy the brief's "the agent generates the content," and authoring can't cover the combinatorial space of L2–L4 the way live generation can. (It survives as the keyless fallback path — see decision 3.)

**B — Full freeform generation, the model asserts the answer key.** *Rejected.* Directly violates the brief's non-negotiable content correctness and the project invariant that **the server never trusts the agent** — an LLM that ships its own `claimedTruthTable` could mis-key an item and grade a learner against a wrong answer, and no amount of prompt care makes that safe.

**C — Generate the question, engine computes the answer, validate before mount (chosen).** Real generation, a hard correctness guarantee, no contract reshape — the `claimedTruthTable` recompute that already exists is precisely the disposal step. The narrower "hybrid: generate the expression within rails" option from the planning gate is folded in here: rails are the safety bound, the engine is the key authority.

## Consequences for the build

- **Source of truth:** the generation rails + the engine-owned-key rule live in the inner-agent flow (`apps/agent/src/agent/`); the disposal gate is the **unchanged** `layer2.ts` + the earned-it gates in `server.ts`. The `ComponentSpec` registry contract is *consumed* (generation targets the same item kinds), not reshaped.
- **Exhaustive consumers / invariants that MUST hold (all confirmed present today; none move):**
  - **Distinct-variable cap on every `equivalent()`/`truthTable()` call site** — generation adds a call site (computing the key); it must be capped, or it is a DoS. Over-cap input is rejected, never enumerated.
  - **`events.app IS NULL` discriminator** on every integrity read; **server-recomputed** correctness (never the client `correct` flag); **uncapped** off-topic counter; **server-minted** mastery celebration — all unchanged.
  - **The mastery gate fails closed.** Generation drives *practice*, never *mastery*: a generated streak cannot fast-path the locked gate, the transfer probe, or the explain-back. The transfer bank stays **hand-curated and read-only** — probes are NOT generated (the held-out probe's integrity depends on curation; ADR-010 Layer 5). Generation is for the practice surface only.
- **ADR-005 still holds where it matters:** the LLM still never invents *UI* (no freeform JSX; it targets the typed registry kinds) and is still on the critical path only at phase boundaries. What changes is the *content inside* an item kind: the `expression` may be generated, the *answer key* never is.
- **Provider wiring:** production selects `OpenAIMoveProvider` when `OPENAI_API_KEY` is present, else the heuristic (documented seam; the MR-pipeline secret rule from CLAUDE.md is respected — no provider key in MR jobs).

## Status note

Accepted as the architectural basis for iteration I7. The implementing features (the stateful flow, the generation node, the provider wiring) are specified in ROADMAP.md under I7 and carry the build detail.
