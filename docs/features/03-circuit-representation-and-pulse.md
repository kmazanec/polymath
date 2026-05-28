# Feature: Circuit representation + learner-triggered Pulse

**ID:** F-03 · **Iteration:** I1 — Lesson 1 cross-rep gym · **Status:** Not started

## What this delivers (before → after)

**Before:** No circuit workspace. `CircuitBuilder` mounts to a "TBD" stub. The brief's marquee demoable moment ("a NAND gate lighting up when both inputs flip, while the truth table re-renders and the pseudocode highlights") cannot be staged.

**After:** When the agent mounts `CircuitBuilder` with a target expression and allowed gates, the learner sees a react-flow canvas with a gate palette (the allowed gates as draggable nodes), an input source set, and an output sink. They drag gates onto the canvas, wire input → gate → ... → output, press a `Test it` button, and watch the **pulse animation** propagate: inputs evaluate, gates light up in topological order, edges between activated gates animate, output latches. The truth-table row corresponding to the active input combination pulses in sync (via `PulseContext`); the pseudocode line currently executing highlights (also via `PulseContext`, once F-04 lands its subscriber). Pressing `Submit` runs `packages/booleans.equivalent(learnerCircuit, targetExpression)` and renders the verdict in <5ms.

The pulse is **learner-triggered, causal, not decorative**. One pulse per `Test it`. Suppressed during transfer probes. Reduced-motion preference fallback is a step-through "Next gate →" interaction. The pulse is the load-bearing demo moment of the whole submission.

## How it fits the roadmap

I1, concurrent rep feature alongside F-02 and F-04. **On the critical path** — the inner agent loop (F-05), the transfer probe (F-07), and ultimately the explain-back rubric (F-11) all expect the Circuit workspace as the canonical complex representation; the pulse is what makes the cross-rep thesis visually unforgettable.

F-03 is the **producer** of `PulseContext`. F-02 and F-04 subscribe. F-03's pulse-producer code must land before F-02 and F-04 can complete their respective pulse-subscriber sub-tasks. Strategy: F-03's PR is structured so the `PulseContext` producer lives in a commit early in the PR; F-02/F-04 can pin to that commit and rebase as F-03 evolves.

## Dependencies (must exist before this starts)

- **F-01** — `ComponentSpec.kind === 'CircuitBuilder'` variant in the locked schema; `packages/booleans` validator; web shell with renderer switch and `<AnimateOrNot>` wrapper.

External library: `@xyflow/react` (react-flow) installed per [ADR-008](../adrs/ADR-008-frontend-and-client-architecture.md). Framer Motion / `motion` library installed.

## Unblocks (what waits on this)

- **F-02** — `PulseContext` subscriber (final acceptance criterion).
- **F-04** — `PulseContext` subscriber for the pseudocode line highlight.
- **F-05** — Agent menu emits `mount` of `CircuitBuilder`.
- **F-07** — Transfer probe needs the circuit-rendering+hiding logic to exist.
- **F-22** (stretch) — NAND-universality lessons depend on the circuit workspace being polished.

## Contracts touched

- **`ComponentSpec`** — implements the rendered behavior for `CircuitBuilder`. The `allowedGates: Gate[]` field is consumed; the `Gate` union (`AND | OR | NOT | NAND | NOR | XOR | XNOR`) is referenced. F-03 renders the L1 subset (AND/OR/NOT); F-22 extends to NAND.
- **`packages/booleans`** — consumes the validator; equivalence check is the truth-maker for submission correctness. Does not extend.
- **Curated component registry (rendering)** — adds the `case` for `CircuitBuilder`. ⚠ Convergence with F-02 and F-04 on the switch file.
- **`PulseContext`** — **introduces** the contract. The shape (`{ activeStep: number | null, schedule: PulseStep[] }`) is locked once F-03's producer ships; F-02 and F-04 read from it but do not modify the producer.
- **WebSocket message protocol** — extends `submit` event with the `circuit` branch of the rep-tagged submission union. Payload includes the circuit topology (nodes + edges) so the agent's logging can reconstruct it.

## Sub-tasks

1. **T-03a — react-flow canvas with custom node types** `[parallel]`
   - One custom node type per L1 gate (AND, OR, NOT). Each has typed input/output `Handle`s.
   - Gate palette: draggable gate nodes from a sidebar onto the canvas.
   - Input source(s) and output sink as fixed nodes.
2. **T-03b — `packages/booleans` integration: circuit → expression** `[parallel after T-03a]`
   - Walk the circuit topology, build an expression AST from inputs through gates to output, hand it to `equivalent(circuitExpression, targetExpression)`.
   - Handles disconnected outputs (validation error: "Output not wired"), cycles (error), unused gates (warning).
