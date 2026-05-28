# Feature: Transfer bank seed (32 hand-curated items, all 4 lessons)

**ID:** F-08 · **Iteration:** I1 — Lesson 1 cross-rep gym · **Status:** Not started

## What this delivers (before → after)

**Before:** `db.transfer_bank` is an empty table. No transfer probe item exists. F-07 (the transfer-probe consumer) has nothing to pull from.

**After:** `db.transfer_bank` is seeded with **32 hand-authored, hand-verified transfer items** — 8 per lesson × 4 lessons (L1, L2, L3, L4), authored in `seed_data/transfer_items.json` and loaded on migration. Every item has: a target expression, a canonical truth table (hand-verified), a `targetRep` (which rep the learner must produce), a `hiddenReps` array, an item ID, and a difficulty tier. The bank is never written to at runtime — it is the read-only source for F-07's transfer probes and F-16's chat-baseline pre/post tests.

The bank covers *all four MVP-and-stretch lessons even though L3+L4 are stretch* — this is the hand-curation tax called out in [ADR-002](../adrs/ADR-002-curriculum-scope-and-mvp-cut.md) that has to be paid upfront. If stretch is cut, the L3/L4 items remain unused but their existence at planning time was the right insurance.

## How it fits the roadmap

I1, **on the critical path for I1's MVP cut**. F-07 cannot land its acceptance criteria until F-08 has merged. Concurrent with F-02..F-07 — touches only `seed_data/` + a Drizzle migration; zero file overlap with reps/agent/statechart.

Hand-authoring is the bottleneck — best done in parallel with engineering work by a different sub-agent (or Keith).

## Dependencies (must exist before this starts)

- **F-01** — `transfer_bank` table schema in Drizzle; `packages/booleans` to verify each item's truth-table at authoring time.

## Unblocks (what waits on this)

- **F-07** — transfer probe consumer.
- **F-16** — chat-baseline app's pre/post tests pull from this bank.
- **F-22** — L3 transfer items already in the bank when F-22 starts.
- **F-23** — L4 transfer items already in the bank when F-23 starts.

## Contracts touched

