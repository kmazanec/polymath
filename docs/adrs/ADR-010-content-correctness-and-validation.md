# ADR-010: Five-layer content-validation strategy with deterministic truth-table checking as the floor and held-out transfer bank as the ceiling

**Status:** Accepted · **Date:** 2026-05-27 · **Stretch:** no
**Supersedes:** none · **Superseded by:** none

## Context

The brief calls content correctness "non-negotiable" and lists deterministic checks first in its content-validation guidance, ahead of rubrics, external references, human review, model critique, answer verification, and constrained generation. Generated artifacts in our prototype include: practice items, hints, explain-back rubric judgments, distractors, and conversational Q&A responses.

[ADR-001](./ADR-001-learning-domain-boolean-logic.md) commits to Boolean logic, where equivalence checking is trivially decidable via truth-table comparison for any expression up to ~8 variables — well above what any of our lessons need (≤4 variables).
[ADR-002](./ADR-002-curriculum-scope-and-mvp-cut.md) commits to a hand-curated held-out transfer bank.
[ADR-005](./ADR-005-adaptive-ui-runtime-contract.md) commits to a typed `Action` schema; the agent never invents components.

This ADR locks the validation strategy across every content surface.

## Options considered

**A — Single approach: Run an LLM-as-judge after every content generation.** Brittle; the LLM-as-judge is itself prone to the errors it's meant to catch; the brief explicitly prefers deterministic checks first.

**B — Single approach: Only deterministic checks; refuse all LLM-generated free-form content.** Maximally rigorous; loses the adaptive remediation that the inner agent ([ADR-003](./ADR-003-statechart-plus-bounded-inner-agent.md)) is designed to provide. Too rigid for a brief that also asks for adaptive remediation.

**C — Five-layer strategy, deterministic where possible, hand-curated where stakes are highest, LLM-judgment only where deterministic checks cannot reach (chosen).**

