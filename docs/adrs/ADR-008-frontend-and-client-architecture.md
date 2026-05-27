# ADR-008: Vite + React + React Router; react-flow for the gate canvas; CodeMirror 6 for pseudocode; Framer Motion + View Transitions API + a custom pulse primitive

**Status:** Accepted · **Date:** 2026-05-27 · **Stretch:** no
**Supersedes:** none · **Superseded by:** none

## Context

The portal mandates **React** and **TypeScript** for the frontend. Earlier ADRs lock in:
- A hand-rolled, typed component registry ([ADR-005](./ADR-005-adaptive-ui-runtime-contract.md))
- XState as the UI-side state machine ([ADR-007](./ADR-007-orchestration-division-of-labor.md))
- A learner-triggered "pulse through the circuit" animation as a load-bearing motion primitive ([ADR-004](./ADR-004-modalities-and-sensors.md))
- High-frequency interactions must be instant (no LLM round-trip) ([ADR-005](./ADR-005-adaptive-ui-runtime-contract.md))

This ADR locks the remaining frontend choices: the React framework, the gate-circuit canvas library, the pseudocode editor, the animation strategy, and the residual state-management approach.

## Options considered

### React framework

**A — Vite + React + React Router (chosen).** No SSR. Static build deployed to a CDN; agent server is a separate WebSocket service. Fast dev loop. No RSC streaming fighting our interactive state.

**B — Next.js 15 App Router.** Default for AI apps; great for chat-style streaming UI. Our shape is a workspace, not a chat — RSC streaming + heavy client state (XState, react-flow, CodeMirror) becomes awkward. AI SDK 5 chat UI primitives are not what we need.

**C — TanStack Start.** Newer, less mature. No advantage for this app.

**D — Remix / React Router 7.** Server-first; same SSR concerns as Next.js.

### Circuit canvas

**E — react-flow / `@xyflow/react` (chosen).** Purpose-built for node-and-edge canvases. Custom React node types let each gate be a typed React component with its own input/output handles. Mature, accessible, supports keyboard navigation and screen-reader announcements out of the box.

**F — tldraw.** Whiteboard-shaped. Free-form drawing, arbitrary shapes, text. Wrong shape and overkill for our constrained gate-and-wire workspace.

**G — Custom react-konva or SVG.** Maximum flexibility, multi-week reinvention of what react-flow gives in a day.

**H — Off-the-shelf logic-circuit lib (Digital-JS / Logisim port).** Domain-specific but too rigid for our needs — these libs assume their own rendering model and don't accommodate the pulse-through animation cleanly.

### Pseudocode editor

**I — CodeMirror 6 (chosen).** Lightweight (~50KB gzipped), syntax highlighting trivial for our small Boolean-pseudocode language, accessible, mobile-friendly, mature.

**J — Monaco.** VS Code's editor. ~5MB, fully featured, overkill for our use.

**K — Raw textarea + Prism overlay.** Smallest footprint; cursor/selection coordination across the overlay is finicky and accessibility is fragile.

**L — Custom token-based block editor.** Pedagogically interesting (drag pseudocode tokens like Scratch blocks). Would double as a fourth representation layer. More implementation work; risk of distracting from the symbolic/circuit/pseudocode trio. Deferred to a future ADR if we add it.

### Animation strategy

**M — Framer Motion + View Transitions API + custom pulse primitive (chosen).**
- **Framer Motion** for component-level transitions: fade-in/out, position changes, list reordering.
- **View Transitions API** for scene-level changes (practice → transfer-probe scene swap).
- **`PulseRenderer`** as a purpose-built primitive that takes a circuit topology and a computed propagation schedule and animates the signal flow.

**N — Framer Motion for everything including the pulse.** Pulse becomes a stagger-children animation. Less control, simpler dep tree. We'd lose the ability to tune propagation order against circuit topology cleanly.

**O — Native CSS animations + View Transitions only.** Smallest bundle, no animation lib. Less polished feel. Defensible if we wanted to optimise hard for size — we don't.

### Residual state management

**P — XState context only (chosen).** No additional state library. XState's actor model handles per-component state where it matters; `useState` handles truly local UI state (a dropdown open/closed).

**Q — Add Zustand or Jotai for non-statechart UI state.** Doubles the mental model. No clear win for our shape.

## Decision

- **Vite + React + React Router** as the frontend stack.
- **`@xyflow/react`** as the gate-canvas library. Custom node types for each gate (`AND`, `OR`, `NOT`, `NAND`, `NOR`, `XOR`, `XNOR`); custom edge type carrying the propagation-highlight state.
- **CodeMirror 6** as the pseudocode editor, with a custom syntax highlighter for our 5-keyword Boolean-pseudocode grammar (`not`, `and`, `or`, `true`, `false`, plus identifiers, parentheses, and `if`/`then`).
- **Framer Motion** for component-level transitions; **View Transitions API** for scene swaps; **`PulseRenderer`** as a purpose-built primitive.
- **XState context** as the state mechanism; `useState` for truly local UI state.

The motion budget from [ADR-004](./ADR-004-modalities-and-sensors.md) is enforced via a wrapper component `<AnimateOrNot>` that receives the current phase from the XState context and short-circuits children's animations during transfer probes and when the user has reduced-motion preference set.

## Rationale

### Vite is the right shape for a workspace

