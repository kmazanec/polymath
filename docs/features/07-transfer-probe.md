# Feature: Transfer probe + hidden-reps refusal

**ID:** F-07 · **Iteration:** I1 — Lesson 1 cross-rep gym · **Status:** Not started

## What this delivers (before → after)

**Before:** The system has no transfer assessment. The learner can complete an L1 practice item but the brief's "transfer moment" requirement is not honored.

**After:** When the agent determines the learner is ready to be tested (rule-gate stub passes — F-09 lands the full predicate but F-07 can be tested against a hand-fired transfer probe), it emits a `mount` of `TransferProbe`. The probe specifies `targetRep` (the representation the learner must produce, e.g., circuit) and `hiddenReps` (the reps that must not be visible, e.g., truth-table). The renderer literally does not mount components for representations in `hiddenReps`. If the learner asks the agent to bring back a hidden rep ("can I see the truth table again?"), the agent emits `answer_question` with a stock refusal text from [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md): *"During the transfer check, I'm keeping the [REP] view off so you're showing me you can do this yourself. We can review it together right after."* On `submit`, the learner's answer is validated against the bank-stored canonical truth-table; pass/fail recorded in `events`.

The transfer-probe refusal is **a demoable moment** — "watch what happens when I ask for the truth table back" is in the demo script per [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md).

## How it fits the roadmap

