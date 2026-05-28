/**
 * seedTransferBank idempotency. Runs against a real Postgres — provisioned via the
 * shared `ensureTestPg` helper (an external `TEST_POSTGRES_URL`, else a throwaway
 * Docker container). It only skips when the environment has neither a DB URL nor
 * Docker — a genuine capability gap, not a default.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client.js';
import { runMigrations } from './migrate.js';
import { seedTransferBank } from './seed.js';
import { canRunPg, ensureTestPg } from './testPg.js';
import pg from 'pg';

describe.skipIf(!canRunPg)('seedTransferBank — idempotency', () => {
  let db: Db;
  let pool: pg.Pool;

  beforeAll(async () => {
    const connectionString = await ensureTestPg();
    // Fresh container has no schema — apply migrations so `transfer_bank` exists.
    await runMigrations(connectionString);

    const client = createDb(connectionString);
    db = client.db;
    pool = client.pool;

    // Clean the table before the test so we can seed from scratch.
    await db.execute(sql`DELETE FROM transfer_bank`);
  }, 60000);

  afterAll(async () => {
    await pool.end();
  });

  it('seeds 32 rows on first call', async () => {
    await seedTransferBank(db);
    const result = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) AS count FROM transfer_bank`,
    );
    expect(Number(result.rows[0]?.count)).toBe(32);
  });

  it('is idempotent — second call does not duplicate rows', async () => {
    await seedTransferBank(db);
    const result = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) AS count FROM transfer_bank`,
    );
    expect(Number(result.rows[0]?.count)).toBe(32);
  });

  it('repairs a partial seed — re-seeds missing rows after a manual delete', async () => {
    // Simulate a partial/stale bank (e.g. a prior deploy left only some lessons).
    await db.execute(sql`DELETE FROM transfer_bank WHERE lesson_id <> 1`);
    const partial = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) AS count FROM transfer_bank`,
    );
    expect(Number(partial.rows[0]?.count)).toBe(8);

    // The upsert-based seed reconciles back to the canonical 32 (a COUNT>0 skip
    // would have stranded the bank at 8 forever).
    await seedTransferBank(db);
    const repaired = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) AS count FROM transfer_bank`,
    );
    expect(Number(repaired.rows[0]?.count)).toBe(32);
  });

  it('has 8 rows per lesson', async () => {
    for (const lessonId of [1, 2, 3, 4]) {
      const result = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*) AS count FROM transfer_bank WHERE lesson_id = ${lessonId}`,
      );
      expect(Number(result.rows[0]?.count), `lesson ${lessonId}`).toBe(8);
    }
  });
});

