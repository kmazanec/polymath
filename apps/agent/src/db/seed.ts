import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { type Db } from './client.js';
import { transferBank } from './schema.js';
import { TransferItemFile } from '../lessons/transferBankSchema.js';

/**
 * Resolve the seed file relative to this compiled module's location.
 *
 * Source layout:  apps/agent/src/db/seed.ts
 * Compiled layout: apps/agent/dist/db/seed.js  (4 levels up → repo root)
 * Repo root:      <root>/seed_data/transfer_items.json
 *
 * At runtime the import.meta.url resolves correctly whether running via tsx
 * (source) or node (dist), so we walk up to the repo root from this file.
 */
function seedFilePath(): string {
  // src/db/seed.ts → ../../../../seed_data/ = repo root
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../seed_data/transfer_items.json',
  );
}

/**
 * Idempotently seed the `transfer_bank` table from `seed_data/transfer_items.json`.
 *
 * Strategy: **upsert keyed on `item_id`** (every boot reconciles the table to the
 * canonical file). A `COUNT(*) > 0` skip would permanently strand a partial or
 * stale bank — e.g. if a prior deploy left only some lessons, future boots would
 * never repair it. The upsert is cheap at lesson scale (32 rows) and self-healing.
 *
 * Validates every item against the Zod schema before inserting.
 */
export async function seedTransferBank(db: Db): Promise<void> {
  const raw: unknown = JSON.parse(fs.readFileSync(seedFilePath(), 'utf8'));
  const items = TransferItemFile.parse(raw);

  await db
    .insert(transferBank)
    .values(
      items.map((item) => ({
        itemId: item.itemId,
        lessonId: item.lessonId,
        targetExpression: item.targetExpression,
        truthTable: item.truthTable,
        targetRep: item.targetRep,
        hiddenReps: item.hiddenReps,
      })),
    )
    .onConflictDoUpdate({
      target: transferBank.itemId,
      set: {
        lessonId: sql`excluded.lesson_id`,
        targetExpression: sql`excluded.target_expression`,
        truthTable: sql`excluded.truth_table`,
        targetRep: sql`excluded.target_rep`,
        hiddenReps: sql`excluded.hidden_reps`,
      },
    });
}