- **`transfer_bank` table schema** — locked here. Columns: `id`, `lesson_id`, `target_expression`, `canonical_truth_table` (JSONB), `target_rep`, `hidden_reps` (JSONB), `difficulty_tier`, `created_at`.
- **`seed_data/transfer_items.json`** — the data file. Source of truth for the bank; migration loads from this.
- **Drizzle migration** — `migrations/NNNN_seed_transfer_bank.sql` (or programmatic via Drizzle's seed feature). Runs once at container boot; idempotent (skip if rows exist).

## Sub-tasks

1. **T-08a — Author L1 items (8 items)** `[parallel]`
   - 2 items per difficulty tier × 4 tiers (intro, basic, harder, hardest).
   - Cover all three target-rep × hidden-reps combinations:
     - 3 items with `targetRep: 'circuit'`, `hiddenReps: ['truth_table']`
     - 3 items with `targetRep: 'pseudocode'`, `hiddenReps: ['circuit']`
     - 2 items with `targetRep: 'truth_table'`, `hiddenReps: ['pseudocode']`
2. **T-08b — Author L2 items (8 items)** `[parallel]`
   - Same distribution; composition + XOR-as-composition examples.
3. **T-08c — Author L3 items (8 items)** `[parallel]`
   - NAND-universality items: target expressed as NAND-only equivalent of a basic-operator expression.
4. **T-08d — Author L4 items (8 items)** `[parallel]`
   - De Morgan's law items, including 2 items specifically constructed to catch the "halfway application" misconception.
5. **T-08e — Verification harness** `[parallel after T-08a..T-08d]`
   - Test: every item in `seed_data/transfer_items.json` parses, `packages/booleans.truthTable(target_expression)` matches the stored `canonical_truth_table` exactly.
   - This test is the gate; PR cannot merge if any item fails.
6. **T-08f — Drizzle migration** `[serial after T-08a..T-08d]`
   - Idempotent seed migration.

## Acceptance criteria (product behavior)

1. **`db.transfer_bank` contains exactly 32 rows after a fresh deploy**, 8 per lesson (L1, L2, L3, L4).
2. **Every row's `canonical_truth_table` matches `packages/booleans.truthTable(target_expression)`** — asserted by a verification test in CI.
3. **No two rows in the bank share the same `target_expression` within a lesson** (uniqueness check).
4. **Every L1 row has at least one item per `(target_rep, hidden_reps)` combination** that F-07's probe selection logic uses.
5. **L4 items include at least 2 items engineered around the "halfway De Morgan" misconception** — items where a learner who flips the negation but forgets to flip the operator produces a different-by-one-cell truth table.
6. **`seed_data/transfer_items.json` validates against a Zod schema** for the bank shape; CI gates on this.
7. **Re-running migrations is idempotent** — the bank does not duplicate.
8. **F-07's probe selection from the bank works against the seeded data** — F-07's integration test, run after F-08 merges, drives a transfer probe end-to-end using a real bank item.

## Testing requirements

- Schema validation test for `seed_data/transfer_items.json`.
- Item correctness test: every item's truth table verified via `packages/booleans`.
- Migration idempotency test.
- Uniqueness test (within-lesson `target_expression` uniqueness).

## Manual setup required

- **Hand-authoring the 32 items.** Estimate: ~half day per lesson = 2 days total. Schedulable to Keith or to a dedicated "content sub-agent" with a clear authoring prompt. The L3/L4 items can be drafted by a sub-agent and then hand-reviewed/corrected by Keith.
- Misconception research for L4 items — refer to Almstrum 1996 (already cited in [ADR-001](../adrs/ADR-001-learning-domain-boolean-logic.md)).

## Convergence and expected rework

None expected — pure additive, single-file `seed_data` + single migration. No convergence with other I1 features.

## Implementation notes (filled in by the building agent)

### Shared-contract reality (read the CODE, not just this spec)

- **The shipped `transfer_bank` schema** (`apps/agent/src/db/schema.ts`, `transferBank`) has
  columns: `item_id` (PK, text), `lesson_id` (int), `target_expression` (text), `truth_table`
  (jsonb, 0/1 ints MSB-first), `target_rep` (text), `hidden_reps` (jsonb). **It does NOT have
  the `difficulty_tier` or `created_at` columns this spec's "Contracts touched" section
  mentions.** Trust the code: seed against the shipped columns. Record `difficultyTier` in the
  JSON seed file for authoring/coverage purposes, but **do not add a DB column** for it — the
  divergence is flagged to Keith for a later schema decision. Do not edit `schema.ts`.
- **Booleans is consumed read-only** to verify each item's truth table; do not modify it.
- **Zero file overlap** with the rep features — touches only `seed_data/`, a new seed runner,
  and the agent's boot sequence. No `registry.tsx`, no wire, no contract edits.

### Scope (files you may touch)

- `seed_data/transfer_items.json` (new) — the 32-item data file.
- `apps/agent/src/lessons/transferBankSchema.ts` (or similar, new) — Zod schema for the file.
- `apps/agent/src/db/seed.ts` (new) — idempotent seed runner.
- `apps/agent/src/db/migrate.ts` — call the seed after `migrate()` on boot (small additive edit).
- Test files alongside the above.

### Implementation plan (checklist)

- [x] **Chunk 1 — Zod schema for the seed file.** `TransferItem` + `TransferItemFile` schemas in
  `apps/agent/src/lessons/transferBankSchema.ts`. Reuses `Rep` from `@polymath/contract`.
  `difficultyTier` is in the schema (for JSON authoring) but not the DB column — divergence
  flagged below.
- [x] **Chunk 2 — Author L1 items (T-08a, 8 items).** Matrix covered exactly:
  3× circuit/[truth_table] (L1-01, L1-02, L1-03); 3× pseudocode/[circuit] (L1-04, L1-05, L1-06);
  2× truth_table/[pseudocode] (L1-07, L1-08). All L1 = AND/OR/NOT only. All expressions unique.
- [x] **Chunk 3 — Author L2/L3/L4 items (T-08b/c/d, 24 items).** L2: XOR-as-composition
  `(A AND NOT B) OR (NOT A AND B)`, XNOR, odd-parity, majority function, and distributive
  compositions. L3: 8 NAND-universality items expressed in AND/OR/NOT (NAND framing in `_nandNote`
  JSON field, stripped by Zod before DB insert). **FLAG FOR KEITH: L3/L4 items are stretch content
  (ADR-002) and need pedagogical review before L3/L4 lessons go live.** L4: 6 De Morgan items
  plus 2 halfway-misconception items (`L4-07-halfway`, `L4-08-halfway`): `NOT(A AND B OR C)` and
  `NOT(A OR B AND C)` — the halfway error (keeping outer operator, distributing NOT) produces a
  different-by-3-to-4-cells truth table in each case.
- [x] **Chunk 4 — Verification test (T-08e, the merge gate).** 9 DB-free tests in
  `apps/agent/src/lessons/transferBankSchema.test.ts` covering: schema parse, 32-item count,
  8/lesson distribution, truth-table correctness (every item verified by `@polymath/booleans`),
  within-lesson expression uniqueness, L1 matrix coverage (3+3+2), and L4 halfway-item count (>=2).
- [x] **Chunk 5 — Idempotent seed runner (T-08f).** `seedTransferBank(db)` in
  `apps/agent/src/db/seed.ts`. Row-count guard: if `COUNT(*) > 0` returns immediately.
  Wired into `runMigrations()` in `apps/agent/src/db/migrate.ts`. DB-gated idempotency test
  in `apps/agent/src/db/seed.test.ts` (auto-skipped without `TEST_POSTGRES_URL`/`POSTGRES_URL`).

### Schema divergence flag (for Keith)

**`difficultyTier` is in `seed_data/transfer_items.json` but NOT in the DB `transfer_bank` table.**
The shipped `schema.ts` has columns: `item_id`, `lesson_id`, `target_expression`, `truth_table`,
`target_rep`, `hidden_reps`. The spec's "Contracts touched" section mentioned `difficulty_tier`
and `created_at` columns — these were NOT added in F-01. The seed JSON preserves `difficultyTier`
for authoring/coverage purposes; Zod strips it before DB insertion. If difficulty-stratified probe
selection is needed at query time, a future migration adding the column to the DB table is required.

### L3/L4 review flag (for Keith)

L3 NAND-universality items are expressed in AND/OR/NOT grammar with `_nandNote` annotations
explaining the NAND-chip framing. These annotations are stripped by Zod before DB insertion.
The validator (`@polymath/booleans`) cannot parse NAND syntax yet (F-22). Keith should review:
1. The NAND-universality pedagogical framing in L3 items (L3-01 through L3-08).
2. The De Morgan halfway-misconception items (L4-07-halfway, L4-08-halfway) for correctness.

### Test command

`pnpm --filter @polymath/agent exec vitest run src/lessons/transferBankSchema.test.ts`

### Build verification evidence

```
 ✓ agent  src/lessons/transferBankSchema.test.ts (9 tests) 9ms
 ✓ agent  src/db/seed.test.ts (4 tests | 3 skipped) 1ms

 Test Files  2 passed (2)
       Tests  10 passed | 3 skipped (13)
    Start at  08:59:27
    Duration  409ms (transform 56ms, setup 0ms, collect 246ms, tests 10ms, environment 0ms, prepare 74ms)
```

All 9 DB-free verification/schema/matrix/uniqueness tests pass. 3 DB-gated idempotency tests
auto-skip without Postgres (they will run in CI against the sibling Postgres container).
