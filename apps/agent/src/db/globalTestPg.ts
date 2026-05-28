import { ensureTestPg, canRunPg } from './testPg.js';

/**
 * Vitest globalSetup for the agent project: provision the shared test Postgres
 * ONCE before any suite runs, so concurrent DB suites never race on a cold-start
 * container (each `ensureTestPg` then finds it already up and just waits for
 * readiness). No-op when no DB is available (the suites skip).
 */
export default async function globalSetup(): Promise<void> {
  if (!canRunPg) return;
  await ensureTestPg();
}
