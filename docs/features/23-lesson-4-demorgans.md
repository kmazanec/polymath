# Feature: Lesson 4 — De Morgan's law + halfway-misconception defense

**ID:** F-23 · **Iteration:** I6 — Stretch · **Status:** Not started

## What this delivers (before → after)

**Before:** Curriculum ends at L3. The "deep symmetry as payoff" pedagogy from [ADR-001](../adrs/ADR-001-learning-domain-boolean-logic.md) is not closed. Almstrum 1996's named "halfway application" misconception is unaddressed.

**After:** Lesson 4 loads De Morgan's law: `NOT (A AND B) ≡ (NOT A) OR (NOT B)` and `NOT (A OR B) ≡ (NOT A) AND (NOT B)`. Practice items include deliberately constructed "halfway-misconception" items — where a learner who flips the negation but forgets to flip the operator produces a near-miss truth table. The rubric flags this specific misconception by name and provides a targeted hint. Transfer items pre-seeded in F-08 specifically include halfway-misconception challenges. NOR is added to `packages/booleans` as a primitive (the natural pair with De Morgan's).

## How it fits the roadmap

I6, **second stretch priority** per [ADR-012](../adrs/ADR-012-stretch-features-for-nerdy.md). Concurrent with F-25 (teacher artifact).

## Dependencies (must exist before this starts)

- **F-22** — L3 unlocks L4.

## Unblocks (what waits on this)

- **F-26** — L5 playground depends on L4.

## Contracts touched

- **Lesson config JSON** — `lessons/4/*.json`.
- **Statechart spine** — adds lesson_4 sub-statechart + L3→L4 transition.
- **`packages/booleans`** — adds NOR as a primitive. Strictly additive.
- **Misconception rubric** — `lessons/4/misconceptions.json` introducing the halfway-application pattern matcher. Used by the agent to detect + name the misconception in hint copy.
- **Agent hint templates** — L4-specific templates include the halfway-misconception explanation.

## Sub-tasks

1. **T-23a — Author L4 content (including halfway-misconception items)** `[parallel]`
2. **T-23b — Lesson_4 sub-statechart + L3→L4 transition** `[parallel]`
3. **T-23c — NOR gate in `packages/booleans`** `[parallel]`
4. **T-23d — Halfway-misconception pattern matcher + hint template** `[parallel]`
5. **T-23e — Eval scenarios** `[parallel]`
   - LangSmith case: learner submits the halfway-misconception form → agent emits the specific named hint.

## Acceptance criteria (product behavior)

1. **A learner mastering L3** can continue into L4 via the macro transition.
2. **L4 opens with a worked example demonstrating De Morgan's law**, showing the two forms.
3. **Submitting the halfway-misconception form** (e.g., `NOT (A AND B)` answered as `(NOT A) AND B` — operator unchanged) triggers a hint that *names the misconception*: "you flipped the negation but didn't flip the operator — try also changing AND to OR."
4. **`packages/booleans` correctly handles NOR** and confirms De Morgan's equivalences.
5. **The transfer probe for L4** includes a halfway-misconception challenge from the pre-seeded bank; passing it is part of L4 mastery.
6. **LangSmith eval for the halfway-misconception detection passes at ≥90%.**

## Testing requirements

- Schema validation for `lessons/4/*.json`.
- Statechart test for L3→L4.
- Unit tests for NOR + De Morgan's equivalence checks.
- Misconception detector tests: every halfway-form submission triggers the named hint; no false positives on actually-correct answers.
- LangSmith eval at ≥90%.

## Manual setup required

- Author the 8 L4 transfer items (in F-08).
- Author the 12 L4 practice items including ≥4 halfway-misconception traps — ~1 day.

## Convergence and expected rework

⚠ **Concurrent with F-25 (teacher artifact).** Zero file overlap.

## Implementation notes (filled in by the building agent)

Built on `build/i6-stretch` @ 73e655c (the frozen I6 contracts). The contract barrier
had **already landed** the NOR grammar (`packages/booleans/src/index.ts`), the
misconception validator+loader scaffold (`apps/agent/src/hints/misconceptions.ts`,
with the **frozen signature** `detectHalfwayMisconception(bank, itemId, learnerOutput:(0|1)[])`
/ `halfwayHintFor(...)`), an empty `lessons/4/misconceptions.json`, the parameterised
`createLessonMachine({lessonId})` factory, and the L4 transfer-bank rows (incl. the
halfway item `L4-07-halfway`). So this build is the **feature behavior on top of** that
scaffold, consuming those signatures unchanged — no contract drift.

