# Feature: Hint ladder (3 levels, templated + free-form)

**ID:** F-06 · **Iteration:** I1 — Lesson 1 cross-rep gym · **Status:** Not started

## What this delivers (before → after)

**Before:** Learner cannot request a hint. There is no `Hint` button. The agent's bounded menu does not include hint emission.

**After:** A `Hint` affordance is visible during the `practicing` phase. Clicking it dispatches a `request_hint` WebSocket event; the agent emits a `mount` Action carrying a `HintCard` ComponentSpec with `level: 1 | 2 | 3`. Level 1 and 2 are templated (slot-filled from a typed enum, validated against the agent's `claimedTruthTable` for the item); Level 3 is free-form LLM-authored prose, logged with rationale and `validatorStatus: 'unverified_prose'` per [ADR-010](../adrs/ADR-010-content-correctness-and-validation.md). Re-requesting a hint advances to the next level; after L3, the affordance grays out. Hint usage is recorded in `learner_state` for the rule-gate (F-09) to consume.

## How it fits the roadmap

I1, concurrent with F-07 after F-05 lands the inner agent loop. **Off the critical path** — hints make the experience usable but are not gating any later feature directly. (F-09 *consumes* hint usage but does not need F-06 to ship: if F-09 lands before F-06, the hint-ratio metric starts at 0/N.) Cuttable if I1 capacity shrinks.

## Dependencies (must exist before this starts)

- **F-05** — agent menu + Action union are wired and extensible.

## Unblocks (what waits on this)

- **F-09** — hint ratio is one of the rule-gate's behavioral signals; F-09 consumes the `hintsUsed` count.

## Contracts touched

- **`Action` schema** — extends with `propose_hint(level: 1|2|3, target: ItemId)` or, equivalently, the agent emits a `mount` of `HintCard`. **Decision:** consolidate to `mount` of `HintCard` so the existing `mount` validator suffices; the `level` and `body` are properties of the ComponentSpec. No new Action variant required.
- **`ComponentSpec`** — `HintCard` variant already declared in F-01; F-06 implements its rendering. No schema change.
- **Curated component registry (rendering)** — adds the `HintCard` case to the switch.
- **Hint template library** — introduces `apps/agent/src/hints/templates.ts`: typed enums for `[GATE]`, `[STATE]`, `[VAR_*]`, `[BOOL]`, `[SUB_EXPRESSION]`, and template strings for L1/L2 per [ADR-010](../adrs/ADR-010-content-correctness-and-validation.md). Locked here; extended by F-22/F-23.
- **WebSocket message protocol** — adds `request_hint` event kind. Append-only.
- **Per-session event log** — gains `validation: { layer: 3, status: 'unverified_prose' | 'pass' }` field on L3 hint Actions. Schema for the field is locked here.

## Sub-tasks

1. **T-06a — Hint affordance in the UI** `[parallel]`
   - Button visible during `practicing` phase; disabled during transfer probes.
   - Click → `request_hint` WebSocket event with current item ID.
2. **T-06b — `HintCard` React component** `[parallel]`
   - Renders body text with level-appropriate styling (L1 small/light, L2 medium, L3 prominent).
   - Renderer switch case.
3. **T-06c — Agent hint subgraph** `[parallel after T-06a]`
   - LangGraph node: takes current item + previous hints + behavioral state; picks level based on prior hints used on this item; for L1/L2 selects template + fills slots; for L3 generates free-form prose with the model.
   - Slot-filled L1/L2 hints validated against `claimedTruthTable`: ensures the hint references the right `[GATE]`/`[STATE]`.
4. **T-06d — Logging extension** `[parallel]`
   - L3 hint Actions logged with `validatorStatus: 'unverified_prose'`.
5. **T-06e — Eval scenarios** `[parallel]`
   - Labelled L3 hint cases (good/bad) for LangSmith continuous eval.

## Acceptance criteria (product behavior)

1. **A visible `Hint` button is present during the `practicing` phase** of any L1 item.
2. **Clicking `Hint` once on a fresh item** mounts a `HintCard` at `level: 1` with a templated body referencing the current item's specific gates/variables, within 500ms.
3. **Clicking `Hint` a second time on the same item** mounts a `level: 2` HintCard.
4. **Clicking `Hint` a third time** mounts a `level: 3` HintCard with LLM-authored free-form prose.
5. **A fourth click does nothing** (or the affordance is grayed out); no `level: 4` exists.
6. **L1 and L2 hint slot values reference the item's actual gates and variables** — verifiable by reading the rendered hint text against the item's `targetExpression`.
7. **L3 hints are logged with `validatorStatus: 'unverified_prose'`** in the `events` table.
8. **Hint requests during the `transferring` phase return `no_action` and the affordance is disabled** — the transfer-probe refusal extends to hints.
9. **The `learner_state.hintsUsed` counter increments per hint request** and is queryable from F-09's rule-gate predicate.
10. **The LangSmith eval suite for L3 hints passes at ≥80% on the labelled bank** (lower than F-05's 95% because L3 is inherently fuzzier; this is the right threshold per [ADR-010](../adrs/ADR-010-content-correctness-and-validation.md)).

## Testing requirements

- Component test for HintCard rendering per level.
- Integration test: hint flow end-to-end at L1 + L2 + L3 + post-L3-disabled.
- Unit test for slot-fill validation: every L1/L2 template against every L1 item, slot values are subset of item tokens.
- LangSmith eval bank for L3 hint quality.

## Manual setup required

- L1/L2 template strings hand-authored (small set, ~10 templates total). Schedule ~half day during implementation.
- L3 labelled bank hand-authored (~10 examples). Schedule ~half day.

## Convergence and expected rework

⚠ **Agent menu file** (`apps/agent/src/agent/menu.ts`) edited concurrently with F-07. Both extend the agent's classify+branch logic. Strategy: coordinate the file-edit at the start of I1's after-F-05 phase; the two sub-agents claim distinct branch arms.

⚠ **Renderer switch convergence** with F-07. Same alphabetical-case-merge strategy as I1 reps.

## Build plan

- [x] **C1** — Hint templates (`apps/agent/src/hints/templates.ts`) + unit test (20 tests)
- [x] **C2** — `propose_hint` TacticalMove in `menu.ts` + `compileMove` arm + test (3 new tests)
- [x] **C3** — Hint arm in `stubClient.ts` (HeuristicMoveProvider) + integration test (8 tests)
- [x] **C4** — L3 logging in `server.ts` (set `{layer:3, status:'unverified_prose'}` for HintCard level 3) + unit test (6 tests)
- [x] **C5** — `HintCard` React component (`apps/web/src/components/HintCard.tsx`) + registry wire-up + component test (5 tests)
- [x] **C6** — Hint button in `App.tsx` (visible in `practicing`, disabled in `transferring`) + `actionAdapter.ts` check that HintCard is not in `PRACTICE_KINDS`
- [x] **C7** — Run all tests + typecheck pass (agent: 90 pass / 5 skip; web: 98 pass)

## Implementation notes (filled in by the building agent)

### Integration point for F-09 (hintsUsed counter)

F-09 owns `learner_state` as the single writer. Per spec criterion 9, `hintsUsed` must be queryable by F-09's rule-gate. Each `request_hint` event is logged as an `events` row by `handleClientFrame` (like every other event). F-09 should COUNT `events` rows where `kind = 'request_hint'` for the session to derive `hintsUsed`. No `learner_state` writes in this feature.

### Guardrailed files not touched
- `packages/contract/src/action.ts` — HintCard is a `mount` of the existing `mount` variant; no new wire variant needed.
- `packages/statechart/src/lesson.ts` — the `hint` phase already exists; no spine changes needed.
- `learner_state` — not written; F-09 reads hint count from the event log.

### Adversarial review fixes

- **C1 (keyed path):** the OpenAI provider (`openaiClient.ts`) couldn't emit a hint — its `MoveSchema.move` enum + `toTacticalMove` were still the F-05 menu. Fixed: `MoveSchema.move` now sources its enum from `F06_MENU` (was a dead export), added nullable `hintLevel`/`hintBody` schema fields + a `propose_hint` case in `toTacticalMove`, and added a `propose_hint` entry to the system prompt's menu enumeration (`prompt.ts`) describing the per-item level ladder. So with `OPENAI_API_KEY` set, a `request_hint` now routes to a real levelled HintCard (criteria 4/10 reachable in deployment, not just the heuristic path).
- **C3:** added a rendered-text subset test in `templates.test.ts` — renders the actual L1/L2 body and asserts every gate/variable reference in the prose is a member of the item's token set (criterion 6 verbatim: "verifiable by reading the rendered hint text").
- **C4:** documented that `serverL3Logging.test.ts` is a logic-unit test (offline, mirrors the server rule) with real-path coverage in the DB-backed `server.integration.test.ts`.

### Deferred to integration (per reviewer)
- **Server-side hint refusal during `transferring` (criterion 8):** the agent can't currently see the lesson `phase` (it's not threaded into `AgentInput`), which is a cross-cutting change. The UI already disables the Hint button during `transferring`; the reviewer is threading `phase` into `AgentInput` and adding the server-side refusal at integration. Left the UI-disable as the only guard here.
