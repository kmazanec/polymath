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

> Empty.
