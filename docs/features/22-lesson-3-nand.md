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