**D — Outsource correctness to a vendor (Wolfram Alpha, Khan Academy's content API, Open Stax).** Plausible for other domains; for Boolean logic specifically, the truth-table compare is faster, simpler, and gives us full control.

## Decision

Five layers, each defending a different content surface:

### Layer 1 — Learner submission validation

**Deterministic JavaScript truth-table compare, client-side.**

For any submission (truth-table, circuit, or pseudocode):
1. Parse the submission into a canonical Boolean expression AST.
2. Enumerate all 2^n assignments of the relevant variables (n ≤ 6 in practice).
3. Compare to the target expression's truth-table.
4. Equivalent iff truth-tables match cell-for-cell.

Runs in <1ms for n ≤ 6. No network, no LLM, no possibility of false acceptance.

This validator is the **single source of truth for correctness**. Every other layer ultimately delegates here.

### Layer 2 — Agent-generated practice item validation

**Agent must commit to the answer up front; validator confirms before the item reaches the client.**

When the inner agent proposes a new `CircuitBuilder`, `TruthTablePractice`, or `PseudocodeChallenge` component via an `Action`, the payload includes:
- `targetExpression: string` — the expression the learner is meant to reproduce
- `claimedTruthTable: number[]` — the agent's claim of the canonical truth table

Server-side, before the Action is forwarded to the client:
1. Parse `targetExpression`.
2. Independently compute its truth table via Layer 1 validator.
3. Compare to `claimedTruthTable`.
4. If they disagree, reject the Action and retry the agent **once** with the validation error in the prompt.
5. If retry fails too, fall back to a hand-curated practice item from a small backup bank (~5 items per lesson, hand-authored in week 1).

**Property:** for any agent-generated practice item that reaches the client, the truth-table is correct. This is enforceable as a unit test.

### Layer 3 — Hint text validation

**Hand-curated hint templates with LLM-filled slot text; free-form hints flagged but not blocked.**

Three hint levels per item:
- **Level 1 (light touch):** Templated. "Look at the [GATE] gate first. What does it output when both inputs are [STATE]?" LLM fills `[GATE]` and `[STATE]` from a typed enum.
- **Level 2 (concrete):** Templated. "Try setting [VAR_1] to [BOOL] and [VAR_2] to [BOOL]. What's the output of [SUB_EXPRESSION]?" LLM fills slots from a typed enum.
- **Level 3 (deep):** Free-form LLM-authored prose. Logged with rationale. **Logged but not deterministically validated** — the prose is too varied to validate without a second LLM call.

Free-form Level 3 hints are flagged in the per-session log as `validatorStatus: 'unverified_prose'`. The eval scenario bank includes labelled L3 hints (good/bad) that LangSmith continuously checks against, but no hard gate in production.

The honest claim: *"Generated artifacts pass deterministic correctness checks where possible; deep hints are LLM-authored, logged for review, and continuously evaluated against a labelled scenario bank."*

### Layer 4 — Explain-back rubric

**Multi-step LangGraph subgraph: deterministic preconditions first, LLM-as-judge only if preconditions pass.**

The rubric runs in two stages:

**Stage 4a — Deterministic preconditions (all five required):**
1. Response duration ≥3 seconds (anti-empty)
2. Response duration ≤15 seconds (anti-rambling, anti-LLM-pasting)
3. Word count ≥10 (anti-empty)
4. Contains at least one of the lesson's KC vocabulary terms ("AND", "OR", "NOT", "true", "false", "output", "input", "gate", "expression", etc. — a maintained deterministic list per lesson)
5. **Contains at least one reference to the specific item.** This is load-bearing: the explanation must reference the variable names (`A`, `B`, etc.) or the specific operators in the expression the learner just solved. Detected by regex against the item's known token set.

If **any** precondition fails → automatic rubric fail; no LLM call; learner sees a stock retry prompt explaining what was missing (e.g., "Try referring to the specific gates you used in that problem").

**Stage 4b — LLM-as-judge (only if all preconditions pass):**

LangGraph subgraph: transcribe → classify the explanation kind → check for item-specific reasoning vs. memorised generic → judge prosody disfluency (filled pauses, restarts) for thinking-vs-reading patterns → score against rubric → emit verdict.

Rubric criteria (each judged independently):
- Does the explanation correctly describe the Boolean reasoning used?
- Does it reference the specific expression in front of the learner?
- Does prosody match thinking-while-speaking, not reading from elsewhere?

Each judgment is logged. The eval scenario bank in `evals/explain_back/` contains ~30 labelled pass/fail recordings (hand-curated, week 1–2 deliverable) that LangSmith continuously checks against. Threshold for production: ≥90% agreement with hand labels.

### Layer 5 — Transfer-probe items

**Hand-curated bank, committed week 1. Never LLM-generated.**

Already locked in [ADR-002](./ADR-002-curriculum-scope-and-mvp-cut.md). Restated for completeness: transfer items are authored at planning time, stored in the `transfer_bank` Postgres table, and pulled from at runtime. The bank covers all four MVP+stretch lessons: ~8 items per lesson × 4 lessons = ~32 items.

Each transfer item has:
- A target expression
- A canonical truth table (hand-verified)
- A representation tag specifying which surface form (circuit / truth-table / pseudocode) the learner must produce
- A `hiddenReps` field specifying which representations are hidden during the probe (e.g., for a "produce the circuit" probe, the circuit canvas is *shown* but the symbolic expression starts from a *word-problem-form*; for a "produce the pseudocode" probe, the circuit is *hidden*)

### Distractor generation (specific case)

The agent may generate multiple-choice distractors for some question types. Distractors get the same Layer 2 treatment:
1. Agent proposes `distractorExpression` + `claimedDistractorTruthTable`.
2. Validator confirms the truth table.
3. **Additional check:** the distractor's truth-table must differ from the target's by **exactly one cell** (a near-miss) or by a known-misconception pattern (e.g., the "halfway De Morgan" cell pattern). Distractors that match the target are rejected; distractors that bear no relation to the target (random nonsense) are rejected.

Validated distractors are stored back in a `validated_distractors` table for re-use — reduces future LLM calls and grows a quality bank over time.

## Rationale

Each layer answers a specific brief concern:

1. **Layer 1** (truth-table compare) — answers "deterministic checks" verbatim. Bulletproof, demoable in one sentence: *"every learner submission is checked against the canonical truth table, computed independently of the LLM."*

2. **Layer 2** (agent commits answer + validator confirms) — answers "validated where possible." Crucially, this *separates the agent's role* (proposer of content) *from the validator's role* (judge of correctness). The agent is never the source of correctness; the validator is. This separation is a defense pattern the evaluator will recognise.

3. **Layer 3** (templated hints + logged free-form) — honest about where deterministic validation cannot reach. The eval bank for L3 hints is the substitute defense; the per-session log is the audit trail.

4. **Layer 4** (preconditions + LLM judge) — the explain-back rubric is the hardest case because natural-language reasoning resists deterministic check. The preconditions are the **structural defense**: a learner who cannot speak fluently about THIS specific item, in the time available, with the right vocabulary, fails before any LLM is invoked. Only after structural pass does the LLM judge content quality. This is the strongest defensible answer to "how do you validate verbal explanation" we can construct.

5. **Layer 5** (hand-curated transfer bank) — the strictest layer for the highest-stakes assessment. Transfer items decide mastery; they cannot be LLM-generated under any circumstances. The bank size (~32 items) is feasible at planning time.

**Defensibility for Nerdy specifically:**

- **Hunigan (VP AI, ex-Capacity)** will recognise the "agent proposes, validator confirms" pattern — it's the defensible answer to LLM-content-correctness in any production AI product. He's seen the failure mode where teams trust the LLM to grade itself.
- **Dalmia (VP Eng)** will appreciate the typed `Action` payload with explicit `claimedTruthTable` field, the validator as a separate code path, and the unit-testable property ("every reaching-the-client item has a correct truth-table"). It's contract-engineering thinking.
- **The five-layer framing itself is a demo asset** — slide 4 of the demo deck names each layer and what it defends against.

## Tradeoffs & risks

- **Layer 2 fallback to hand-curated bank** means if the agent fails twice and the bank is empty, the lesson stalls. Mitigation: bank is sized to ~5 items per lesson; agent-success-rate eval gates merges to ensure ≥95% pass on first try.

- **Layer 3 free-form L3 hints are unverified.** Mitigation: continuous LangSmith eval against a labelled bank; per-session logs flag L3 hints for review; if a session has more than one L3 hint, the learner is offered a "report a bad hint" affordance.

- **Layer 4 preconditions can be gamed.** A learner who knows the rules can craft an explanation that hits the keyword checklist without understanding. Mitigation: the item-specific reference check is the load-bearing one; the LLM judge stage 4b catches generic-keyword-stuffed explanations. Adversarial eval scenarios in the bank test this directly.

- **Layer 4 LLM-as-judge is itself an LLM.** Mitigation: only invoked after deterministic preconditions; judgment is on a small set of yes/no criteria, not free-form scoring; ≥90% agreement with hand labels is the gate; the judge sees prosody signals an STT-only judge cannot.

- **Distractor near-miss check is heuristic.** A "exactly one cell different" distractor may not be the most pedagogically useful for every item. Mitigation: also allow "known misconception pattern" distractors (e.g., halfway-De-Morgan); hand-curated misconception patterns per lesson.

- **Transfer bank is small (~32 items).** A repeat learner in eval could memorise transfer items. Mitigation: at MVP scale, each evaluator sees a session once; for production we'd grow the bank to 100+ items and rotate. Documented in Limitations.

- **The validation pipeline adds latency** to agent turns. Mitigation: Layer 1 runs in <1ms; Layer 2's truth-table compare in <5ms server-side; Layer 4a's preconditions in <50ms; Layer 4b is the only one with LLM latency. Most turns hit only Layers 1–2 and add <10ms.

- **The agent might be tempted to commit to a "claimed truth table" the agent never actually computed.** Mitigation: validator runs *server-side* before the Action ships, independent of the agent's reasoning. The validator does not trust the agent.

## Consequences for the build

- **`packages/booleans`** — pure-TypeScript Boolean expression parser, AST, evaluator, truth-table generator, equivalence checker. ~500 lines, fully tested. Imported by both `apps/web` (client validator) and `apps/agent` (server validator). Single source of truth.
- **`packages/contract`** — Action schema gains `claimedTruthTable: number[]` field on item-generating action variants; Zod schema validates the field shape.
- **`apps/agent/src/validate/`** — Layer 2 + Layer 4a code; Layer 4b LangGraph subgraph lives in `packages/graph/explainback`.
- **`apps/agent/src/fallback_bank/`** — hand-curated backup practice items (per-lesson JSON), loaded at agent boot.
- **`db.transfer_bank`** — Postgres table, seeded from `seed_data/transfer_items.json` on migration; never written to at runtime.
- **`db.validated_distractors`** — Postgres table, written by the distractor validator on success.
- **`evals/`** — LangSmith eval scenarios for: agent practice-item correctness (Layer 2), explain-back preconditions (Layer 4a), explain-back judgments (Layer 4b), distractor near-miss validity. CI runs evals on PR; threshold ≥90% / ≥95% per scenario type.
- **Per-session log shape** — gains a `validation` field per Action: `{layer: 1|2|3|4, status: 'pass'|'reject'|'unverified_prose', detail: string}`.
- **Limitations memo** documents: transfer bank size (~32, growable), L3 hint unverified status, transfer-item repeat across sessions (a production concern, not an MVP concern).
- **Demo asset** — slide 4 of the deck shows the five layers diagrammatically with what each defends against. The phrase: *"Generated artifacts pass deterministic correctness checks where possible; everything else is logged and continuously evaluated."*
