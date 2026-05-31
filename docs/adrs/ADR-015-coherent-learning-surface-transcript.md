# ADR-015: The learning surface is an anchored workspace + an append-only transcript, with an always-present forward affordance and explicit verdicts — not a single overwriting mount slot

**Status:** Accepted · **Date:** 2026-05-31 (amended 2026-05-31 — spoken turns, flow skeleton, prompt-on-every-challenge) · **Stretch:** no
**Supersedes:** none · **Refines:** [ADR-005](./ADR-005-adaptive-ui-runtime-contract.md), [ADR-008](./ADR-008-frontend-and-client-architecture.md) · **Related:** [ADR-016](./ADR-016-spoken-turns-and-tablet-touch.md) (spoken turns + touch) · **Superseded by:** none
**Contract:** yes — extends the WebSocket message protocol with at most one append-only optional signal; the transcript renders existing `ComponentSpec` kinds. The "every challenge carries a prompt" rule may add **one append-only optional `prompt` field** to the item-generating kinds (additive, never reshapes an existing payload); no new kind required.

## Context

The shipped client (`apps/web/src/App.tsx`) renders the agent's output through a **single mutable slot**: `const [mounted, setMounted] = useState<ComponentSpec>(…)`. Every agent action *overwrites* it. Driving a real lesson exposes four failures, each a direct consequence of that data model — and each a violation of the brief's **"No Choice Paralysis"** requirement that *at every moment the learner understands what they're trying to accomplish, what they can do next, why the interface changed, and whether they're practicing / receiving help / being assessed / moving forward*:

