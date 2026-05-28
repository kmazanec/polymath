import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { StubAgentClient } from './agent/stubClient.js';
import { createServer } from './server.js';

const PORT = Number(process.env.PORT ?? 8080);
const POSTGRES_URL =
  process.env.POSTGRES_URL ?? 'postgres://polymath:polymath@localhost:5432/polymath';

/** Browser origins allowed to open the agent WebSocket (CSWSH defense). The
 *  serving origin must be listed or the upgrade is rejected with 401. Configured
 *  via `ALLOWED_WS_ORIGINS` (comma-separated) so a deployment behind any host/port
 *  (the droplet's polymath.biograph.dev, a local non-8080 port) can authorize its
 *  own origin without a code change; defaults cover local dev. */
const allowedOrigins = (process.env.ALLOWED_WS_ORIGINS ?? 'http://localhost:5173,http://localhost:8080')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

async function main(): Promise<void> {
  await runMigrations(POSTGRES_URL);

  const { db, pool } = createDb(POSTGRES_URL);
  const server = createServer({ db, agent: new StubAgentClient(), allowedOrigins });

  server.httpServer.listen(PORT, () => {
    console.log(`polymath agent listening on :${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Drain WS + close HTTP first (server.close terminates open sockets so this
    // resolves instead of hanging), then close the pool, then exit.
    server
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('agent failed to start', err);
  process.exit(1);
});
