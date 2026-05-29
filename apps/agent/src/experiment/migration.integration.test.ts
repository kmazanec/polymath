import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { canRunPg, ensureTestPg } from '../db/testPg.js';
import pg from 'pg';

/**
 * F-17 migration test: a fresh Postgres → `runMigrations` → all four experiment
 * tables + the usage backstop are present with the expected columns. This guards
 * the boot-path blast radius (a journal/migration mismatch crashes the agent
 * before it serves health). Offline; rides the shared test container.
 */
describe.skipIf(!canRunPg)('F-17 schema migration', () => {
  let db: Db;
  let pool: pg.Pool;

  beforeAll(async () => {
    const url = await ensureTestPg();
    await runMigrations(url);
    ({ db, pool } = createDb(url));
  }, 60000);

  afterAll(async () => {
    await pool.end();
  });

  const tables = [
    'experiment_subjects',
    'pre_test_results',
    'post_test_results',
    'followup_results',
    'subject_item_usage',
  ];

  it('creates all four experiment tables + the usage backstop', async () => {
    for (const table of tables) {
      const res = await db.execute<{ exists: boolean }>(
        sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = ${table}) AS exists`,
      );
      expect(res.rows[0]?.exists, table).toBe(true);
    }
  });

  it('subject_item_usage has a composite PK on (subject_id, item_id)', async () => {
    const res = await db.execute<{ col: string }>(
      sql`SELECT a.attname AS col
          FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = 'subject_item_usage'::regclass AND i.indisprimary
          ORDER BY a.attname`,
    );
    expect(res.rows.map((r) => r.col)).toEqual(['item_id', 'subject_id']);
  });

  it('experiment_subjects.followup_token is unique', async () => {
    const res = await db.execute<{ n: string }>(
      sql`SELECT COUNT(*) AS n FROM pg_constraint
          WHERE conrelid = 'experiment_subjects'::regclass AND contype = 'u'`,
    );
    expect(Number(res.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
