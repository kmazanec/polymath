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

## Build plan (kmaz-plan-iteration, I7 — one opus pass; verified against code 2026-05-31)

**Tier: Opus** (the iteration's safety core — engine-owns-key overwrite, var-capped new call site, adversarial reasoning). **HARD-depends on F-28** (generation IS F-28's `realize` node) — serial after F-28.

**Core decisions (resolved):**
- **REUSE the item path — NO new `generate_practice_item` move.** The keyed model asserts an arbitrary `targetExpression` + `prompt` via the existing `next_practice_item`/`simpler_item`/`rephrase` moves; the **engine overwrites `claimedTruthTable`**. ADR-014 §1: "a generated item is exactly an authored item whose expression came from the model." No menu/enum lockstep churn beyond adding `prompt` to `ItemSchema`.
- **Engine owns key at ONE shared flow site** (between `proposeMove` and `compileMove`, applied to EVERY item-bearing move from EVERY provider — idempotent no-op for authored items, defense for them too). New `computeItemKey(expression)` (var-capped at `MAX_DISTINCT_VARS=10`, lifted from the `layer2.ts` block; lives in `apps/agent`, NOT booleans — avoid the 100% coverage gate). The model's asserted key is **discarded**.
- **Layer-2 stays byte-for-byte UNCHANGED.** Because the engine overwrites the key, the wrong-key case is impossible-by-construction at Layer-2 — so the "wrong key → rejected" adversarial test asserts **the engine OVERWROTE** (the mounted spec carries the computed key), not a Layer-2 rejection. Document this at the call site or a future editor re-opens Option B.
- **Rails** = (a) operator alphabet ⊆ union of operators in authored `content.json` `targetExpression`s for lessons `1..currentLessonId` (taught-concepts; NO current-lesson-only restriction per the ADR amendment), (b) var count ≤ lesson max (≤ cap), (c) computability. Circuit palette reuses `circuitAllowedGates`. Out-of-rails → reject + regenerate.
- **Prompt-presence** is a SEPARATE generation-validity check in `realize` (NOT a Layer-2 edit). Prompt-less → reject + regenerate (same branch as a rails failure).
- **Regenerate-on-reject** = the existing 2-attempt loop (attempt 0 + attempt 1 = "regenerate once"), incrementing `regenerationCount`, then fallback to an authored item, then `no_action`.
- **Practice-only enforced by omission:** generation flows only through practice item moves; `propose_transfer_probe`/`propose_mastery_transition` untouched (keep their server.ts earned-it gates + fail-closed mastery). Generation never emits a `TransferProbe`; the bank stays read-only.
- **Keyless unchanged:** `pickLessonItem` gains one line — carry the authored item's (F-27-backfilled) prompt into `ProposedItem.prompt`.

**Frozen signatures** (see BUILD-PLAN-i7 §Frozen contracts): `ProposedItem.prompt?` (agent-internal, menu.ts — NOT a contract change); `ItemSchema.prompt` (openaiClient.ts, lockstep); `computeItemKey(expression)` (new `key.ts`, var-capped); `checkGeneratedItem(item, input): GenerationValidity` + `allowedOperatorAlphabet`/`lessonMaxVars` (new `rails.ts`).

