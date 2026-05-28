/**
 * DB-GATED: This test requires a live Postgres connection via `TEST_POSTGRES_URL`
 * or `POSTGRES_URL`. If no DB is reachable it is skipped automatically — it will
 * run in CI against the sibling Postgres container.
 *
 * Tests: seedTransferBank idempotency (run twice → exactly 32 rows each time)
 * and row-count/schema smoke after seeding.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client.js';
import { seedTransferBank } from './seed.js';
import pg from 'pg';

const connectionString =
  process.env['TEST_POSTGRES_URL'] ?? process.env['POSTGRES_URL'] ?? '';

const dbAvailable = connectionString.length > 0;

describe.skipIf(!dbAvailable)('seedTransferBank — idempotency (DB-gated)', () => {
  let db: Db;
  let pool: pg.Pool;

  beforeAll(async () => {
    const client = createDb(connectionString);
    db = client.db;
    pool = client.pool;

    // Clean the table before the test so we can seed from scratch.
    await db.execute(sql`DELETE FROM transfer_bank`);
  });

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

  it('has 8 rows per lesson', async () => {
    for (const lessonId of [1, 2, 3, 4]) {
      const result = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*) AS count FROM transfer_bank WHERE lesson_id = ${lessonId}`,
      );
      expect(Number(result.rows[0]?.count), `lesson ${lessonId}`).toBe(8);
    }
  });
});

describe.skipIf(dbAvailable)('seedTransferBank — skipped (no DB available)', () => {
  it('no DB — test is DB-gated; run with TEST_POSTGRES_URL set', () => {
    // This is a documentation placeholder: the idempotency test requires Postgres.
    // DB-free tests are in transferBankSchema.test.ts.
    expect(true).toBe(true);
  });
});
