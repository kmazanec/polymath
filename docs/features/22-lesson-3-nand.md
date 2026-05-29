# Feature: Lesson 3 — NAND universality

**ID:** F-22 · **Iteration:** I6 — Stretch · **Status:** Not started

## What this delivers (before → after)

**Before:** The curriculum ends at L2. The "aha" moment that the architecture is designed to deliver — *any Boolean function can be built from NAND alone* — has no surface in the prototype. [ADR-001](../adrs/ADR-001-learning-domain-boolean-logic.md)'s pedagogical case for the cross-rep gym thesis is half-told.

**After:** Lesson 3 is loaded. Content covers: introducing NAND as a primitive, demonstrating AND/OR/NOT can each be built from NAND alone (the universality proof, in worked-example form), then practice items where the learner must construct given functions using NAND-only circuits. Transfer items (pre-seeded by F-08) test transfer to NAND from prior reps. The agent menu is unchanged; lesson_3 is a new sub-statechart instance. NAND is added to `packages/booleans` (strict extension — new gate, no signature change). The aha demo moment — pulse-through-the-circuit on a NAND-built XOR — is a planned demo highlight.

## How it fits the roadmap

I6, **first stretch feature; highest priority** per [ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md). Concurrent with F-24 (handoff-to-tutor) — zero file overlap.

## Dependencies (must exist before this starts)

- **F-08** — L3 transfer items in the bank.
- **F-15** — lesson transition pattern proven on L1→L2 (now reused for L2→L3).

## Unblocks (what waits on this)

- **F-23** — L4 depends on L3.

## Contracts touched

- **Lesson config JSON** — `lessons/3/*.json` introduced.
- **Statechart spine** — adds lesson_3 sub-statechart + L2→L3 macro transition.
- **`packages/booleans`** — extends gate alphabet with NAND. Strictly additive; existing API unchanged.
- **`ComponentSpec.CircuitBuilder.allowedGates`** — L3 items can specify `['NAND']` only.
- **`ComponentSpec`** — no new variants (per [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md): MVP registry covers L1+L2 comfortably; the same components extend to L3 because the cross-rep gym is the same).

## Sub-tasks

1. **T-22a — Author L3 content** `[parallel]`
2. **T-22b — Lesson_3 sub-statechart + L2→L3 macro transition** `[parallel]`
3. **T-22c — NAND gate in `packages/booleans`** `[parallel]`
4. **T-22d — NAND gate node type in react-flow** `[parallel]`
5. **T-22e — L3 hint templates + KC vocabulary + mastery config** `[parallel]`
6. **T-22f — Eval scenarios** `[parallel]`

## Acceptance criteria (product behavior)

1. **A learner mastering L2 sees a "continue to Lesson 3" affordance**; clicking it transitions to L3.
2. **L3 opens with a worked example: AND, OR, and NOT each constructed from NAND** — three small worked examples in sequence.
3. **The first practice item asks the learner to build NOT from NAND** in the Circuit workspace.
4. **`packages/booleans` correctly evaluates NAND-only circuits** and confirms equivalence to non-NAND target expressions.
5. **The aha demo moment is achievable**: learner builds XOR from NAND, presses Test it, and the pulse-through animation traces signal propagation through the NAND-only circuit while the truth-table row pulses match.
6. **L3 mastery uses the same 4-condition gate** with L3-specific KCs.

## Testing requirements

- Schema validation for `lessons/3/*.json`.
- Statechart test for L2→L3 transition.
- Unit tests for NAND in `packages/booleans`.
- LangSmith eval for L3-specific scenarios.

## Manual setup required

- Author the 8 L3 transfer items (already in F-08).
- Author the 12 L3 practice items — ~1 day.

## Convergence and expected rework

⚠ **Concurrent with F-24 (handoff-to-tutor).** Zero file overlap by design: F-22 touches lessons/3/, statechart, `packages/booleans`. F-24 touches `apps/web/src/views/TutorHandoff.tsx`, `packages/graph/handoff/`.

⚠ **`packages/booleans` extension** is the only contract extension. Strictly additive — new gate, no API change.

## Implementation notes (filled in by the building agent)

> Empty.

---

## Build plan (approved)

**Planned:** 2026-05-29 (kmaz-plan-iteration, one opus pass: architect/reuse/contrarian) · **Manifest:** [BUILD-PLAN-i6-stretch](../BUILD-PLAN-i6-stretch.md) · **Build tier:** Opus lead (circuit-model logic), Sonnet for lesson-data authoring.

