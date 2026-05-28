# Feature: Pseudocode representation (CodeMirror 6 editor + boolean DSL)

**ID:** F-04 · **Iteration:** I1 — Lesson 1 cross-rep gym · **Status:** Not started

## What this delivers (before → after)

**Before:** No pseudocode workspace. `PseudocodeChallenge` mounts to a "TBD" stub. The third leg of the cross-rep gym is missing.

**After:** When the agent mounts `PseudocodeChallenge` for a target expression, the learner sees a CodeMirror 6 editor pre-configured with a tiny Boolean-pseudocode language (~5 keywords: `not`, `and`, `or`, `true`, `false`, plus identifiers, parentheses, and `if`/`then`). Syntax highlighting fires as they type. On `Submit`, the code is parsed into a Boolean expression and equivalence-checked against the target via `packages/booleans.equivalent()`. During a pulse animation triggered from the Circuit (F-03), the line currently executing in the pseudocode highlights at the same beat — the cross-rep thesis made temporal.

## How it fits the roadmap

I1, concurrent rep feature alongside F-02 and F-03. **Off the critical path** — the brief's marquee demo moment leans on Circuit + Pulse + Truth-Table sync; pseudocode is the third rep that completes the gym thesis but doesn't single-handedly gate any downstream feature. Cut last if I1 capacity shrinks.

## Dependencies (must exist before this starts)

- **F-01** — `ComponentSpec.kind === 'PseudocodeChallenge'` variant; `packages/booleans` validator; web shell.

External library: `codemirror` v6 with `@codemirror/state`, `@codemirror/view`, `@codemirror/language`.

## Unblocks (what waits on this)

- **F-05** — Agent menu emits `mount` of `PseudocodeChallenge` and `alt_representation` action targeting pseudocode.
- **F-07** — Transfer probe can use pseudocode as the target representation (especially for L2+ transfer where the learner produces pseudocode from a hidden circuit).

## Contracts touched

- **`ComponentSpec`** — implements rendered behavior for `PseudocodeChallenge`. No schema change.
- **`packages/booleans`** — consumes the validator; the parser must accept the pseudocode syntax variant. Decision: F-04 may need to extend `packages/booleans` with a `parsePseudocode` variant that accepts `if a and b then ...` style code, mapping it back to the canonical AST. If so, this is a **strictly additive** extension (new public function, existing API unchanged).
- **Curated component registry (rendering)** — adds the `case` for `PseudocodeChallenge`. ⚠ Convergence with F-02 and F-03 on the switch file.
- **`PulseContext`** — *subscribes* after F-03 introduces it. Highlights the line currently executing during a pulse.
- **WebSocket message protocol** — extends `submit` event with the `pseudocode` branch of the rep-tagged union.

## Sub-tasks

1. **T-04a — CodeMirror 6 editor setup + language extension** `[parallel]`
   - Vanilla CM6 editor mount in React.
   - Custom language extension with a small Lezer grammar (or a hand-written tokenizer if Lezer is overkill) for the 5-keyword grammar.
   - Syntax highlighting via `@codemirror/language` `HighlightStyle`.
2. **T-04b — Pseudocode parser → Boolean AST** `[parallel after T-04a]`
   - Live in `packages/booleans` as `parsePseudocode(src: string): BooleanExpression | ParseError`.
   - Round-trip tests: every L1 target expression has a canonical pseudocode form whose `parsePseudocode` returns an AST that's `equivalent` to the original.
3. **T-04c — Submit handler + validator call** `[parallel after T-04b]`
4. **T-04d — `PulseContext` subscriber: line highlight** `[serial after F-03 lands PulseContext]`
   - Map the active pulse step to the corresponding pseudocode line (the `parsePseudocode` AST should carry line numbers for this).
   - Highlight via a CM6 decoration. Fades at the pulse beat.
5. **T-04e — Renderer switch case** `[parallel]`
6. **T-04f — Tests** `[parallel]`

## Acceptance criteria (product behavior)

1. **Given a target expression `A AND B`**, when the agent mounts `PseudocodeChallenge`, the learner sees an editor with placeholder text (`// write your expression here`) and a `Submit` button.
2. **Typing `(a and b)` produces syntax highlighting** — `and` is rendered as a keyword (distinct color/weight from identifiers).
3. **Pressing `Submit` with a pseudocode form equivalent to the target** sends a `submit` event with `correct: true` in <5ms parse + check time.
4. **Pressing `Submit` with an incorrect form** sends `correct: false` with a parser error message if applicable, or an "expression evaluates to the wrong truth table" message if it parsed but isn't equivalent.
5. **Pressing `Submit` with a syntactically invalid form** highlights the error position in the editor (CM6 diagnostic), and the agent's next Action is a `rephrase` or `simpler_item` per the bounded menu.
6. **Keyboard navigation works** out of the box (CM6's default keymap is preserved).
7. **`prefers-reduced-motion`** is respected — line-highlight transitions during pulse are instant.
8. **When F-03's PulseContext is live, during a pulse triggered from the Circuit**, the line in the pseudocode editor corresponding to the active gate evaluation highlights at the same beat as the pulse.

## Testing requirements

- Component tests: editor mounts, syntax highlighting fires, submit captures the source.
- Unit tests for `parsePseudocode`: every L1 expression has at least 2 equivalent pseudocode forms (`a and b` vs `(a) and (b)`) that both parse to the same AST.
- Property test: any string `parsePseudocode` returns successfully then `evaluate`s to the same truth table as the canonical form generated from that AST.
- A11y: axe-core on the editor; keyboard-only flow asserts submit reachable via Tab/Enter.

## Manual setup required

None.

## Convergence and expected rework

⚠ **Renderer switch file convergence** with F-02 and F-03.

⚠ **PulseContext consumer (T-04d)** depends on F-03's producer. Same strategy as F-02: open F-04's PR without T-04d, land it, then add T-04d as a follow-up once F-03 has merged. Acceptance criterion 8 is deferred until F-03 lands.

⚠ **`packages/booleans` extension** in T-04b is the only contract *extension* (not just consumption) F-04 needs. Coordinate with whoever's running F-02/F-03: if they need parser changes for their own reasons, batch them. Otherwise F-04 adds `parsePseudocode` as a strictly new export and merges cleanly.

⚠ **Submission payload shape convergence** on the rep-tagged union — see F-02.

## Implementation notes (filled in by the building agent)

> Empty.