**Ordered checklist (adversarial tests first-class):**
- [ ] 1. (test) Pin current keyless: `pickLessonItem` still cycles `content.json` and now carries the authored prompt. Offline parity locked.
- [ ] 2. (test) `computeItemKey`: correct MSB-first key; **over-cap (>10 vars) → `{ok:false}`, never enumerates** (assert fast/no timeout); unparseable → `{ok:false}`.
- [ ] 3. Implement `key.ts computeItemKey` (var-capped, lifted from layer2). Layer-2 untouched.
- [ ] 4. (test) `allowedOperatorAlphabet`/`lessonMaxVars`/`checkGeneratedItem`: in-rails passes; out-of-alphabet (NAND on AND/OR/NOT; OR on L3-NAND-only) → reject; over-var-cap → reject; **prompt-less → reject**; over-lesson-max → reject; taught-concepts composition allowed (union over lessons ≤ id).
- [ ] 5. Implement `rails.ts checkGeneratedItem` (returns the engine key on success).
- [ ] 6. **[lockstep]** `ProposedItem.prompt?` (menu.ts) threaded into all 3 `itemSpec` returns. (test) `compileMove` emits the prompt on each item kind.
- [ ] 7. **[lockstep]** `ItemSchema.prompt: z.string().nullable()` (openaiClient.ts) threaded in `toTacticalMove`. (test) raw→TacticalMove carries prompt.
- [ ] 8. `pickLessonItem` (+ simpler/current variants) carry the authored prompt. (test) keyless item always has a prompt.
- [ ] 9. **(test — SAFETY CORE)** A move with a WRONG `claimedTruthTable` → after the flow the mounted spec carries the **engine-computed** key (overwrite proven), never the model's.
- [ ] 10. Wire engine overwrite + `checkGeneratedItem` + `regenerationCount++` into `realize`/`proposeAction` (the F-28 seam). Green #9.
- [ ] 11. **(test — adversarial)** Over-cap generated expr → rejected, never enumerated (no event-loop block, fallback taken); unparseable → rejected; out-of-alphabet → rejected; each → regenerate once.
- [ ] 12. (test) Regenerate end-to-end: attempt 0 invalid → attempt 1 (regenerate, count++) → invalid → authored fallback → empty bank → `no_action`.
- [ ] 13. **(test — adversarial)** Prompt-less generation → rejected + regenerated; never a bare workspace.
- [ ] 14. **(test — practice-only)** A generated streak does NOT fast-path mastery (gate fails closed), transfer (`propose_transfer_probe` earned-it-gated), or explain-back; generation never emits `TransferProbe`.
- [ ] 15. Update `prompt.ts` system prompt: generate (not select) within rails, compose across taught concepts, ALWAYS emit a prompt, engine owns the key.
- [ ] 16. **(integration, isolated agent suite)** A keyed turn (scripted provider) → validated generated item (engine key + prompt); keyless turn → authored item; both mount the same kinds.
- [ ] 17. **(eval — F-32 owns harness)** Add generation golden cases (in-rails/wrong-keyed/over-var-cap/unparseable/prompt-less → reject, 100% offline) + the live appropriateness ≥95% bank (protected/main, keyed). NO key in MR jobs.
- [ ] 18. (gate) Typecheck + agent suite isolated green + non-agent suites green; confirm `packages/booleans` coverage untouched (no new code there).

**Adversarial safety list:** wrong key → engine overwrites; over-cap → rejected/never enumerated; unparseable → rejected; prompt-less → rejected+regenerated; out-of-alphabet → rejected; over-lesson-max vars → rejected; generated streak → mastery unreachable; generation never emits a TransferProbe.

**Open questions for Keith:** (1) reuse item-path vs new `generate_practice_item` move? (recommended: reuse, per ADR-014 §1). (2) `ProposedItem.prompt` is agent-internal (not `@polymath/contract`) — confirm no contract-change protocol triggered. (3) rails alphabet content-derived vs a new optional `LessonContent.allowedOperators` field? (recommended: content-derived, no contract edit). (4) "taught concepts" = lessons `1..currentLessonId` numeric order — confirm no non-linear prerequisite DAG.

**Invariants:** Layer-2 byte-for-byte unchanged; var-cap on the new `computeItemKey` site; engine owns key (model's asserted key always discarded, every provider); transfer bank hand-curated/read-only; lockstep `ProposedItem.prompt`↔`ItemSchema.prompt`↔`itemSpec`/`compileMove` (NO new `TacticalMove`); no provider key in MR jobs; keyless behavior-preserving; `packages/booleans` untouched (helpers in `apps/agent`).

## Implementation notes (filled in by the building agent)
