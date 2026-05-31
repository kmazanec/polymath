# Feature: Tablet-first touch UI + locked flow skeleton

**ID:** F-31 · **Iteration:** I7 · **Status:** Not started

## What this delivers (before → after)
**Before:** The UI assumes mouse/keyboard with desktop-sized controls; there is no orientation showing where the learner is in the lesson arc.
**After:** Every interaction is touch-native (toggle, drag gates, wire, edit, press, advance) with finger-sized targets on a tablet, and a fixed sidebar **flow skeleton** shows the locked lesson phases with the learner's current position highlighted — orientation without implying a linear content path.

## How it fits the roadmap
I7 feature realizing the touch posture of [ADR-016](../adrs/ADR-016-spoken-turns-and-tablet-touch.md) and the flow-skeleton clause of [ADR-015](../adrs/ADR-015-coherent-learning-surface-transcript.md). Best sequenced alongside / after F-27 (the surface it makes touch-friendly).

## Requirements traced (from the PRD)
The tablet-first / touch-native direction (ADR-016, superseding ADR-004's mouse-primary clause); ADR-012's accessibility posture extended with a pointer/target-size standard; the brief's "No Choice Paralysis" orientation requirement (the flow skeleton answers "where am I in the arc").

## Dependencies (must exist before this starts)
- Soft: F-27 (coherent surface) — the workspace + transcript are what get made touch-native and what the skeleton sits beside. F-31 builds against the frozen surface. (Not a hard consume-unshipped-behavior dep; can overlap.)

## Unblocks (what waits on this)
- None within I7.

## Contracts touched
- **Touch design contract (44px target floor + touch-native drag)** (source of truth: **ADR-016**, extends ADR-012) — a NEW cross-cutting UI contract enforced across every interactive component (truth table, react-flow circuit canvas, pseudocode editor, forward affordances). Introduced here.
- **Statechart spine / `PhaseName`** (source of truth: ADR-003) — the flow skeleton **reads** `LESSON_PHASES` / the live phase; it does not add a phase or reshape the spine (view-only consumer).
- **Learning surface** (source of truth: ADR-015) — the skeleton is part of the surface layout.

## Acceptance criteria (product behavior)
1. On a tablet, every interactive control is operable by touch — toggling truth-table cells, dragging and wiring gates, editing pseudocode, pressing Test/Submit/continue, and the voice button.
2. All interactive targets meet a ≥44×44px touch-target floor with spacing that prevents adjacent mis-hits; the accessibility suite verifies target size.
3. Gate drag-and-drop works under touch (pointer events, finger-sized drag handles, generous hit-slop) — not just mouse.
4. A fixed sidebar flow skeleton renders the locked lesson phases (`introducing → practicing → {hint, transferring} → assessed → mastered`), highlighting the current phase and marking completed ones; the rail is stable even though the path through it is non-deterministic.
5. The skeleton reflects the real spine phase (reads the live `PhaseName`), updating as the learner moves through the lesson.
6. Existing mouse/keyboard operation is unaffected (touch is added, not substituted); reduced-motion and contrast posture (ADR-012) still hold.

## Testing requirements
- Unit/component: target-size assertions on interactive controls; the flow skeleton renders all locked phases and highlights the live one; touch/pointer-event drag on the circuit canvas.
- Accessibility (axe suite extended): WCAG 2.5.5 target-size; the skeleton is a semantic, non-misleading orientation region.
- **Live tablet drive (required):** drive a lesson on a real/emulated tablet (the Playwright/chrome-devtools MCP can emulate a touch viewport) — drag a gate by touch, toggle cells, advance, and confirm the flow skeleton tracks the phase. The composition break that motivated I7 was invisible to jsdom; the touch flow must be seen.

## Manual setup required
A tablet (or emulated touch viewport) for the live drive. None for the keyless unit/component suites.

## Implementation notes (filled in by the building agent)