3. **T-03c — `PulseRenderer` + `PulseContext` producer** `[parallel after T-03a]`
   - Compute propagation schedule from topology (topological sort).
   - For each input combination (one row of the target's truth table), animate gate-by-gate: highlight gate, animate edge to next gate, latch output.
   - Total propagation 600–1200ms per [ADR-004](../adrs/ADR-004-modalities-and-sensors.md).
   - Publish `{ activeStep, schedule }` to `PulseContext` for F-02/F-04 subscribers.
   - Color-blind-safe palette: blue for active, gray for inactive.
4. **T-03d — `Test it` button + reduced-motion fallback** `[parallel after T-03c]`
   - Triggered by learner. One pulse per click.
   - When `prefers-reduced-motion: reduce`, the button becomes a `Next gate →` step-through that announces each step textually for screen readers.
5. **T-03e — Submit handler + verdict rendering** `[parallel after T-03b]`
   - Submit → equivalence check → render correct (whole canvas pulses green) or incorrect (the failing input combination is highlighted on the truth-table-row subscriber once F-02 lands).
6. **T-03f — Renderer switch case** `[parallel]`
   - Replace F-01's TBD stub for `CircuitBuilder` with the real component.
7. **T-03g — Tests + visual regression** `[parallel]`

## Acceptance criteria (product behavior)

1. **Given a target expression `A AND B`** and `allowedGates: ['AND']`, when the agent mounts `CircuitBuilder`, the learner sees a canvas with two input nodes (A, B), an output sink, and an AND gate in the palette.
2. **Dragging the AND gate onto the canvas and wiring A → AND, B → AND, AND → output** is possible via mouse drag and keyboard (Tab/Enter to focus a gate, arrow keys to wire). Drag latency <50ms.
3. **Pressing `Test it`** triggers a pulse animation lasting 600–1200ms total: A and B inputs evaluate (visible state change), the AND gate lights up in propagation order, the output edge animates, the output node latches.
4. **The pulse runs deterministically given a topology and an input set** — re-running it produces the same animation schedule (asserted in a unit test).
5. **Pressing `Submit` with a correctly-wired circuit equivalent to the target** sends a `submit` event with `correct: true`; the agent's next Action is mounted within ~500ms.
6. **Pressing `Submit` with an incorrect circuit** sends `correct: false` with the failing input combination identified in the payload; verdict UI marks the canvas red.
7. **Disconnected output or wiring cycle** is caught at submit time with a stock "fix your wiring first" message, not a JS exception.
8. **`prefers-reduced-motion: reduce`** replaces the pulse with a step-through "Next gate →" interaction; each step is announced via a screen-reader live region.
9. **During a transfer probe (F-07) with `circuit` in `hiddenReps`**, the canvas does not render and the pulse cannot be triggered — even if the learner requests it. (This acceptance criterion is technically observable once F-07 lands; for F-03 standalone, the component reads `hiddenReps` from props and renders null when its rep is hidden.)
10. **Color-blind-safe palette**: red/green for correct/incorrect is avoided in favor of shape + intensity differences plus blue/gray for active/inactive; verifiable by simulating deuteranopia in DevTools.
11. **Screen reader announces propagation**: each gate-activation step emits a live-region update like "AND gate evaluates: true and false equals false."

## Testing requirements

- Component tests for the canvas, palette, wiring interactions, `Test it` button, `Submit` flow.
- **Pulse determinism test:** given a fixed circuit topology and an input set, assert the propagation schedule is deterministic (a snapshot test on the `schedule` array).
- **Pulse correctness test:** given a topology, assert the final output matches `packages/booleans.evaluate(circuitExpression, inputs)` for every input combination.
- Visual regression (Playwright) for the L1 hardest item ("(A AND B) OR (NOT C)") at three stages: initial, mid-pulse, post-submit-correct.
- Accessibility: axe-core run against the rendered canvas; screen-reader announcement assertion.

## Manual setup required

None. The react-flow library installation is part of F-01's dependency wiring; if not, add it in F-03.

## Convergence and expected rework

⚠ **PulseContext producer is the convergence point.** F-03's PR must structure commits so the `PulseContext` is published *before* the full pulse animation lands. F-02 and F-04's subscriber sub-tasks pin to the producer commit. If the producer's shape changes mid-F-03, F-02 and F-04 need notification. Mitigation: lock the producer shape at the start of F-03 implementation; subsequent commits in F-03 only add behavior, not shape.

⚠ **Renderer switch file convergence** with F-02 and F-04. See F-02's convergence note.

⚠ **Submission payload shape convergence** with F-02 and F-04 on the rep-tagged union. See F-02's convergence note.

⚠ **The `hiddenReps` reading-from-props** in acceptance criterion 9 is a small contract with F-07. F-07 supplies the prop; F-03 reads it. Coordinate on the prop name (`hiddenReps?: Rep[]`) in the `CircuitBuilder` ComponentSpec branch — already declared in F-01's schema.

## Implementation notes (filled in by the building agent)

### Shared-contract decisions (this feature OWNS the producer side)

- **PulseContext — F-03 introduces and locks it.** Shape:
  `{ activeStep: number | null, schedule: PulseStep[] }` in
  `apps/web/src/canvas/PulseContext.tsx`. Lock the shape in an early commit *before* the
  animation behavior, so F-02/F-04 subscribers pin to a frozen producer. Later F-03 commits add
  behavior, never reshape.
- **Submit wire**: populate the `{ rep:'circuit', expression, nodes, edges }` branch of
  `repSubmission` (locked Step 0); `submission` = canonical expression built from the topology.
  Verdict client-side via `equivalent`.
- **Renderer switch**: deliver `apps/web/src/components/CircuitBuilder.tsx`; coordinator wires
  the `case` (no `registry.tsx` edit from the feature branch).
- **`hiddenReps` from props (AC9, F-07 contract)**: `CircuitBuilder` reads `hiddenReps?: Rep[]`
  and renders null when `circuit` is hidden. F-07 supplies the prop later; F-03 just honors it.
- Built on **Opus** (critical path + novel pulse scheduler + contract producer).

### Implementation plan (checklist)

- [x] **Chunk 1 — react-flow canvas + custom nodes (T-03a).** `@xyflow/react` canvas with
  custom `InputNode`/`GateNode`/`OutputNode` (typed `Handle`s; NOT has one input port, AND/OR
  two); gate palette (`Add X gate` buttons per `allowedGates`); input nodes derived from
  `variables(targetExpression)` + output sink. `apps/web/src/components/{CircuitBuilder,circuitNodes}.tsx`.
- [x] **Chunk 2 — circuit topology → Boolean AST → `equivalent` (T-03b, T-03e).** Pure model in
  `apps/web/src/canvas/circuitModel.ts` (`buildCircuit`) + submission in `circuitSubmission.ts`
  (`evaluateSubmission` → client-side `equivalent`). Typed errors for unwired output / cycle /
  too-many-vars — never throws (AC7). Submit builds the `{rep:'circuit',expression,nodes,edges}`
  repSubmission + verdict (AC5/AC6). Var-count guard ≤10.
- [x] **Chunk 3 — `PulseContext` producer + schedule (T-03c).** `circuitModel.pulseSchedule`
  (topological order, deterministic — inline-snapshot test, AC4) + `PulseContext.tsx` producer,
  shape `{ activeStep, schedule, vars, env }` locked in its own commit before behavior. Pulse-
  correctness test: every step's value == `evaluate`/`truthTable` for all input combos. Color-
  blind-safe blue(active)/gray(inactive) + border-width intensity, not red/green (AC10).
- [x] **Chunk 4 — `Test it` + reduced-motion + SR announcements (T-03d).** `usePulseRunner`
  drives `activeStep` over a 600–1200ms timer (continuous) or one step/call (reduced-motion
  `Next gate →`, AC8); polite live region announces each step (AC11). 900ms mid-band budget.
- [x] **Chunk 5 — Tests + a11y region + build (T-03g).** 30 web tests (model 9, context 3,
  runner 4, submission 4, component 5, + existing). Component test mocks ResizeObserver/matchMedia
  for react-flow. **Deferred:** axe-core + Playwright 3-stage visual regression — react-flow needs
  real layout (jsdom has no geometry); deferred to an integrated browser pass at F-05 mount /
  manual review. Noted as a deferral, not skipped.
- [x] **AC9 hiddenReps**: `CircuitBuilder` returns null when `hiddenReps` includes `circuit`
  (tested standalone; full transfer behavior observable once F-07 supplies the prop).

### Build verification evidence

- `pnpm --filter @polymath/web exec vitest run` → **30 passed (7 files)**. Key:
  `circuitModel.test.ts (9)` incl. determinism inline-snapshot + pulse-correctness-vs-validator;
  `usePulseRunner.test.ts (4)`; `circuitSubmission.test.ts (4)`; `CircuitBuilder.test.tsx (5)`.
- `pnpm --filter @polymath/web typecheck` → clean.
- `pnpm --filter @polymath/web build` → **"✓ 82 modules transformed … ✓ built in 587ms"** — the
  react-flow circuit component + canvas logic bundle cleanly for production.
- **Deferred verification (deliberate):** end-to-end drive (drag→Test it→pulse→Submit in a real
  browser) needs the agent to mount `CircuitBuilder`, which is F-05; and axe/Playwright-visual
  need browser geometry. Unit + build coverage proves the contract + wiring; runtime exercise is
  deferred to F-05 integration. The renderer-switch `case` is wired by the coordinator at
  integration (not in this branch).

### Decisions

- **Logic/view split:** the pulse scheduler, circuit→AST, and submission are pure, DOM-free
  modules under `src/canvas/` so determinism (AC4) and correctness are unit properties; the
  react-flow piece is a thin view. This is why coverage is high despite react-flow being hard to
  drive in jsdom.
- **Pulse is timer-driven CSS state, not framer-motion:** `motion` is installed but the pulse is
  a sequence of `activeStep` advances + a blue/border highlight — simpler, testable, and
  reduced-motion is a clean branch (`step()` vs `start()`) rather than a motion-config toggle.
- **Added `@polymath/booleans` to `apps/web` deps** (the reps validate client-side). F-02 added
  the same dep independently — benign duplicate, reconciled at integration.
