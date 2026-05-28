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
 * Strategy: check the row-count first; if any rows exist skip the seed entirely.
 * This keeps the operation O(1) on already-seeded deployments and avoids ON
 * CONFLICT complexity given the item_id primary key.
 *
 * Validates every item against the Zod schema before inserting.
 */
export async function seedTransferBank(db: Db): Promise<void> {
  // Idempotency guard: skip if any rows already exist.
  const result = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*) AS count FROM transfer_bank`,
  );
  const existing = Number(result.rows[0]?.count ?? 0);
  if (existing > 0) {
    return;
  }

  const raw: unknown = JSON.parse(fs.readFileSync(seedFilePath(), 'utf8'));
  const items = TransferItemFile.parse(raw);

  await db.insert(transferBank).values(
    items.map((item) => ({
      itemId: item.itemId,
      lessonId: item.lessonId,
      targetExpression: item.targetExpression,
      truthTable: item.truthTable,
      targetRep: item.targetRep,
      hiddenReps: item.hiddenReps,
    })),
  );
}