The brief asks for a hyperresponsive learning interface. Hyperresponsive in browser terms means *snappy client interactions*. The interactive workspace state (which gates are wired up, which truth-table inputs are toggled, what's in the pseudocode editor) lives client-side; there is no useful server round-trip on a toggle or a drag. RSC streaming and SSR are optimisations for content-heavy, less-interactive shapes. Our shape is the opposite.

Vite's faster dev loop is genuinely worth 4–6 weeks of iteration speed. Deployment is simpler: static build to any CDN, WebSocket to the agent service. Two deployable artifacts, each in its sweet spot.

### react-flow earns its keep specifically for the pulse

The pulse-through-the-circuit ([ADR-004](./ADR-004-modalities-and-sensors.md)) requires:
1. Walking the circuit topology in topological order (compute propagation schedule).
2. Highlighting each gate as the signal arrives.
3. Animating the edge from input to output of each gate.
4. Latching outputs.
5. Synchronising with the truth-table row pulse and pseudocode line highlight.

react-flow gives us the graph data structure and the rendering primitives in a form that makes (1) and (2) trivial. Each gate is a custom React node that already knows its inputs and outputs via react-flow's `Handle` API. The custom edge type already has `source` and `target` references and can be styled per-edge during animation. Implementing the same on raw SVG or Konva would be a week-plus.

### CodeMirror 6 over Monaco

The pseudocode is small. We're highlighting maybe 8 token kinds. Monaco is the wrong order of magnitude. CodeMirror 6 also has better mobile/touch behavior, which matters in some demo conditions even though multi-device is dropped.

### The pulse primitive is purpose-built for a reason

The brief explicitly rewards "informative, not decorative" animation. The pulse traces real execution semantics. To do that well — propagation order computed from topology, latching at gate outputs, sync with other reps — we need a primitive that knows about the circuit's structure, not a generic animation library. `PulseRenderer` is small (probably ~200 lines) and owned.

### XState context is enough

Adding Zustand or Jotai would split the mental model — some state in XState, some in Zustand. The brief asks us to defend *when the UI changes*, and the cleanest defense is "everything that changes goes through the statechart." Centralising in XState reinforces that defensibility argument.

### Defensibility for Nerdy

- **Dalmia (VP Eng)** will recognise Vite + React Router as a modern, lightweight choice that avoids unnecessary SSR complexity. He'll appreciate that we picked react-flow because the *shape* of the problem (node-and-edge graph) matches its capabilities, not because it's trendy.
- **The "we picked CodeMirror because Monaco is overkill" answer signals product-engineering judgment** — knowing when to under-engineer.
- **The motion budget enforced by a single wrapper component** is the kind of architectural answer to "how do you prevent UI chaos" that an evaluator will remember.

## Tradeoffs & risks

- **No SSR means slower first-content-paint.** Mitigation: small splash screen with the lesson title while the JS bundle loads; the agent connects in parallel.

- **react-flow is opinionated about its visual style.** Mitigation: extensive theming hooks; we can override the default node/edge appearance heavily without forking.

- **CodeMirror 6 has a steeper learning curve than CodeMirror 5.** Mitigation: its API is more composable; the cost is paid once, in week 1.

- **Framer Motion + View Transitions + custom pulse means three animation systems.** Mitigation: each is in its sweet spot; the boundary between them is explicit (component-level → Framer; scene-level → View Transitions; circuit-pulse → PulseRenderer). The `<AnimateOrNot>` wrapper centralises the motion-budget rule across all three.

- **iOS Safari has historically had View Transitions API quirks.** Mitigation: feature-detect and fall back to a Framer-Motion-driven crossfade for the scene swap on browsers where View Transitions misbehaves. Add to the cross-platform test matrix in [ADR-006](./ADR-006-voice-and-agent-llm-stack.md).

- **XState context for per-component state is unconventional.** Mitigation: most per-component state is genuinely UI-local (`useState`); only the truly shared state lives in XState. The boundary is "does another component need to react to this state? If yes, XState. If no, `useState`."

- **The pulse-primitive code is bespoke and will need maintenance.** Mitigation: it's small (~200 lines), well-tested (deterministic given a circuit topology), and central to the demo — worth the ownership cost.

## Consequences for the build

- **Project structure:**
  - `apps/web` — Vite + React app
  - `apps/web/src/components/` — the ~12 components from the typed registry
  - `apps/web/src/canvas/` — react-flow customisation: node types, edge types, layout
  - `apps/web/src/canvas/PulseRenderer.tsx` — the custom pulse primitive
  - `apps/web/src/code/` — CodeMirror configuration: language extension, theme
  - `apps/web/src/motion/AnimateOrNot.tsx` — motion-budget wrapper
  - `apps/web/src/state/` — XState machine integration

- **Bundle budget:** target ≤500KB gzipped for the initial JS payload. CodeMirror's small footprint, Vite's tree-shaking, and avoiding Monaco get us there comfortably.

- **The custom gate node types** are typed React components with input/output `Handle` ports; each accepts an `active: boolean` and a `pulseStep: number | null` prop that the `PulseRenderer` drives.

- **The truth-table component** subscribes to the same XState context that the `PulseRenderer` uses; when the pulse is mid-flight, the truth-table row corresponding to the current input combination pulses on the same beat.

- **The pseudocode editor** subscribes to the same context; the line(s) currently executing during a pulse highlight at the same beat.

- **All three representations share a common `PulseContext`** so the pulse is the single source of truth for "what is the circuit doing right now," and the other reps observe.

- **CI test for the pulse primitive** asserts: given a fixed circuit topology and an input set, the propagation schedule is deterministic and the output value matches the truth table.

- **Accessibility audit** is week-3 deliverable: keyboard navigation across the gate canvas, screen-reader announcements for the pulse propagation, color-blind-safe palette, reduced-motion preference honored.

- **The Framer Motion dependency** is upgraded to its current major version (now branded `motion`); Framer Motion's older v6/v7 APIs are not used.
