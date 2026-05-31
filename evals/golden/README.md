# Golden set + labeled scenario banks (F-32 / ADR-017)

This directory owns the **named golden set** of deterministic agent scenarios that
runs on every MR with no API key and must pass 100%, plus **labeled scenario banks**
judged live on protected `main` at stated agreement thresholds.

## Directory layout

```
evals/golden/
  README.md        ← this file
  move.json        ← heuristic-move golden cases (adversarial + pedagogical)
  generation.json  ← generated-challenge validity cases
  prompt.json      ← prompt-presence golden cases (schema enforcement)
  spoken.json      ← topic-classification golden + spoken-groundedness live fixtures
```

The **golden set** = `golden.test.ts` 100%-offline assertions over all four JSON
banks above, PLUS the existing inner-agent scenarios in
`apps/agent/src/agent/eval/scenarios.json` (folded in by `eval.test.ts` — run in
place, not re-homed).

---

## Fixture format (`{ note, fixtures: Fixture[] }`)

Every file in this directory follows the same top-level shape:

```jsonc
{
  "note": "Human-readable description of this bank.",
  "fixtures": [ /* Fixture[] */ ]
}
```

### Common fields on every `Fixture`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | YES | Stable, unique within the file. Kebab-case. Used as the test label. |
| `bank` | `string` | YES | Discriminator for the bank (`"move"`, `"generation"`, `"prompt"`, `"spoken"`). |
| `expectFail` | `boolean` | NO | **Meta-check flag.** When `true`, the oracle is expected to REJECT this fixture. The runner asserts the oracle fails — this guards against a vacuously-green suite. When absent or `false`, the oracle must succeed. |
| `note` | `string` | NO | Human-readable explanation (why this case, what it tests). |

### `move` bank fixture shape

```jsonc
{
  "id": "adversarial-forged-correct-no-advance",
  "bank": "move",
  "note": "...",
  // Required: which heuristic move the oracle must produce
  "expectMove": "no_action",               // exact match, OR
  "expectMoveOneOf": ["rephrase", "simpler_item"], // set match (use one of these)
  // Optional adversarial inputs (server-derived in production)
  "lessonId": 1,
  "event": { "kind": "submit", "itemId": "l1-and", "submission": "A AND B", "correct": true },
  "learnerState": { "consecutiveCorrect": 1, "hintsUsed": 0, "ruleGatePassed": false },
  "hintsByItem": {},
  "priorMissesByItem": {},
  "inTransferProbe": false,
  "transferCandidates": []
}
```

### `generation` bank fixture shape

```jsonc
{
  "id": "valid-and-expression",
  "bank": "generation",
  "note": "...",
  // The proposed item the oracle validates
  "expression": "A AND B",
  "claimedTruthTable": [0, 0, 0, 1],
  // Expected outcome
  "expectValidity": "valid",      // OR one of the reject reasons below
  // "expectValidity": "reject_unparseable"
  // "expectValidity": "reject_over_var_cap"
  // "expectValidity": "reject_wrong_key"
  // "expectValidity": "reject_prompt_missing"  (future — F-29 adds prompt)
  // Meta-check: set expectFail:true on a deliberately wrong fixture
  "expectFail": false
}
```

**Single correctness source:** validity reuses the SAME var-capped `@polymath/booleans`
path that `layer2.ts` uses — `parse` → `variables` → var-cap → `truthTable`. No
separate correctness oracle.

### `prompt` bank fixture shape

```jsonc
{
  "id": "prompt-present-truth-table",
  "bank": "prompt",
  "note": "...",
  // A ComponentSpec-like object to schema-check
  "componentSpec": {
    "kind": "TruthTablePractice",
    "expression": "A AND B",
    "claimedTruthTable": [0, 0, 0, 1],
    "visibleReps": ["truth_table"],
    "prompt": "Fill in the truth table for A AND B."   // present → pass
  },
  "expectPromptPresent": true,  // true = must have a non-empty string prompt
  "expectFail": false           // meta-check: expectFail:true means oracle should reject
}
```

The four item kinds that gain `prompt` in I7 (F-27/F-29): `TruthTablePractice`,
`CircuitBuilder`, `PseudocodeChallenge`, `TransferProbe`.

### `spoken` bank fixture shape

```jsonc
{
  "id": "on-topic-and-gate",
  "bank": "spoken",
  "note": "...",
  // The learner's spoken turn
  "question": "what does the AND gate do?",
  // Golden (offline) topic-classification check
  "expectTopic": "on_topic",       // OR "off_topic"
  // Live groundedness check (only run with OPENAI_API_KEY)
  "answer": "The AND gate outputs 1 only when both inputs are 1.",
  "expectGrounded": true   // the answer is factually grounded in Boolean logic
}
```

---

## Adding a golden case (offline, no API key)

1. Choose the bank file: `move.json`, `generation.json`, `prompt.json`, or `spoken.json`.
2. Add a new `Fixture` object to `fixtures[]` with a **stable unique `id`** and
   `"bank": "<bank-name>"`.
3. Set `expectFail: false` (the default) for a case the oracle must pass, or
   `expectFail: true` for a deliberate negative-control (meta-check).
4. Run `pnpm --filter @polymath/agent exec vitest run src/agent/eval/golden.test.ts`.
5. Green = done. Red = fix the case or the oracle.

**Invariants:** IDs must be unique within the file. The runner asserts non-empty banks
and unique IDs as a meta-check (a bank with zero cases or a collision is a bug, not
a pass).

## Adding a live scenario (key-gated, protected main only)

1. Add the fixture as above, with the bank-appropriate live fields
   (`expectGrounded`, etc.).
2. Confirm the offline fields pass first (run the offline golden suite).
3. The live gate (`liveIt`) runs in `agent_live_eval` CI job (protected `main` only;
   `when: never` on MRs). It self-skips locally without `OPENAI_API_KEY`.
4. The `agent_live_eval` job agreement thresholds (from ADR-017):
   - move ≥95% (OpenAI provider vs labeled scenarios)
   - generation-appropriateness ≥95%
   - spoken-groundedness ≥90%
   - explain-back ≥90% (owned by `evals/explain_back/` / `@polymath/graph`)

## CI policy (ADR-006 / ADR-017)

| Job | When | Key | What runs |
|-----|------|-----|-----------|
| `agent_test` (existing) | Every MR + main push | None | `pnpm --filter @polymath/agent test` incl. `golden.test.ts` offline 100% |
| `agent_live_eval` (F-32) | main push auto; `when:never` on MR; manual otherwise | `OPENAI_API_KEY` | `golden.test.ts` live gates + `eval.test.ts` live gate |
| `explain_back_live_eval` (existing) | main push auto; `when:never` on MR | `OPENAI_API_KEY` | explain-back judge ≥90% |

**Never expose `OPENAI_API_KEY` to MR pipelines.**

## Ownership

- `evals/golden/` — F-32 owns the format, seeds, and runner (`golden.test.ts`).
- F-29 appends generation fixtures to `generation.json` as it lands.
- F-30 appends spoken fixtures to `spoken.json` as it lands.
- The existing `scenarios.json` / `eval.test.ts` (inner-agent) and
  `evals/explain_back/fixtures.json` / `eval.test.ts` (explain-back) are folded in
  unchanged at their current gates.
