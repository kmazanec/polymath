import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/** Create a Drizzle client + its underlying pg Pool. Caller owns the pool's
 *  lifecycle (the server closes it on shutdown; tests close it after each run). */
export function createDb(connectionString: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
