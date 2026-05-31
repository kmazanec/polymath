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

## Build plan (kmaz-plan-iteration, I7 — one opus pass; verified against code 2026-05-31)

**Tier: Sonnet** (architecture fully resolved; mechanical CSS + one view component + Playwright specs). Escalate to Opus only if the F-27 coordination (item 0) reveals no usable reserved rail slot. Builds against the **frozen F-27 surface**.

**Verified reality (the spec underplays how far along this is):**
- `.btn` ALREADY declares `min-height: 2.75rem /* 44px */` (global.css:174); `.truth-table-output-cell` is ALREADY `2.75rem × 2.75rem`. The voice button, Submit, continue affordances are all `.btn` → already pass the floor. **The real gaps are narrow:** (1) no `min-width` on `.btn`/cells; (2) the **react-flow `.react-flow__handle`** wire dots are library-default ~6–8px — finger-impossible; (3) "44px" is a scattered magic literal that will drift; (4) `@xyflow/react ^12` already drags via pointer events — the gap is target SIZE + `touch-action`, NOT a config flag.

**Core decisions (resolved):**
- **44px enforcement = token + real-browser test.** Add `--touch-target-min: 2.75rem` to `tokens.css`; `.btn`/cells reference it; a `.touch-target` utility for the few non-`.btn` controls (truth-table cell, gate-palette button). **The size assertion MUST be a real-browser Playwright `boundingBox()` check** — jsdom `getBoundingClientRect()` returns 0, so a jsdom size test is a silent false-green and is FORBIDDEN. jsdom gets structural assertions only.
- **react-flow touch = CSS, not config:** grow `.react-flow__handle` (14px visible + a `::before` ~44px transparent hit-slop); `touch-action: none` on the pane/nodes; verify `.rf-node--io` clears 44px tall. Confirm `nodesDraggable` under touch in the live drive (assert, don't configure).
- **Flow skeleton widens phase exposure (view-only):** `currentPhase()` (App.tsx:82) today narrows the XState snapshot to **3 of 7** `PhaseName`s — a rail can't honestly show `hint`/`assessed`/`mastered`/`remediating`. F-31 widens `currentPhase`/`setPhase`/`phase` to the full `PhaseName` (stops DISCARDING state App already holds in `snapshot.value`; **no spine edit, no contract edit** — `PhaseName`/`LESSON_PHASES` already exist and are cross-checked). **Coordinate with F-27** — if F-27 already lifts the full enum into the reserved seam, F-31 just consumes it.
- **Rail = curated mainline + branches, NOT a flat 7-list / progressbar.** AC#4's display omits `remediating` and brackets `hint`/`transferring` as branches. Render a mainline (`introducing → practicing → assessed → mastered`) with `hint`/`transferring`/`remediating` as branch markers; "completed" = **furthest-mainline-phase reached (monotonic)**, not index (a `hint`→`practicing` dip mustn't un-complete `practicing`). Semantics: `<nav aria-label>` + `role="list"` + `aria-current="step"` on live; **NEVER `role="progressbar"`**, no "N of 7" (it would imply a linear path, contradicting ADR-015).
- Reduced-motion + contrast (ADR-012) hold (highlight routes through the existing `@media (prefers-reduced-motion)` block); touch is ADDED not substituted (AC#6).

**Frozen artifacts** (see BUILD-PLAN-i7 §Frozen contracts): `--touch-target-min: 2.75rem` token; `.touch-target` utility; `.react-flow__handle` hit-slop CSS; `FlowSkeleton(props: { phase: PhaseName; phases?: readonly PhaseName[] })`; the `currentPhase → PhaseName` widening; a `tablet` Playwright project.

**Ordered checklist (Track A touch · Track B skeleton; ⚠ collision):**
- [ ] 0. **[coordination — blocks B]** Confirm with the F-27 build: does F-27 lift the FULL `PhaseName` into the reserved rail seam, or the 3-way narrow? Confirm the slot API.
- [ ] 1. **[A]** `--touch-target-min: 2.75rem` in `tokens.css`.
- [ ] 2. **[A]** `.btn min-height` → `var(--touch-target-min)`; add `.touch-target` utility (drop magic-number comments).
- [ ] 3. **[A]** ⚠ `circuit.css`: enlarge `.react-flow__handle` (14px + `::before` 44px hit-slop); `touch-action: none` on pane/nodes; bump `.rf-node--io` to clear 44px tall.
- [ ] 4. **[A]** ⚠ `.circuit-palette button`: add `min-width: var(--touch-target-min)`.
- [ ] 5. **[A]** Confirm `.truth-table-output-cell` keeps 44×44 + adjacent spacing prevents mis-hits (AC#2).
- [ ] 6. **[A]** Confirm CodeMirror editor is tap-focusable (verify in drive; no gesture change).
- [ ] 7. **[A]** Confirm `AskTutorButton` + continue/hint affordances meet the floor (already `.btn`).
- [ ] 8. **[B]** 📄 Widen phase exposure in App.tsx → full `PhaseName` (view-only). ⚠ shared with F-27 (item 0 resolves ownership).
- [ ] 9. **[B]** Build `FlowSkeleton.tsx` — reads `LESSON_PHASES` + live `phase`; curated mainline+branch display; `<nav>`/`role="list"`/`aria-current`; monotonic completed; **never `role="progressbar"`**.
- [ ] 10. **[B]** ⚠⚠ Mount `FlowSkeleton` into F-27's **reserved left-rail slot** (against the frozen layout, not a new grid). Highest App.tsx collision.
- [ ] 11. **[B]** Rail CSS: highlight via existing tokens; transition gated by the existing reduced-motion block.
- [ ] 12. **[A+B]** `FlowSkeleton.test.tsx` (jsdom): renders all locked phases; live has `aria-current`; **no `role="progressbar"`, no "N of 7"**. STRUCTURAL ONLY — no size assertions.
- [ ] 13. **[A]** Extend `e2e/axe.spec.ts`: WCAG 2.5.5 target-size; rail is a non-misleading orientation region (0 serious/critical).
- [ ] 14. **[A+B]** ⚠ Add a `tablet` project to `playwright.config.ts`.
- [ ] 15. **[A+B]** New `e2e/touch.spec.ts` (the required live drive): every control `boundingBox()` ≥ 44×44; drag a gate by touch; tap a cell; advance; assert `FlowSkeleton` `aria-current` tracks the phase. **The only real size assertion.**
- [ ] 16. **[final]** `pnpm --filter @polymath/web test` (jsdom) + `playwright test` (both projects); reduced-motion + contrast unchanged; fix only what the size test catches.

**Open questions for Keith:** (1) rail = all 7 phases flat, or curated mainline+branches? (recommended: curated — matches AC#4 + ADR-015's non-linear thesis). (2) who widens phase exposure — F-27 or F-31? (confirm F-27's frozen seam). (3) touch Playwright project = `devices['iPad Pro']` (faithful) vs `{...Desktop Chrome, hasTouch:true}` (lighter)? (4) confirm "completed" = furthest-mainline-phase-reached (monotonic).

**Invariants:** `visibleReps` honored (only sizing/CSS + rail touched); spine untouched — rail is view-only (widening stops discarding state, doesn't write the spine); reduced-motion + contrast hold; touch ADDED not substituted; ≥44×44 WCAG 2.5.5 enforced by token + utility + an enumerating test; the size assertion is real-browser, NEVER jsdom; rail is a non-misleading orientation region (never `role="progressbar"`).

## Implementation notes (filled in by the building agent)
