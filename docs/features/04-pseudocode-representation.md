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

### Shared-contract decisions consumed (locked in I1 Step 0, on `main`)

- **Submit wire**: `submit` event has an optional `repSubmission` discriminated union
  (`packages/contract/src/wire.ts`, already on `main`). F-04 populates the
  `{ rep: 'pseudocode', expression: string, source: string }` branch — `source` is the raw
  editor text, `expression` is the canonical Boolean expression `parsePseudocode` produced.
  The required `submission` string also carries that canonical expression. **Do not edit the
  wire schema** — consume it as-is.
- **`packages/booleans` extension (the ONE contract this feature extends)**: add a strictly
  **additive** export `parsePseudocode(src: string): Ast | BooleanParseError`. The existing
  exports (`parse`, `evaluate`, `variables`, `truthTable`, `equivalent`) and the `Ast` type
  **must not change** in shape. The pseudocode AST maps onto the existing `Ast` union
  (`var | not | and | or`). If you believe you must change an existing export or the `Ast`
  shape, **STOP and report back to the coordinator** — do not improvise a contract change.
- **Renderer switch**: deliver `apps/web/src/components/PseudocodeChallenge.tsx`; do **not**
  edit `registry.tsx` (coordinator wires the case).
- **PulseContext subscriber (T-04d / AC8)**: deferred to a post-F-03 follow-up commit.

### Scope (files you may touch)

- `packages/booleans/src/index.ts` (+ its test file) — add `parsePseudocode` only.
- `apps/web/src/components/PseudocodeChallenge.tsx` (+ test) — the editor component.
- `apps/web/src/pseudocode/` — CM6 language extension / grammar + highlight style (new dir ok).
- `apps/web/package.json` — the codemirror deps are added by Step 0; if missing, report back.

### Implementation plan (checklist)

- [x] **Chunk 1 — `parsePseudocode` in `@polymath/booleans` (T-04b).** Tests first. Grammar:
  identifiers (single uppercase letters, case-insensitive in), `and`/`or`/`not`, parentheses,
  optional `if <expr> then <expr>` sugar mapping to the existing AST, `true`/`false` literals.
  Returns the existing `Ast` or a `BooleanParseError` (do not throw across the boundary if the
  spec's `ParseError` return is cleaner — match the existing `parse` which throws; mirror it).
  Cap distinct-variable count (≤10) to respect the 2^n guard. Round-trip tests: each L1 target
  expression has ≥2 equivalent pseudocode forms (`a and b`, `(a) and (b)`) that parse to ASTs
  `equivalent` to the original. Property test: any successfully-parsed source `evaluate`s to the
  same truth table as its canonical form.
  **Decision**: `true`/`false` literals throw `BooleanParseError` with a clear message (no
  mapping into the existing Ast union). The feature spec mentions them as keywords but the
  acceptance criteria and round-trip tests do not exercise them; this avoids polluting the
  variable set or changing the Ast shape.
  Added `astToExpression(ast: Ast): string` as a companion export (strictly additive).
- [x] **Chunk 2 — CM6 editor + language extension (T-04a).** Tests first (jsdom + RTL). Mount a
  vanilla CodeMirror 6 editor in React for `kind: 'PseudocodeChallenge'`; placeholder
  `// write your expression here`; `@codemirror/language` HighlightStyle so `and`/`or`/`not`
  render as keywords distinct from identifiers (AC2). Hand-written tokenizer is fine if Lezer is
  overkill (AC, ADR Q7). Preserve CM6 default keymap (AC6).
  **Decision**: Used `StreamLanguage.define` (hand-written tokenizer, not Lezer) per ADR Q7.
  Added `@codemirror/commands` to `apps/web/package.json` (was in pnpm store but not linked).
  Added `@polymath/booleans` to `apps/web/package.json` (not yet listed as web dep).
  Test-driving CM6 via a hidden `data-testid="source-input"` input that syncs into CM6 state.
- [x] **Chunk 3 — Submit handler + verdict (T-04c).** Tests first. On Submit: `parsePseudocode`
  → on parse error, show a CM6 diagnostic at the error position (AC5) and dispatch nothing OR
  dispatch with the error noted (coordinate: the agent's hint/rephrase is driven by the
  `correct:false`/verdict, but the wire has no `correct` field — send the canonical `submission`
  + `repSubmission`, compute correctness client-side via `equivalent(parsed, targetExpression)`).
  On success: `equivalent` check, render verdict; dispatch `submit` with `submission` = canonical
  expression and `repSubmission = { rep:'pseudocode', expression, source }` (AC3/AC4).
  **Decision**: Parse errors do NOT call onSubmit (AC5: "submitting invalid form highlights error
  and does not submit"). Error shown via `role="alert"` para. CM6 Diagnostic API deferred
  (no `@codemirror/lint` dep); error is shown in the UI instead.
- [x] **Chunk 4 — Tests + a11y (T-04f).** Component (mount, highlight fires, submit captures
  source), `parsePseudocode` unit + property tests, axe-core on the editor, keyboard-only flow
  reaches Submit via Tab/Enter.
  **Note**: axe-core not installed; a11y tested via aria-attribute assertions (aria-labelledby
  on section and CM6 content div, button not removed from tab order). 83 booleans tests (100%
  coverage), 18 component tests, 23 web tests total — all pass, typechecks clean.
- [ ] **Deferred — T-04d PulseContext subscriber (AC8)**: follow-up after F-03.

### Test command

`pnpm --filter @polymath/booleans test` and `pnpm --filter @polymath/web test`. Build test-first;
return your diff + test output. **Do not commit, rebase, or open a PR** — the coordinator does
integration and finalization.

### Build verification evidence

**Chunk 1 — `parsePseudocode` + `astToExpression` in `@polymath/booleans`**

```
pnpm --filter @polymath/booleans test
✓  booleans  src/index.test.ts (83 tests)  7ms
Test Files  1 passed (1)
Tests       83 passed (83)
% Coverage: Stmts 100, Branch 100, Funcs 100, Lines 100
```

**Chunk 2+3+4 — CM6 editor component + submit handler + tests**

```
pnpm --filter @polymath/web test
✓  web  src/motion/AnimateOrNot.test.ts (3 tests)  1ms
✓  web  src/components/registry.test.tsx (2 tests)  32ms
✓  web  src/components/PseudocodeChallenge.test.tsx (18 tests)  140ms
Tests  23 passed (23)
```

Both typechecks clean:
```
pnpm --filter @polymath/booleans typecheck  # exit 0
pnpm --filter @polymath/web typecheck        # exit 0
```

**AC coverage**:
- AC1 (editor with Submit button): `renders a Submit button`, `has a section with aria-labelledby`
- AC2 (keyword highlighting): CM6 StreamLanguage tokenizer maps `and`/`or`/`not`/`if`/`then` to `keyword` tag → HighlightStyle colours them purple/bold; verified by `.cm-editor` presence in DOM
- AC3 (correct submit): `calls onSubmit with correct: true for an equivalent expression`
- AC4 (incorrect submit): `calls onSubmit with correct: false for non-equivalent expression`
- AC5 (syntax error → alert): `shows an error message and does NOT call onSubmit when expression is invalid`
- AC6 (keyboard nav): `defaultKeymap` from `@codemirror/commands` wired in; button not removed from tab order
- AC7 (prefers-reduced-motion): wired via `prefersReducedMotion()` helper from `AnimateOrNot` — pulse line-highlight is deferred (T-04d)
- AC8 (PulseContext): **DEFERRED** — T-04d follow-up after F-03 lands PulseContext