- **NOR + De Morgan (booleans).** Added the unit coverage the build plan asked for
  (`index.test.ts`): parse → `nor` node, `evaluate !(l||r)`, MSB-first `truthTable`,
  `astToExpression` round-trip, BOTH De Morgan forms, NOR=¬(A∨B)=NAND-dual, and the
  halfway-error-vs-correct-dual distinction. Plus a `scoreEquivalence` NOR test
  (the agent's var-capped scorer flows NOR through).
- **Detector signature — superseded build-plan API.** The build plan sketched an
  *expression-based* `detectHalfwayMisconception(targetExpression, submission)` that
  recomputes the un-dualised pushdown. The **frozen** API instead compares the
  learner's truth-table OUTPUT column to a per-item authored `halfwayTruthTable`. I
  consumed the frozen signature (it is the contract) and moved the "compute the
  halfway column" work to **authoring time** (`lessons/4/misconceptions.json`),
  verifying each authored column against `@polymath/booleans` in a scratch run and a
  test. D23-1 (semantic, not string) is preserved — the match is on truth-table
  columns, never regex.
- **No var-cap DoS surface in the detector path.** Because the column is read straight
  off the bounded `repSubmission.cells` (a 0/1 vector, contract-capped at 1024 cells),
  the wiring never enumerates an expression — so the "distinct-variable cap" the build
  plan flagged is satisfied by *not enumerating at all*. A non-truth-table submission
  (circuit/pseudocode, no MSB column) simply skips to the generic rephrase.
- **Zero false positives (load-bearing).** Authoring verified every trap item's
  `halfwayTruthTable` differs from its correct answer key, and `detectHalfwayHint`
  only flags a column the bank explicitly matches. Tested at three layers: the pure
  detector (`misconceptions.test.ts`), the stubClient wiring
  (`demorganMisconception.test.ts`: correct / wrong-but-not-halfway / non-truth-table
  all skip the named hint), and the eval labels.
- **Hint level = L1 (D23-4).** The named misconception rides as a normal L1
  `propose_hint`/`HintCard` body — no new `TacticalMove`, no menu/openaiClient
  lockstep edit (the contrarian win the plan called out).
- **circuitModel NOR (D23-3) — skipped deliberately.** L4 content is authored on
  truth-table targets (incl. a `A NOR B` truth-table item); no L4 item mounts a NOR
  *circuit*, so `apps/web/src/canvas/circuitModel.ts` needs no change. (The frozen
  contracts already widened `GateKind` to include NAND/NOR anyway.)
- **AC#5 already satisfied by the frozen seed.** `seed_data/transfer_items.json`
  carries `L4-07-halfway` (`NOT (A AND B OR C)`), a held-out halfway-form probe.
- **AC#6 (LangSmith ≥90%).** Offline labels in `scenarios.json` (heuristic agrees on
  every one) gate MRs; the live ≥90% LLM-judge half runs only on a protected/manual
  job (MR pipelines are offline-only). New L4 labels: session-start, halfway→`propose_hint`,
  correct→advance, wrong-not-halfway→rephrase, composite trap, on-topic question.