1. **No history / no continuity.** A single slot cannot show a path; the intro is stomped by the Q&A answer, which is stomped by the first item. The brief asks for *"a meaningful path from confusion to demonstrated ability,"* which a slot structurally cannot represent.
2. **No forward affordance in the opening sequence.** The intro → worked-example → first-item sequence advances only when *another `session_start` fires* (the stage is derived from prior-mount count); in normal use the learner is stranded on the intro with no "continue," and incidental re-sends make advances feel random.
3. **No visible verdict on submit.** Correctness is computed client-side in <5 ms (correct, by [ADR-005](./ADR-005-adaptive-ui-runtime-contract.md)'s deterministic-client boundary) but nothing renders it; the next mount silently replaces the table, so "submit does nothing, then another appears."
4. **No orientation.** The only phase signal is a debug chip.

[ADR-008](./ADR-008-frontend-and-client-architecture.md) committed to React + the statechart-driven render; it did not specify the *shape of the learning surface*. This ADR does.

## Decision

**The learning surface is two regions over one append-only data model: a stable anchored workspace + a transcript ("lesson log").**

- **Anchored workspace** — the *current* active item (truth table / circuit / pseudocode / probe) is pinned in a primary region that does **not** scroll away and re-anchors **only** when a new active item arrives. This is the brief's *"keep a key visual stable while changing the surrounding guidance."*
- **Transcript (append-only)** — intros, worked examples, hints, Q&A answers, **explicit verdicts**, and completed items accumulate in an ordered, persistent list beside/below the workspace. The agent's actions **append a turn**; they do not overwrite. This is the structural fix for "no history."
- **Always-present forward affordance** — every state offers one obvious next action: the intro/worked-example cards carry **"Got it — continue"** (deterministically advancing the opening sequence rather than relying on a stray `session_start`); practice carries Submit; a verdict carries Next; an agent response lands in the log without yanking the workspace.
- **Explicit verdict turn** — on submit, the client's <5 ms correctness result renders as a verdict turn ("Correct — A AND B is true only when both inputs are 1") *before* the agent's next mount arrives.
- **Orientation banner** — the phase chip becomes a small learner-facing status ("You're practicing" / "This is a check — no hints" / "You're being assessed").
- **Spoken turns are first-class transcript turns.** The student's spoken response (captured + transcribed server-side — see [ADR-016](./ADR-016-spoken-turns-and-tablet-touch.md)) and the tutor's text reply both render as turns in the transcript, interleaved with the rest. The conversation the learner can scroll back through is the *whole* tutoring conversation — spoken and typed alike — not just the practice items.
- **A locked flow skeleton orients the non-deterministic path.** The sidebar renders the *locked* lesson phases (the `PhaseName` spine: `introducing → practicing → {hint, transferring} → assessed → mastered`) as a fixed rail, highlighting the learner's **current** phase and marking completed ones. The *path* through the phases is non-deterministic (the agent decides what to do next), but the *phases themselves are fixed before the lesson begins* — so the rail gives orientation ("where am I in the arc") without implying a linear content path. It reads the real phase the spine already exposes; it does not introduce a new phase or reshape the spine.
- **Every challenge carries a prompt.** No item-bearing surface (truth table / circuit / pseudocode / probe) is ever mounted *bare*. Each carries an explicit instruction or question grounding what is being asked ("Fill in the OUTPUT column for `A AND B`", "Build a circuit equivalent to `NOT(A OR B)`"). A naked workspace with no framing is a defect — the learner must always know what the surface is asking of them. This is enforced at the surface boundary (a mounted item without a prompt is an error, not a valid state).

**Policy: what appends vs. what re-anchors.** A new *active item* (practice item, transfer probe, intro/worked-example card the learner is acting on) re-anchors the workspace and is also logged. A hint, a Q&A answer (text or spoken-then-answered), a cross-lesson recall, a verdict, a spoken-turn transcript entry, and a completed item **only append** to the transcript — they never replace the workspace. (This generalizes the existing side-slot treatment of hint/recall in `App.tsx`, which was already correct for exactly this reason.)

## Options considered

**A — Pure chronological transcript** (everything, including the active item, is the newest turn at the bottom of one scroll). Simpler; closest to "chat with embedded tools." *Rejected* as the primary model: the active item scrolls away, and the brief explicitly warns a strong submission is *not* "a chat app that occasionally swaps in a chart" — a pure timeline reads as exactly that, and loses the stable key-visual.

**B — Anchored workspace + transcript rail (chosen).** Orientation *and* history; the key visual never jumps; the learner always sees where they are and what they did. Directly satisfies all four "No Choice Paralysis" questions.

**C — Keep the single slot, add a separate "history" view.** *Rejected.* A history you have to navigate to is not continuity; the brief wants the path *present*, not archived.

## Consequences for the build

- **Source of truth:** `apps/web/src/App.tsx` (the transcript data model + the append-vs-re-anchor policy) and the surrounding view components. The render still goes through the locked `ComponentSpec` registry switch — the transcript renders the **existing** specs; **no new `ComponentSpec` kind is required** (the lean version), so the registry's coordinated-three-place change protocol is **not** triggered.
- **Wire-contract impact, minimized and append-only:** the opening sequence's "continue" needs a deterministic client-driven advance instead of leaning on a re-emitted `session_start`. This is satisfied by **at most one append-only optional signal** on the WebSocket protocol (e.g. an `intro_advance` client event, or reusing the existing request flow). **No existing event payload is reshaped** — consistent with the wire contract's append-only rule ([ADR-005](./ADR-005-adaptive-ui-runtime-contract.md) / the ROADMAP wire-protocol contract). The exact mechanism is a build decision in the I7 feature spec.
- **Prompt-on-every-challenge:** the item-generating `ComponentSpec` kinds gain an **append-only optional `prompt` field** (the grounding instruction/question). It is optional on the wire (existing senders still validate) but **required at the surface boundary** — the renderer treats a mounted item with no prompt as an error, and the agent (ADR-014 generation) always supplies one. This is additive; it does not reshape an existing payload and is not a new kind.
- **Flow skeleton reads the spine, doesn't extend it:** the sidebar rail renders `LESSON_PHASES` / the live `PhaseName` the statechart already exposes. It is a *view*, not a new phase — the locked spine is untouched. The non-deterministic path is exactly why a *fixed* rail (phases known up front) is the right orientation primitive.
- **Spoken turns in the transcript** are fed by the server-captured transcript seam from [ADR-016](./ADR-016-spoken-turns-and-tablet-touch.md); the surface renders them as turns but never *sources* a transcript from a client frame (the integrity boundary stays in ADR-016).
- **Invariants preserved:** high-frequency interaction stays client-only (the verdict is rendered from the existing <5 ms client compute — correctness does **not** move server-side); the statechart spine is untouched (the transcript is a *view* over the same phase, not a new phase); the L1→L2 re-instantiation and the App-level side slots (hint/recall/answer) survive — they were already the correct "append, don't overwrite" pattern and generalize into the transcript.
- **Accessibility ([ADR-012] posture):** the transcript is a semantic ordered region; the verdict is announced (aria-live); the forward affordance is a real focusable control. The existing axe suite extends to the new regions.

## Status note

Accepted as the architectural basis for the I7 learning-surface features. The implementing feature(s) are specified in ROADMAP.md under I7.
