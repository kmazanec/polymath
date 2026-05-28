import { spawnSync } from 'node:child_process';
import { createDb } from './client.js';

/**
 * Shared test Postgres provisioning. A DB-backed test should NOT skip just because
 * no `TEST_POSTGRES_URL` is set — if Docker is available it spins up a throwaway
 * `postgres:16-alpine` and uses that. Tests only skip when there is genuinely no
 * way to get a DB (no external URL AND no Docker), which is a capability gap, not
 * a default. CI provides `TEST_POSTGRES_URL` (a sibling container); local runs use
 * the Docker fallback. All suites share one container (same name/port) so parallel
 * suites reuse it rather than fighting over the port.
 */

const CONTAINER = 'polymath-test-pg';
const PG_PORT = 55432;

const EXTERNAL_PG_URL = process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL;

function dockerAvailable(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

const HAVE_DOCKER = dockerAvailable();

/** Whether any DB-backed test can run in this environment. */
export const canRunPg: boolean = Boolean(EXTERNAL_PG_URL) || HAVE_DOCKER;

/** True only when we manage our own throwaway container (no external URL). */
const manageOwnPg = !EXTERNAL_PG_URL && HAVE_DOCKER;

/** The connection string the tests use. */
export const testPostgresUrl: string =
  EXTERNAL_PG_URL ?? `postgres://polymath:polymath@localhost:${PG_PORT}/polymath`;

// A cold `docker run` of postgres:16-alpine (image pull on a clean host + initdb)
// can take well past 15s; poll patiently so a first-run cold start under the
// whole-workspace test orchestration doesn't intermittently time out.
async function waitForPg(url: string, attempts = 120): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const { db, pool } = createDb(url);
    try {
      await db.execute('select 1');
      await pool.end();
      return;
    } catch {
      await pool.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('Postgres did not become ready');
}

/** Ensure a reachable Postgres exists, starting the shared container if needed.
 *  Idempotent: a second caller reuses the already-running container. */
export async function ensureTestPg(): Promise<string> {
  if (manageOwnPg) {
    const running = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], {
      encoding: 'utf8',
    });
    if (running.stdout.trim() !== 'true') {
      // `docker run` create+claims the name. Parallel suites in one vitest run may
      // both reach here; the loser's run errors "name already in use" — treat that
      // as "the other caller created it" and fall through to waitForPg. We do NOT
      // `rm -f` first: that would kill a container another suite is mid-use of.
      const r = spawnSync('docker', [
        'run', '-d', '--name', CONTAINER,
        '-e', 'POSTGRES_USER=polymath',
        '-e', 'POSTGRES_PASSWORD=polymath',
        '-e', 'POSTGRES_DB=polymath',
        '-p', `${PG_PORT}:5432`,
        'postgres:16-alpine',
      ], { encoding: 'utf8' });
      if (r.status !== 0 && !/already in use/i.test(r.stderr ?? '')) {
        throw new Error(`failed to start test Postgres: ${r.stderr}`);
      }
    }
  }
  await waitForPg(testPostgresUrl);
  return testPostgresUrl;
}