I1, **on the critical path**. Concurrent with F-06 after F-05 lands. Blocks F-09 (the rule-gate's transfer-pass condition reads from this), F-11 (explain-back is triggered on transfer pass), F-12 (full mastery gate).

## Dependencies (must exist before this starts)

- **F-02, F-03, F-04** — the reps must exist before they can be selectively hidden.
- **F-05** — agent menu extensible.
- **F-08** — the transfer bank must have items seeded so the probe has content to pull from.

## Unblocks (what waits on this)

- **F-09** — rule-gate's transfer-pass condition.
- **F-11** — explain-back is triggered on `transfer_submitted` event.
- **F-12** — full mastery gate requires transfer pass.

## Contracts touched

- **`Action` schema** — extends with `propose_transfer_probe(held_out_rep: Rep)`. Emitted by the agent; statechart guard validates and mounts `TransferProbe` accordingly.
- **`ComponentSpec`** — `TransferProbe` variant already in F-01 schema. F-07 implements rendering. The hidden-reps enforcement is at the **component level**: the `TransferProbe` component literally does not import/render the hidden reps.
- **Curated component registry (rendering)** — adds the `TransferProbe` case.
- **Statechart spine** — adds the `transferring` phase guards: any attempt to mount a hidden-rep component during the phase is rejected. This is one of the three explicit refusals from [ADR-005](../adrs/ADR-005-adaptive-ui-runtime-contract.md).
- **WebSocket message protocol** — adds `transfer_submitted` event kind. Append-only.
- **`transfer_bank` Postgres table** — read-only consumer.
- **Refusal copy library** — `apps/web/src/copy/refusals.ts` introduced here. The three refusal texts live in one place; F-12 will reference the mastery-without-conditions refusal.

## Sub-tasks

1. **T-07a — `<TransferProbe>` React component** `[parallel]`
   - Mounts only the `targetRep` workspace; reads `hiddenReps` and refuses to mount anything in it (returns null + log).
   - Banner copy: "Transfer check — show me you can do this without scaffolds."
2. **T-07b — Statechart `transferring` phase + guards** `[parallel]`
   - Phase transitions from `assessed` on agent's `propose_transfer_probe`.
   - Guards reject any `mount` of a hidden-rep ComponentSpec.
   - The "bring back the rep" refusal is wired: incoming `learner_question` events classified by the agent as "bring back a hidden rep" are routed to the refusal-text `answer_question` Action.
3. **T-07c — Agent transfer-probe subgraph** `[parallel]`
   - LangGraph node: when rule-gate signals readiness (stub for now; F-09 wires real predicate), pull an unseen item from `transfer_bank` (excluding any item shown earlier in the session); emit `propose_transfer_probe`.
4. **T-07d — Refusal copy + topic classifier for "bring back rep" requests** `[parallel]`
5. **T-07e — Submission handler** `[parallel after T-07a]`
   - On submit: validate via `packages/booleans.equivalent` against the bank item's canonical expression; emit `transfer_submitted` with the result.
6. **T-07f — Tests** `[parallel]`

## Acceptance criteria (product behavior)

1. **When the agent emits `propose_transfer_probe(held_out_rep: 'truth_table')`** on an L1 item, the statechart transitions to `transferring` and the learner sees the `TransferProbe` workspace containing only the `targetRep` (e.g., circuit), no truth table.
2. **Attempting to mount a hidden-rep component during the phase is silently rejected by the statechart guard** — verifiable by injecting a `mount` Action with a hidden rep and observing the rejection in the statechart's decision log.
3. **The pulse-through-the-circuit animation (F-03) is suppressed during transfer probes** when the truth table is hidden, since the in-sync truth-table row pulse would leak information.
4. **The learner asking "can I see the truth table" via the (post-F-10) voice or (current) text channel** elicits a stock refusal text from `refusals.ts`; no rep is brought back.
5. **A correct submission emits `transfer_submitted` with `correct: true`**; the agent's next Action is a `propose_mastery_transition` (or the rule-gate-stubbed equivalent).
6. **An incorrect submission emits `transfer_submitted` with `correct: false`**; the agent's next Action is a `remediating` transition back into `practicing` with a `simpler_item`.
7. **The probed item is one the learner has not seen in this session** — verifiable from the `events` table by cross-referencing item IDs.
8. **The transfer-probe refusal is observable in a demo recording** — the demo script can include "I'm going to ask for the truth table back; watch what happens."

## Testing requirements

- Component test: TransferProbe renders only targetRep; hidden reps are null in the DOM.
- Statechart test: `mount` of hidden-rep during `transferring` phase is rejected by guard.
- Integration test: full probe flow from `propose_transfer_probe` through correct submission to next-phase transition.
- Eval scenario: "learner asks for hidden rep" → stock refusal text.

## Manual setup required

- Refusal copy review by Keith — the language must be warm + explanatory, not adversarial. ~half day of writing/review.

## Convergence and expected rework

⚠ **Statechart spine changes** in T-07b. The `transferring` phase is added to `packages/statechart`. Coordinate with F-09 (rule-gate guards) — both touch the statechart. Strategy: F-07 lands the phase + the hidden-rep guard; F-09 lands the readiness guard.

⚠ **Agent menu file** edited concurrently with F-06. See F-06's convergence note.

⚠ **Renderer switch convergence** with F-06.

⚠ **F-07 depends on F-08's seeded transfer bank** — coordinate timing so F-08 merges before F-07's submission tests can run live. F-07 can develop against a small stubbed bank, then switch to the seeded one when F-08 is in.

## Implementation plan (approved)

> Built off F-05. The wire `Action` union stays locked (4 variants); the
> `propose_transfer_probe` tactical move is added to the **internal** `menu.ts`
> enum and compiles to a `mount` of the existing `TransferProbe` ComponentSpec.
> No `OPENAI_API_KEY`: the heuristic provider fires the probe; live LLM deferred.

- [x] **Refusal copy** — `apps/web/src/copy/refusals.ts`: the 3 ADR-005 refusal texts in one
      place, incl. the transfer-probe "I'm keeping the [REP] view off…" copy (templated on rep).
- [x] **`TransferProbe` component** — `apps/web/src/components/TransferProbe.tsx` + renderer
      case (replace `<Tbd>`). Mounts only `targetRep`'s workspace (reusing the rep components),
      passing `visibleReps: [targetRep]` + `hiddenReps` so each rep self-suppresses; renders the
      banner copy. Hidden reps are absent from the DOM. *(criteria 1,2)*
- [x] **Statechart `transferring` guard** — `packages/statechart/src/lesson.ts`: a named guard
      (`canMountInTransfer` / hidden-rep refusal) that rejects mounting a hidden-rep component
      during `transferring`. Pure predicate exported for the web adapter to consult. Lands a
      trivially-true readiness guard on `practicing → transferring` that **F-09 replaces**.
      *(criterion 2; ADR-005 refusal #2)*
- [x] **Adapter enforcement** — `apps/web/src/ws/actionAdapter.ts`: while in `transferring`,
      a `mount` of a hidden-rep spec is dropped (refused) rather than applied. *(criterion 2)*
- [x] **Agent `propose_transfer_probe` move** — `menu.ts`: add the move + compileMove arm →
      `mount` of `TransferProbe`. Heuristic arm: pull an unseen `transfer_bank` item for the
      lesson (excluding session-seen item ids), emit the probe. Fired on a correct submit when
      the rule gate is ready (F-05's `ruleGatePassed`; F-09 wires the real predicate).
      *(criteria 1,5,7)*
- [x] **`transfer_submitted` handling** — server: on the `transfer_submitted` event, validate
      the submission via `@polymath/booleans.equivalent` against the bank item's canonical
      expression; record pass/fail in the event log; agent's next move is mastery-transition on
      pass, remediating/simpler on fail. *(criteria 5,6)*
- [x] **"Bring back the rep" refusal** — a `learner_question` classified as asking to reveal a
      hidden rep, while in `transferring`, returns the stock refusal `answer_question`. *(crit 4)*
- [x] **Pulse suppressed during probe** — confirm the circuit pulse is off in `transferring`
      (motion already gates on phase). *(criterion 3)*
- [x] **Tests** — TransferProbe renders only targetRep (hidden reps null in DOM); statechart
      guard rejects hidden-rep mount in `transferring`; full probe flow integration
      (propose → correct submit → next phase); refusal eval scenario. *(testing requirements)*

## Implementation notes (filled in by the building agent)

### As built

- **`propose_transfer_probe`** added to the internal `menu.ts` `TacticalMove` union (NOT the
  wire `Action` union — locked); compiles to a `mount` of the existing `TransferProbe`
  ComponentSpec. The heuristic provider fires it on a correct submit when `ruleGatePassed`
  and an unseen bank candidate exists; if the bank is exhausted it proposes mastery directly.
- **Hidden-rep refusal (ADR-005 #2)** is enforced in two layers: (a) `isHiddenRepMountRefused`
  — a pure guard in the statechart package — and the web `actionAdapter` *drops* any `mount`
  that would reveal a held-out rep while in `transferring` (`refused: true`); (b) the
  `TransferProbe` component itself renders only `targetRep`'s workspace, so the held-out reps
  are never in the DOM. Both are tested.
- **`transfer_submitted` is validated server-side** (`computeTransferVerdict` →
  `booleans.equivalent` against the bank item's canonical expression); the verdict is threaded
  to the agent via `AgentInput.transferVerdict` and **recorded in the replay log** (criterion
  5). The agent never re-derives correctness.
- **Unseen-item guarantee (criterion 7):** `readTransferCandidates` reads the lesson's
  `transfer_bank` rows minus any item id already probed/submitted this session (from the event
  log). Read-only — the bank is never written at runtime.
- **"Bring back the rep" refusal (criterion 4):** the *interface itself* refuses — during
  `transferring`, a learner question matching "see/show/bring back the [hidden rep]" renders
  the warm stock refusal (`transferRepRefusal`) locally without revealing the rep, rather than
  round-tripping. Faithful to ADR-005 "even on learner request".
- **Pulse suppression (criterion 3):** the motion wrapper already gates animation off in
  `transferring` (`AnimateOrNot`), so no change needed.

### Decisions

- The `transferring` readiness guard on `practicing → transferring` stays trivially-permissive
  here; **F-09 replaces it** with the real rule-gate predicate (coordinated — F-09 rebases on
  this). F-07 lands the *phase + hidden-rep refusal*; F-09 lands *when* it fires.
- The active probe's `itemId`/`hiddenReps` + the current phase are tracked in **refs** in
  `App.tsx` so the WS message closure reads current values (avoids the stale-closure class of
  bug F-05's review flagged).

### Convergence flags for integration (coordinator)

- `apps/agent/src/agent/menu.ts` — F-07 adds the `propose_transfer_probe` union member + its
  `compileMove` arm + the `F05_MENU` literal. **F-06 adds `propose_hint` to the same union** —
  both are additive; reconcile by keeping both members.
- `apps/web/src/components/registry.tsx` — F-07 wires the `TransferProbe` case; F-06 wires
  `HintCard`. Additive switch edits.
- `apps/agent/src/server.ts` — F-07 adds `readTransferCandidates`/`computeTransferVerdict` +
  threads `transferCandidates`/`transferVerdict`; **F-06 changes the `validation.layer/status`
  logging for L3 hints**. Both touch `handleClientFrame`'s payload build — reconcile so the L3
  validation logic and the transferVerdict field coexist.
- `apps/web/src/App.tsx` — F-07 adds probe/refusal handling; F-06 adds the Hint button. Both
  edit the render + the onMessage closure — reconcile.

### Verification

- `pnpm typecheck` clean (5 packages); web 101 tests, agent 39 (+1 skipped), statechart 15.
- Probe flow proven end-to-end against real Postgres (`server.integration.test.ts`): ready
  learner → submit → `TransferProbe` mounts → correct `transfer_submitted` → mastery
  transition, with the verdict in the replay log.
- TransferProbe component test: only the target rep is in the DOM for all 3 target reps.
- Adapter test: a hidden-rep mount during `transferring` is refused; the target-rep mount is
  allowed.
- Browser smoke is the coordinator's job at integration (the refusal "ask for the truth table
  back" demo moment will be exercised on the assembled batch).

### Adversarial review (Step 6) — Wave 1

- **Spec (CRITICAL, fixed):** a `propose_transfer_probe` compiled to a TransferProbe *mount*
  but never drove the spine into `transferring`, so the hidden-rep refusal + pulse suppression
  (which gate on the phase) were inert in the running app — unit tests passed `phase:'transferring'`
  explicitly and masked it. **Fix:** the adapter now emits `enter_transfer` on a TransferProbe
  mount, and a practice-item mount arriving *during* `transferring` (a remediation) walks the
  spine `assess → remediate → resume_practice` back to `practicing`. New end-to-end adapter
  tests drive the *real* spine through probe→pass→mastered and probe→fail→remediate→practicing,
  plus a test that the spine still refuses mastery when the gate flag is closed (refusal #3).
- **Security (HIGH, fixed):** `computeTransferVerdict` ran `equivalent` on learner-controlled
  `submission` with no distinct-variable cap — a 2000-char 26-var expression would force a
  2^26 enumeration on the event loop. **Fix:** cap at 10 distinct vars before enumerating
  (over-wide → `correct:false`).
- **Security (MEDIUM, fixed):** `transfer_submitted.itemId` wasn't bound to the probe actually
  mounted for the session — a client could submit against an easier held-out item or burn a
  different item from the unseen set. **Fix:** `computeTransferVerdict` confirms the itemId
  matches the most-recently-mounted `TransferProbe` for the session; a mismatch (or no probe
  mounted) scores `correct:false`. New integration test covers the forgery case.
- The `transferring` readiness guard remains permissive for F-09 to tighten (recorded as a
  convergence flag).

---

**Delivered in MR:** https://labs.gauntletai.com/keithmazanec/polymath/-/merge_requests/4 (unified I1 inner-loop batch: F-05/06/07/09).