> **Cross-cutting decision D-A (Keith, 2026-05-29): NAND IS a real `@polymath/booleans` primitive token.** The planner's contrarian recommendation to desugar NAND→NOT(AND) in the web layer only was **overridden** for consistency with F-23 (NOR). NAND is added as an infix keyword gate via the full additive extension (signatures unchanged — "the gate alphabet may grow, the function shapes don't"). L3 `targetExpression`s may use `NAND` directly; the loader's truth-table recompute validates them. **F-22 must merge before F-23** — both edit the same `packages/booleans/src/index.ts` parser regions (NAND vs NOR), so the grammar work is serial.

### Summary
L3 ships as: NAND added as a primitive infix token to `@polymath/booleans` (additive); new lesson data (`lessons/3/{content,mastery_config,kc_vocabulary}.json`, 12 NAND-universality items); a web circuit-model extension making `NAND` a first-class `GateKind` (palette button + render label + `buildCircuit` + `pulseSchedule`, so the XOR-from-NAND pulse demo works); and an agent-stub tweak so L3 circuit items mount with `allowedGates:['NAND']`. The statechart, lesson loader, lesson-advance reflex, and server are **unchanged** — L3 rides the generic L1→L2 machinery proven by F-13/F-15.

### Files to create
- `lessons/3/content.json` — lessonId 3, KCs (recommend `["nand-universality","nand-construction"]` — verify against the `kc` field of L3 rows in `seed_data/transfer_items.json`), 12 items tiers 1–4, truthTables MSB-first.
- `lessons/3/mastery_config.json` — copy `lessons/2/mastery_config.json` verbatim.
- `lessons/3/kc_vocabulary.json` — `{ "kcVocabulary": [...] }` NAND vocab (NAND, universal gate, functional completeness, NOT-AND…).
- L3 eval scenario fixtures (verify the existing eval path during build; offline preconditions/labels half).

### Files to modify
- `packages/booleans/src/index.ts` — **NAND primitive (additive):** `Token` (`{type:'nand'}`), `KEYWORDS` (`NAND:'nand'`), `Ast` (`{kind:'nand';left;right}`), parser arm (NAND at AND-precedence, left-assoc), `evaluate` (`!(l&&r)`), `variables` walk, `astToExpression` (`A NAND B`), and the pseudocode tokenizer `PSEUDO_KEYWORDS`/`tokenizePseudo` **only if** an L3 pseudocode item uses NAND (prefer authoring L3 pseudocode without NAND to keep the pseudo-grammar untouched).
- `packages/booleans/src/scoreEquivalence.ts` — confirm NAND flows through (parses→truthTable; likely zero change; add a test).
- `apps/web/src/canvas/circuitModel.ts` — `GateKind` += `'NAND'`; `buildCircuit` NAND arm (`{kind:'nand',...}` now that the AST has it, or desugar — pick first-class to match the token); `pulseSchedule` `valueOf`/`describe` NAND arms.
- `apps/web/src/components/CircuitBuilder.tsx` — widen the palette filter (~line 175) to include `'NAND'`.
- `apps/web/src/components/circuitNodes.tsx` — verify `GateNode` renders the NAND label + 2 input ports (binary gate).
- `apps/agent/src/agent/stubClient.ts` — for `lessonId===3` circuit items set `allowedGates:['NAND']`.
- `apps/agent/src/hints/templates.ts` — verify `detectGate`/`generateL1/L2` cover NAND-targeting hints; add an L3 template only if a gap shows.

