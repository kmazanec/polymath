import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';
import { seedTransferBank } from './seed.js';

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

/** Apply all pending migrations then idempotently seed static data. Run on
 *  container startup and from CI.
 *
 *  Migrations are fatal (a broken schema must halt boot). The transfer-bank seed
 *  is **non-fatal**: a missing/bad seed file degrades to a stale-or-empty
 *  read-only bank (F-07/F-16 see fewer probes) rather than crashing the agent
 *  before it can serve health — a degraded read path beats a total outage. */
export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString);
  try {
    await migrate(db, { migrationsFolder });
    try {
      await seedTransferBank(db);
    } catch (err) {
      console.error('transfer_bank seed failed — continuing with the existing bank', err);
    }
  } finally {
    await pool.end();
  }
}

// Allow `tsx src/db/migrate.ts` as a standalone entrypoint.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.error('POSTGRES_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log('migrations applied');
      process.exit(0);
    })
    .catch((err) => {
      console.error('migration failed', err);
      process.exit(1);
    });
}
