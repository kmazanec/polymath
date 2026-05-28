import { spawnSync } from 'node:child_process';
import net from 'node:net';

/**
 * Root-level vitest globalSetup. Provisions the shared test Postgres ONCE before
 * any project's suites run, so DB-backed suites (agent integration + seed) never
 * race on a cold-start container under the whole-workspace orchestration. No-op
 * when an external DB is provided (CI) or Docker is unavailable (suites skip).
 *
 * Mirrors apps/agent/src/db/testPg.ts's container (same name/port) so both paths
 * converge on one container.
 */

const CONTAINER = 'polymath-test-pg';
const PG_PORT = 55432;

function dockerAvailable(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(500, () => done(false));
  });
}

export default async function setup(): Promise<void> {
  if (process.env.TEST_POSTGRES_URL || process.env.POSTGRES_URL) return; // external DB
  if (!dockerAvailable()) return; // suites skip cleanly

  const running = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], {
    encoding: 'utf8',
  });
  if (running.stdout.trim() !== 'true') {
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

  // Wait until the port accepts connections before any suite runs (cold start can
  // take a while: image pull + initdb). Patient by design.
  for (let i = 0; i < 120; i++) {
    if (await portOpen(PG_PORT)) return;
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error('test Postgres did not become reachable');
}
