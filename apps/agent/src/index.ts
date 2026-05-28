import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { StubAgentClient } from './agent/stubClient.js';
import { createServer } from './server.js';

const PORT = Number(process.env.PORT ?? 8080);
const POSTGRES_URL =
  process.env.POSTGRES_URL ?? 'postgres://polymath:polymath@localhost:5432/polymath';

async function main(): Promise<void> {
  await runMigrations(POSTGRES_URL);

  const { db, pool } = createDb(POSTGRES_URL);
  const server = createServer({ db, agent: new StubAgentClient() });

  server.listen(PORT, () => {
    console.log(`polymath agent listening on :${PORT}`);
  });

  const shutdown = (): void => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('agent failed to start', err);
  process.exit(1);
});
