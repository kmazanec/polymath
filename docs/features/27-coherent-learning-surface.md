# Feature: Coherent learning surface (anchored workspace + transcript)

**ID:** F-27 · **Iteration:** I7 · **Status:** Not started

## What this delivers (before → after)
**Before:** The web client renders the agent's output through a single mutable slot — every action overwrites the last, so there is no history, the intro has no "continue", a submit shows no verdict, and advances feel random.
**After:** The learner sees a stable anchored workspace (the current item never scrolls away) beside an append-only transcript of everything that happened (intro, worked example, hints, Q&A, explicit verdicts, completed items), with an always-present forward affordance and a learner-facing orientation banner — so at every moment they know what they're doing, what's next, why the surface changed, and whether they're practicing / being helped / being assessed.

## How it fits the roadmap
First feature of I7. It is purely a web-client (`apps/web`) re-architecture plus at most one append-only optional wire signal; it touches no agent decision logic, so it can ship and be driven live **before** the agentic rework (F-28/F-29) lands. It alone fixes every visible symptom that motivated I7.

## Requirements traced (from the PRD)
The brief's **"No Choice Paralysis"** requirements (learner always understands goal / next action / why-changed / practicing-vs-help-vs-assess-vs-advance) and the **"meaningful path from confusion to demonstrated ability"** core idea; the **counter-metric** "did learners understand why the interface changed / did the UI change too often."

## Dependencies (must exist before this starts)
None — builds on the shipped client and the frozen contracts. (The append-vs-re-anchor pattern generalizes the existing App-level hint/recall side slots.)

## Unblocks (what waits on this)
- F-29 (validator-gated generation) renders its generated items into this surface; cleaner to build generation once the surface coherently shows a sequence of items. (Soft — F-29 builds against the frozen surface, not its unshipped behavior.)

## Contracts touched
- **WebSocket message protocol** (source of truth: ADR-005 / ROADMAP wire contract; this feature: ADR-015) — adds **at most one append-only optional signal** to deterministically advance the opening intro sequence (e.g. an `intro_advance` client event) instead of relying on a re-emitted `session_start`. May add **one append-only optional `prompt` field** to the item-generating kinds (the grounding instruction; additive, no reshape). No existing payload reshaped.
- **Curated component registry (rendering)** (source of truth: ADR-005) — the transcript renders the **existing** `ComponentSpec` kinds; **no new kind added** (so the coordinated three-place change protocol is not triggered). The renderer **enforces prompt-on-every-challenge** (an item-bearing spec with no prompt is an error state, not a valid mount).
- **Learning surface** (source of truth: **ADR-015**) — introduces the anchored-workspace + transcript model, the append-vs-re-anchor policy, the locked flow-skeleton clause (rail rendered by F-31, reading the live phase), and that spoken turns (from F-30) are transcript turns.

## Acceptance criteria (product behavior)
1. The current active item (truth table / circuit / pseudocode / probe) stays pinned in a workspace region that does not scroll away; it re-anchors only when a *new active item* arrives.
2. Intros, worked examples, hints, Q&A answers, verdicts, and completed items accumulate in an ordered, persistent transcript and are never overwritten.
3. On submit, an explicit ✓/✗ verdict appears (rendered from the existing <5 ms client correctness compute) before the agent's next mount.
4. The intro and worked-example cards present a "Got it — continue" control that deterministically advances the opening sequence (no reliance on a stray `session_start`); a fresh-session learner can reach the first practice item by clicking continue, with no random jumps.
5. A learner-facing orientation banner names the current mode (practicing / receiving help / being assessed); during a transfer probe it makes clear hints are withheld.
6. The L1→L2 re-instantiation and the existing hint/recall/answer side behavior still work (they become part of the transcript model).
7. **No item-bearing surface renders without a grounding prompt** — a truth table / circuit / pseudocode / probe mounted with no instruction/question is treated as an error, never shown bare (the surface-boundary half of ADR-015's prompt-on-every-challenge rule; the generation half is F-29).
8. The transcript model accommodates **spoken turns** (F-30) and a **flow-skeleton** region (F-31) without structural change — both are turns/views over the same data model.

## Testing requirements
- Unit/component (vitest + testing-library): the transcript appends rather than overwrites; the workspace re-anchors only on a new active item; the verdict renders on submit; the continue affordance advances the opening sequence; the orientation banner reflects phase.
- Accessibility (existing axe suite extended): the transcript is a semantic region, the verdict is announced via aria-live, the forward affordance is a real focusable control.
- **Live browser drive (required, not optional):** run the stack and drive intro → continue → worked example → continue → first practice → submit → verdict → next, screenshotting each step. This is the gate the prior unit-only verification missed — the break was in composition, which jsdom does not see.

## Manual setup required
None for the keyless flow. (A live drive uses the local Docker stack per CLAUDE.md commands.)

## Implementation notes (filled in by the building agent)