### Build sequence (test-first)
- [ ] **booleans NAND test-first:** `equivalent("A NAND B","NOT (A AND B)")===true`; `truthTable("A NAND B").out` MSB-first; `astToExpression(parse("A NAND B"))` round-trips; precedence vs AND/OR correct. Run red.
- [ ] Implement NAND in `packages/booleans/src/index.ts` (Token, KEYWORDS, Ast, parser arm, evaluate, variables, astToExpression). Green.
- [ ] Add a `scoreEquivalence` test with a NAND expression; fix only if it fails.
- [ ] **circuitModel test-first:** a NAND node yields a NAND AST; a NAND-only XOR circuit (`NAND(NAND(A,NAND(A,B)), NAND(B,NAND(A,B)))`) builds and matches the XOR truth table over all 4 rows; `pulseSchedule` emits a deterministic step per gate with correct NAND values + labels.
- [ ] Extend `GateKind`, `buildCircuit`, `pulseSchedule` (valueOf + describe). Green.
- [ ] Widen `CircuitBuilder.tsx` palette filter to include `'NAND'`; extend `CircuitBuilder.test.tsx` (NAND palette button appears when `allowedGates:['NAND']`; placing+wiring yields a NAND node).
- [ ] Verify `circuitNodes.tsx` GateNode renders NAND (2 ports); add minimal styling if needed.
- [ ] Author `lessons/3/content.json` (12 items): tier-1 worked targets NOT/AND/OR-from-NAND; tiers 2–4 escalate (NAND-built XOR, majority, 3-input). Compute every truthTable via a scratch `@polymath/booleans.truthTable` call so the loader recompute cannot throw.
- [ ] Copy `lessons/3/mastery_config.json` from L2; create `lessons/3/kc_vocabulary.json`.
- [ ] Loader/schema test: `loadLesson(3)` succeeds, recomputed tables match, item KCs ⊆ `knowledgeComponents`.
- [ ] Statechart/advance test: `createLessonMachine({lessonId:3})` reaches all `LESSON_PHASES`; a mastered L2 offers L3 (`loadLessonIfExists(3)`); `handleAdvanceLessonTurn(toLessonId:3)` from current 2 loads.
- [ ] `stubClient.ts`: L3 circuit items carry `allowedGates:['NAND']`; unit-test the mounted spec.
- [ ] Author L3 eval scenarios (offline half gates MR; live LLM half protected/manual).
- [ ] `pnpm typecheck && pnpm test`; drive the app to confirm AC#5 (build XOR from NAND → Test it → pulse animates → truth-table row matches).

### Contracts touched
- **`@polymath/booleans`** — ADDITIVE: new `Ast` variant `{kind:'nand';…}`, `Token` `{type:'nand'}`, `KEYWORDS.NAND`. Locked `parse/evaluate/variables/truthTable/equivalent` signatures unchanged. **Shared with F-23 (NOR) — same parser regions; F-22 merges first.**
- **`GateKind`** (web-internal, `circuitModel.ts`) — ADDITIVE `'NAND'`. **Shared with F-23 (NOR) — F-22 merges first.**
- **Contract `Gate` enum** — UNCHANGED (already lists NAND/NOR/XOR/XNOR).
- **Lesson config JSON** — new `lessons/3/*` instances of existing locked schemas. No schema change.
- **`stubClient.ts`** — shared with F-23; append-only behavior (`allowedGates` per lesson).

### Tests → AC
- booleans NAND + circuitModel XOR-from-NAND build/eval/pulse → **AC#4, AC#5**.
- `CircuitBuilder.test.tsx` NAND palette w/ `allowedGates:['NAND']` → **AC#3**.
- Loader/schema test on `lessons/3` → **AC#2** + "schema validation" testing req.
- Statechart + advance test → **AC#1, AC#6**.
- stubClient test → **AC#3/#5** (NAND-only workspace actually mounts).
- L3 LangSmith eval (offline half gates MR) → "LangSmith eval for L3" testing req.

### Risks / open decisions
- **D22-1 — L3 KC names:** recommend `["nand-universality","nand-construction"]`; MUST match the `kc` field of seeded L3 transfer rows (verify `seed_data/transfer_items.json`).
- **D22-2 — first-class NAND gate node (2 ports), not chained AND+NOT** — required so the pulse demo *looks* like a NAND circuit. Recommend first-class.
- **Integrity/DoS:** no new server-side `equivalent()`/`truthTable()` call site; the existing distinct-variable cap is unchanged — the build must add no uncapped enumeration. The lesson-advance reflex already fails closed.
- **Deploy:** `lessons/` and `seed_data/` are already COPYed in `apps/agent/Dockerfile`; `lessons/3/` needs no Dockerfile change; no new `packages/*`.

### Dependencies & DAG position
- **Depends on:** F-08 (L3 transfer items — DONE) and F-15 (L1→L2 transition — DONE). No other blocker; highest-priority I6 feature.
- **Unblocks:** F-23 (L4/NOR) — F-23 reuses F-22's `GateKind`/palette/stub pattern and rebases on F-22's booleans grammar change.
- **No overlap** with F-24/F-25; F-26 consumes (but does not modify) F-22's grammar/circuit work.
