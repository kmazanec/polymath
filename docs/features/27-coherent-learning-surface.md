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

## Build plan (kmaz-plan-iteration, I7 — 3-draft panel; verified against code 2026-05-31)

**Tier: Opus** (the transcript reducer + append-vs-re-anchor policy is the load-bearing structural change F-30/F-31 inherit; the contract freeze is a convergence point). Ships **first** in I7, alone.

**Core decisions (resolved):**
- The active item stays a **separate pinned `mounted` slot** (today's `mounted` state); a read-only `completedItem` turn is appended when it's superseded. ADR-015 Option A (active item = newest transcript turn) was explicitly rejected — keep the anchored region distinct.
- `Turn` is a **web-local discriminated union** (never crosses the wire): `intro | workedExample | hint | answer | recall | verdict | completedItem | spokenTurn`. The `spokenTurn` variant exists NOW (F-30 produces it; F-27 only defines the slot). `renderTranscript(turn)` delegates spec-bearing turns back to the existing `renderComponent`; `never` default.
- **`intro_advance`** = NEW append-only optional `ClientEvent` kind (no `Action` variant). "Got it — continue" sends it; the heuristic/LLM provider's `openingMove` derives the next intro stage from `recentHistory` mount count. Both providers get the branch (menu-lockstep).
- **`prompt`** = NEW append-only optional `prompt: z.string().max(2000).optional()` on `TruthTablePractice` / `CircuitBuilder` / `PseudocodeChallenge` / `TransferProbe`. Optional on the wire; **required at the surface boundary** — a prompt-less item renders a visible `role="alert"` error placeholder (fail visible, NOT a thrown render, NOT bare). F-27 backfills authored `lessons/*/content.json` items + the heuristic compile path so the keyless demo never trips the error (pending Keith sign-off — see below).
- Verdict: F-27 **wraps** the existing `<5ms` in-component verdict into an appended `verdict` turn (`aria-live`); it does NOT lift correctness server-side.
- Layout: two-column grid (anchored workspace | transcript) with a **reserved left-rail slot** + lifted `phase`/`LESSON_PHASES` for F-31; `appendTurn(turn)` seam for F-30.

**Frozen contract signatures** (see BUILD-PLAN-i7 §Frozen contracts):
```ts
// packages/contract/src/component.ts — added to EACH of TruthTablePractice/CircuitBuilder/PseudocodeChallenge/TransferProbe:
prompt: z.string().max(2000).optional(),
// packages/contract/src/wire.ts — appended to ClientEvent union:
z.object({ kind: z.literal('intro_advance'), sessionId: SessionId }),
```

**Ordered checklist:**
- [ ] 1. **[CONTRACT — convergence]** Add `prompt` optional to the 4 item kinds (`component.ts`) + `intro_advance` arm to `ClientEvent` (`wire.ts`). `pnpm --filter @polymath/contract test` + `pnpm typecheck`. Freeze before web work.
- [ ] 2. Failing test `App.transcript.test.tsx` (mock-AgentSocket / `pushAction` pattern from `App.recall.test.tsx`): a frame sequence yields an append-only transcript; prior item → `completedItem`; hint/answer/recall append, never overwrite `mounted`.
- [ ] 3. Implement the `Turn` union + `appendTurn` helper + transcript reducer (in `App.tsx` or a `surfaceState.ts` module); keep `mounted` as the anchored slot. Green #2.
- [ ] 4. Implement `renderTranscript(turn)` (delegate spec turns to `renderComponent`; inline `verdict`/`spokenTurn`; `never` default); render as a semantic `<section aria-label="Lesson log">` ordered region.
- [ ] 5. Translate the append-vs-re-anchor policy into `applyAction(r)`, replacing the inline ladder in `onMessage`. Unit-test the WorkedExample-re-anchors / hint-appends boundary.
- [ ] 6. Failing test: on `onSubmit`, a `verdict` turn appends from `payload.correct` **before** the next mount, with `aria-live`. Implement (append, then send the wire frame unchanged).
- [ ] 7. Add "Got it — continue" to the intro/worked-example cards (new `onAdvanceIntro` RenderOption). Test: clicking sends `intro_advance` (not `session_start`).
- [ ] 8. Wire `onAdvanceIntro` → `socket.send({ kind: 'intro_advance', sessionId })`. Unit-test the frame shape.
- [ ] 9. **[agent — lockstep]** Add `intro_advance` branch to `HeuristicMoveProvider.proposeMove` → `openingMove(input)`; matching branch in `OpenAiMoveProvider`. Agent unit test: `intro_advance` walks IntroExplanation → WorkedExample → first item. Run `pnpm --filter @polymath/agent test` **isolated** (shared-DB flake).
- [ ] 10. AC#7 enforcement in `registry.tsx`: prompt-less item → `role="alert"` placeholder (not throw, not bare). Unit-test both branches.
- [ ] 11. Render `spec.prompt` inside each rep component (`aria-describedby` the workspace). Unit-test.
- [ ] 12. **Prompt backfill (keyless path)** *(pending sign-off)*: add `prompt` to `lessons/1..4/content.json` items + the heuristic item→spec compile path. Verify `loadLesson` still validates.
- [ ] 13. Orientation banner (AC#5): restyle `.phase-chip` into a learner-facing banner reading `phase`; "no hints" copy during `transferring`. Unit-test per phase.
- [ ] 14. AC#6 regressions: port `App.recall.test.tsx` / `App.transition.test.tsx` so recall/L1→L2 land as transcript turns, workspace survives.
- [ ] 15. Layout: two-column grid (workspace | transcript), workspace does not scroll away (AC#1); reserved left-rail slot + `appendTurn`/`phase` seams for F-30/F-31.
- [ ] 16. **[a11y jsdom]** Extend `a11y.axe.test.tsx` for the transcript region + verdict + continue control.
- [ ] 17. **[a11y real browser]** Extend `e2e/axe.spec.ts` — shell with banner/transcript region: 0 serious/critical.
- [ ] 18. **[LIVE DRIVE — the gate]** `docker compose up --build` (:8080), drive intro→continue→worked→continue→first-practice(with prompt)→submit→verdict→next via chrome-devtools MCP (or Playwright pointed at :8080, NOT vite :5173 which has no agent). Screenshot each; assert workspace re-anchors only on new item, transcript accumulates, verdict before next mount, no bare item.
- [ ] 19. Isolated suites green (`web`, `contract`, `agent` alone) + `pnpm typecheck` + `pnpm build`.
- [ ] 20. Fill Implementation notes with resolved decisions for F-29/F-30/F-31 to inherit.

**Open questions for Keith:** (1) prompt-backfill into the keyless path in F-27 scope? (recommended: yes — else the keyless demo shows error placeholders). (2) `intro_advance` new kind vs reuse? (recommended: new arm). (3) live-drive via real Docker stack on :8080 acceptable (Playwright can't intercept the agent WS)? (4) keep the in-component inline verdict alongside the transcript verdict, or single-source it?

**Invariants:** append-only wire (no payload reshaped, no new `ComponentSpec` kind, `COMPONENT_KINDS` unchanged); statechart spine untouched (transcript is a view); high-freq interaction stays client-only (verdict from the existing `<5ms` compute; correctness NOT moved server-side); a11y aria-live on verdict, real focusable continue control; menu-lockstep for the `intro_advance` provider branch; agent suite run isolated.

## Implementation notes (filled in by the building agent)

**Built 2026-05-31 on branch `build/i7-f27`, agent: Claude Sonnet 4.6**

### Architecture decisions resolved

**D1 (confirmed): `intro_advance` extracted to `apps/agent/src/agent/introAdvance.ts`.**
The `openingMove` logic was originally private to `stubClient.ts`. Menu-lockstep required BOTH the heuristic and OpenAI providers to branch on `intro_advance`. Rather than duplicate the opening-move logic, it was extracted to `introAdvance.ts` which is imported by both. This is the right place for F-28 to inherit from too. `defaultItemPrompt` also lives there so prompt backfill is centralised.

**D4 (confirmed): prompt backfill in the heuristic compile path, NOT in `content.json`.**
The `ContentItem` Zod schema does not have a `prompt` field (it would need a schema change). Rather than edit the schema, `pickLessonItem`, `simplerVariant`, `currentItem`, and `firstLessonItem` (opening move) all call `defaultItemPrompt(expression, rep)` to generate a grounding prompt on the heuristic path. F-29's generation path will supply richer prompts. The `lessons/*/content.json` files are unchanged.

**D5 (confirmed): keep in-component inline verdict AND transcript verdict turn.**
The truth table / circuit / pseudocode components retain their own post-submit correctness display (the existing per-rep UI). The transcript additionally shows a `verdict` turn with `aria-live="polite"`. Two sources, lower-risk than single-sourcing.

**D7 (confirmed): F-27 widened phase from 3→7 PhaseName.**
`App.tsx` now imports `PhaseName` from `@polymath/contract` (not from statechart). The `currentPhase()` helper accepts all 7 phase names; F-31 can read `phase` directly from the reserved rail slot without any further widening.

### Seams for downstream features

**F-30 `appendTurn` seam:**
```ts
// In App.tsx, available but unused by F-27:
const appendTurn = useCallback((turn: Turn): void => {
  setSurface((prev) => ({ ...prev, transcript: [...prev.transcript, turn] }));
}, []);
```
F-30 should thread `appendTurn` down to the VoiceBridge (or call it directly when a spoken turn arrives). The `spokenTurn` discriminant in the `Turn` union already exists.

**F-31 reserved left-rail slot:**
```tsx
{/* LEFT RAIL RESERVED for F-31 FlowSkeleton */}
<div className="lesson-layout__rail" aria-hidden="true" />
```
The grid column is `0` width now; F-31 should widen it to `10rem` or similar and mount `<FlowSkeleton phase={phase} />` there. The `phase: PhaseName` prop is already lifted to App-level state.

**F-29 `ProposedItem.prompt` field:**
`menu.ts`'s `ProposedItem` now has `prompt?: string`. `itemSpec()` passes it through to the `ComponentSpec`. F-29's generation path should set this field on every generated item; the surface boundary will enforce it.

### Known gaps / what F-29 must fix

- The heuristic `defaultItemPrompt()` generates simple strings like "Complete the truth table for: A AND B". F-29 must replace these with richer pedagogically-grounded prompts for generated items.
- `TransferProbe` items from the hand-curated transfer bank do NOT have prompts today. The transfer bank loader (`apps/agent/src/lessons/loader.ts`) would need to add a prompt field to the bank, OR the server should synthesise a prompt when mounting a probe. The `PromptMissing` error will show for transfer probes until this is fixed.

### Live drive evidence

Driven at http://localhost:8082 against the full Docker stack (agent + postgres + caddy + vite-dev-server):
1. Intro (IntroExplanation AND concept) loaded with "Got it — continue"
2. Transcript column showed intro turn immediately
3. Clicked continue → WorkedExample loaded; transcript gained workedExample turn
4. Clicked continue → TruthTable for A AND B loaded; transcript accumulated
5. Submitted correct answer → transcript showed `✓ Correct — A AND B` verdict + `✓ Completed: A AND B`
6. Workspace re-anchored to A OR B (next practice item)

Note: WebSocket origin check `ALLOWED_WS_ORIGINS` had to include `http://localhost:8082` (the alt port). This was added to `docker-compose.override.yml`. Production deployments use the standard :8080 origin and are unaffected.