- **QA (real running agent, dev seams on, lesson bound via `?lesson=4`):**
  `POST /api/session` → `201`; `session_start` mounted `TruthTablePractice` for
  `NOT (A AND B)` (L4 opens on De Morgan — AC#1/#2); a halfway submit (column
  `[1,0,0,0]`) returned a `HintCard` (level 1) naming the misconception ("you flipped
  the negation but didn't flip the operator … change the AND to OR") — AC#3; a
  correct submit (`[1,1,1,0]`) mounted the next practice item, **no HintCard** (zero
  false positive on the wire).

(Build-sequence checkboxes ticked in the "Build sequence (test-first)" list below.)

---

## Build plan (approved)

**Planned:** 2026-05-29 (kmaz-plan-iteration, one opus pass: architect/reuse/contrarian) · **Manifest:** [BUILD-PLAN-i6-stretch](../BUILD-PLAN-i6-stretch.md) · **Build tier:** Opus (novel misconception-detector logic + locked-package edit), Sonnet for lesson-data authoring.

> **Cross-cutting decision D-A (Keith, 2026-05-29):** NOR is a real `@polymath/booleans` primitive (additive infix token at OR-precedence), consistent with NAND in F-22. **F-23 rebases on F-22's grammar change** — both edit the same `packages/booleans/src/index.ts` parser regions (NAND vs NOR), so build the NOR diff *on top of* F-22's NAND diff, not in a parallel branch; re-run the full booleans suite after the combined change.
>
> **Decision D23-1 (planner, approved): the misconception is matched SEMANTICALLY, never by string/regex.** The spec's AC#3 example string is ambiguous; the detector computes the "halfway" expression (negation pushed in over operands **without** dualizing the connective: `NOT(A op B) → (NOT A) op (NOT B)`, `op` unchanged) and compares truth tables via `equivalent()`. This is load-bearing for **zero false positives** across the items' many spellings. **Reuse `propose_hint`** — no new `TacticalMove`, no menu/openaiClient lockstep edit.

### Summary
Adds Lesson 4 (De Morgan's law) as pure data (`lessons/4/`), adds NOR as a strictly-additive infix primitive in `@polymath/booleans` (on top of F-22's NAND), and introduces Polymath's first misconception detector: a pure, semantic (truth-table) matcher that recognizes the "halfway De Morgan" form and surfaces a *named* targeted hint via the existing `propose_hint`/`HintCard` path — no new TacticalMove, no statechart/server changes (the L3→L4 advance reflex is already generic).

### Files to create
- `lessons/4/content.json` — 12 items, tiers 1–4, ≥4 halfway-trap targets (`NOT(A AND B)`/`NOT(A OR B)` + composites), KCs `["de_morgan","negation"]`, truthTables computed via booleans.
- `lessons/4/mastery_config.json` — copy `lessons/2/mastery_config.json`.
- `lessons/4/kc_vocabulary.json` — De Morgan vocab.
- `lessons/4/misconceptions.json` — declarative per-item data: `{ items: [{ itemId, halfwayTruthTable:(0|1)[], hintBody }] }` (named-hint copy lives here).
- `apps/agent/src/hints/misconceptions.ts` — `detectHalfwayMisconception(targetExpression, submission): boolean` (pure, semantic, var-capped) + `loadMisconceptions(lessonId)` + `halfwayHintFor(itemId, lesson): string|null`.
- `apps/agent/src/hints/misconceptions.test.ts`.

### Files to modify
- `packages/booleans/src/index.ts` — **NOR primitive (additive, on top of F-22 NAND):** `Token` `{type:'nor'}`, `KEYWORDS.NOR`, `Ast` `{kind:'nor';left;right}`, parser arm at OR-precedence (left-assoc), `evaluate` `!(l||r)`, `variables` walk, `astToExpression` `A NOR B`. **Leave the pseudo-grammar untouched** (D23-2) unless an L4 pseudocode item needs NOR.
- `packages/booleans/src/scoreEquivalence.ts` — verify NOR flows through (add a test).
- `apps/agent/src/hints/templates.ts` — add `L4_DEMORGAN_HINT` (names the misconception); falls back to `misconceptions.json` per-item copy.
- `apps/agent/src/agent/stubClient.ts` — in the wrong-`submit` branch, before `rephrase`, call `detectHalfwayMisconception`; if true return `propose_hint` with the named body. (Shared file with F-22 — append-only.)
- `apps/web/src/canvas/circuitModel.ts` — **only if** an L4 circuit item allows NOR: add NOR to `GateKind`/`buildCircuit`/`pulseSchedule` (mirror F-22's NAND pattern). Prefer authoring L4 circuit items on AND/OR/NOT to avoid this (D23-3).
- L4 eval scenario fixtures (offline labels half + live ≥90% half protected/manual).
- `packages/statechart` test — `createLessonMachine({lessonId:4})` factory test.

### Build sequence (test-first)
- [x] **(NOR test-first)** `equivalent("NOT (A AND B)","(NOT A) OR (NOT B)")===true`; `equivalent("A NOR B","NOT (A OR B)")===true`; `truthTable("A NOR B").out` MSB-first; `astToExpression(parse("A NOR B"))` round-trips. Run red.
- [x] Implement NOR in `packages/booleans/src/index.ts` (Token, KEYWORDS, Ast, parser arm at OR-precedence, evaluate, variables, astToExpression). Green. Re-run the full booleans suite (F-22 NAND + NOR together).
- [x] `scoreEquivalence` NOR test; fix only if needed.
- [x] `createLessonMachine({lessonId:4})` statechart test (phase shape reused, id `lesson_4`).
- [x] **(detector test-first)** `misconceptions.test.ts`: each authored halfway form → `true`; the correct De Morgan form, the original `NOT(A op B)`, and unrelated-wrong answers → `false`; over-cap input → `false` (no enumeration). Run red.
- [x] Implement `apps/agent/src/hints/misconceptions.ts`: compute the un-dualized pushdown of the target's outer `NOT(op)`, compare the learner's submission truth table to the halfway table via `equivalent()`/`truthTable()` **with the distinct-variable cap**; **guard: never flag an answer `equivalent()` to the target.** Green.
- [x] Author `lessons/4/{content,mastery_config,kc_vocabulary,misconceptions}.json`; compute all truthTables (incl. the per-item halfway tables) via scratch booleans calls.
- [x] `loadLesson(4)` validation test (recompute must not throw; halfway tables recomputed in the test too).
- [x] Add `L4_DEMORGAN_HINT` to `templates.ts`.
- [x] Wire `stubClient.ts` wrong-submit branch: misconception → `propose_hint` (named body) before `rephrase`. Test: a halfway submit yields a HintCard naming the misconception.
- [x] (If any L4 circuit item allows NOR) add NOR to `circuitModel.ts` + buildCircuit/pulse test. Else skip.
- [x] LangSmith eval: offline label assertion gates MRs; live ≥90% LLM-judge half protected/manual-only.
- [x] `pnpm typecheck && pnpm test`.

### Contracts touched
- **`@polymath/booleans`** — ADDITIVE: `Ast` `{kind:'nor';…}`, `Token` `{type:'nor'}`, `KEYWORDS.NOR`. Locked signatures unchanged. **Shared with F-22 (NAND) — F-23 rebases on F-22.**
- **Lesson config JSON** — new data only; existing locked Zod (`packages/contract/src/lessonConfig.ts`). No schema change.
- **`misconceptions.json`** — NEW lesson-adjacent file; small Zod schema in `apps/agent` (NOT in `@polymath/contract`): `{ items: { itemId; halfwayTruthTable:(0|1)[]; hintBody }[] }`.
- **Agent menu / `TacticalMove` / `HintCard`** — **UNCHANGED** (reuse `propose_hint`; the named hint rides as a normal L1 body). This is the contrarian win — no two-place lockstep edit.
- **COLLISION with F-22:** `packages/booleans/src/index.ts` and `apps/agent/src/agent/stubClient.ts` (+ possibly `circuitModel.ts`). Serialize — F-22 first.

### Tests → AC
- NOR unit + De Morgan equivalence → **AC#4**.
- `createLessonMachine({lessonId:4})` + `loadLesson(4)` → **AC#1, AC#2**.
- Misconception detector (halfway→named hint; correct/original/unrelated→no flag; over-cap→no enumeration) → **AC#3** + "zero false positives".
- `stubClient` wrong-submit-halfway → `propose_hint` naming the misconception → **AC#3**.
- Transfer probe uses the pre-seeded L4 bank → **AC#5** (verify a seed row is the halfway form; flag the gap if not).
- LangSmith eval (offline gates MR; live ≥90% protected) → **AC#6**.

### Risks / open decisions
- **D23-1 — semantic (not string) misconception match.** RECOMMENDED & approved (see banner). Load-bearing for zero false positives.
- **D23-2 — NOR in the pseudocode grammar?** RECOMMENDED: **no** — leave `parsePseudocode`/`PSEUDO_KEYWORDS` untouched, author L4 pseudocode without NOR. Smaller blast radius.
- **D23-3 — NOR in the web circuit?** RECOMMENDED: keep L4 circuit items on AND/OR/NOT; if NOR is needed, mirror F-22's first-class `GateKind` pattern. Decide at authoring time.
- **D23-4 — hint level for the named misconception.** RECOMMENDED: **L1** (directional). Confirm it counts via the existing `hintsByItem` ladder.
- **Integrity/DoS (must-not-miss):** the detector calls `truthTable()`/`equivalent()` on learner-controlled `ev.submission` — it **must** apply the distinct-variable cap (over-cap = not-a-match, never enumerate).
- **Fail-closed:** missing/un-loadable `misconceptions.json` → detector returns false (degrade to `rephrase`), never throws at boot. `lessons/4/` is picked up by the existing `lessons` Docker COPY.
- **AC#5 seed check:** confirm the pre-seeded L4 transfer rows include a halfway-form challenge; author it into `seed_data/transfer_items.json` if missing.

### Dependencies & DAG position
- **Depends on F-22** — pedagogically (L3 unlocks L4; `loadLessonIfExists(3)` must chain) AND mechanically (shared `packages/booleans/src/index.ts` + `stubClient.ts` + possibly `circuitModel.ts`; serialize, F-22 first).
- **Unblocks F-26** (L5 playground needs the full NAND/NOR vocabulary).
- **No dependency on F-18/F-24/F-25.** Zero file overlap with F-25.
