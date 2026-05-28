# Feature: Lesson 2 — Composition (combining operators; XOR as composition)

**ID:** F-13 · **Iteration:** I3 — Lesson 2 + cross-lesson recall · **Status:** Not started

## What this delivers (before → after)

**Before:** Only Lesson 1 exists. The architecture's claim that the statechart + inner agent extends across lessons is unproven beyond a single lesson.

**After:** Lesson 2 is loaded as a sub-statechart parameterised on the lesson_1 spine. Its content (composition expressions like `(A AND B) OR (NOT C)`, XOR-as-composition introduction) lives in `lessons/2/content.json`. Its KC vocabulary, hint templates, and mastery config live in `lessons/2/`. Transfer items come pre-seeded from F-08. The agent menu operates unchanged — the same `next_item`/`hint`/`transfer`/`alt_rep` actions work on L2 content because the architecture was designed for this.

After F-13 merges, a learner who has *not* completed L1 cannot reach L2 (gated by the statechart). A learner who has completed L1 (with F-15 in place) can run an L2 session.

## How it fits the roadmap

I3, **on the critical path**. Concurrent with F-14 (cross-lesson recall). Merge sink is F-15 (the lesson transition).

## Dependencies (must exist before this starts)

- **F-08** — L2 transfer items already in the bank.
- **F-12** — full mastery gate works on L1 (and by parameterisation, on L2).

## Unblocks (what waits on this)

- **F-14** — recall component needs to know L1 KCs in the context of an L2 item.
- **F-15** — L1→L2 transition.

## Contracts touched

- **Lesson config JSON** — `lessons/2/mastery_config.json` and `lessons/2/content.json` introduced. Directory-scoped ownership; no other feature edits these.
- **KC vocabulary** — `lessons/2/kc_vocabulary.json`.
- **Hint templates** — `lessons/2/hint_templates.json` extending F-06's L1 templates.
- **Statechart spine** — adds a lesson_2 sub-statechart parameterised on the lesson template. The macro statechart's `lesson_1 | lesson_2` enumeration is extended.
- **`packages/booleans`** — no change. AND/OR/NOT + their composition is already supported. XOR is introduced *as a composition* (`A XOR B ≡ (A AND NOT B) OR (NOT A AND B)`), not as a primitive gate.
- **`ComponentSpec`** — `LessonIntro.lessonId: 1 | 2` extended to include 2 — already in F-01's schema as `1 | 2 | 3 | 4`.

## Sub-tasks

1. **T-13a — Author L2 content** `[parallel]`
   - `lessons/2/content.json` with ~12 practice items across 4 difficulty tiers, covering composition and XOR-as-composition.
   - L2 LessonIntro body + IntroExplanation drafts.
2. **T-13b — Lesson_2 sub-statechart** `[parallel after T-13a]`
   - Parameterise the lesson template from `packages/statechart`; instantiate with lesson_2 config.
3. **T-13c — L2 hint templates + KC vocabulary** `[parallel]`
4. **T-13d — L2 mastery config** `[parallel]`
   - `lessons/2/mastery_config.json` — initial values match L1 with a slightly higher difficulty band.
5. **T-13e — Eval scenarios for L2-specific agent behavior** `[parallel]`
   - LangSmith scenarios: XOR-as-composition misconception detection, composition-depth hint selection.
6. **T-13f — Tests** `[parallel]`

## Acceptance criteria (product behavior)

1. **A learner entering L2 sees a `LessonIntro` for "Lesson 2 — Composition"** with the body from `lessons/2/content.json`.
2. **The first L2 practice item presents `(A AND B) OR (NOT C)` in one of the three reps** with the other two visible (per the cross-rep gym thesis).
3. **The XOR-as-composition introduction** is a `WorkedExample` mounted by the agent at the right point in L2's progression — the agent's `next_item` selection logic surfaces this.
4. **A learner submitting `(A AND NOT B) OR (NOT A AND B)` as equivalent to `A XOR B`** is marked correct (proving `packages/booleans` handles the composition without needing XOR as a primitive).
5. **L2 mastery requires** the same 4 conditions as L1 but evaluated against L2's KCs.
6. **The agent's bounded menu is unchanged** — no new Action variants needed for L2.
7. **LangSmith eval suite for L2 scenarios passes at ≥95%**.
8. **Pressing the "continue to Lesson 2" affordance on `MasteryCelebration` (F-12) does NOT transition** until F-15 lands; for F-13 standalone, L2 is reachable via a dev-only `?lesson=2` URL parameter.

## Testing requirements

- Schema validation for `lessons/2/*.json` against the locked shapes.
- Statechart test: lesson_2's intra-lesson phases match the parameterised template.
- Integration test: drive an L2 session through to mastery (via a test seam that bypasses L1).
- LangSmith eval for L2-specific scenarios.

## Manual setup required

- **Author the 12 L2 practice items** — ~1 day of Keith's time. Schedulable to before I3 starts (parallel with I2 implementation).
- **Author L2 hint templates** — ~half day.

## Convergence and expected rework

⚠ **Statechart spine parameterisation** — F-13 is the first time the lesson template gets instantiated with non-L1 config. If the template needs refactoring, that refactoring happens in F-13's PR (not F-22/F-23 later). Strategy: validate the template works for L2 first; F-22/F-23 then have a proven pattern.

⚠ **F-13 is concurrent with F-14.** F-14 extends the agent menu with `recall_lesson1_kc`; F-13 does not touch the menu. Zero file overlap.

⚠ **F-13 is concurrent with the entire I4 iteration** (chat-baseline app). Confirm zero file overlap — verified: I4 touches `apps/baseline/`, F-13 touches `lessons/2/` + statechart. Clean.

## Implementation notes (filled in by the building agent)

> Empty.
