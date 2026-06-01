import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { makeAgentClient, selectedAgentProviderName } from './agent/makeAgentClient.js';
import { createServer } from './server.js';
import { startSessionDeletionSweep } from './privacy/sessionDeletion.js';
import { registerOtel } from './voice/otelSdk.js';

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
  // Register the OTLP trace exporter BEFORE anything emits a span, so the API-only
  // `recordVoiceTurnSpan` calls (voice/otel.ts) actually leave the process. Env-gated
  // and fail-closed: with no `OTEL_EXPORTER_OTLP_ENDPOINT` this is a clean no-op (the
  // API stays a no-op), and a bad endpoint can never throw into boot — telemetry is
  // best-effort, never on the critical path.
  registerOtel();

  await runMigrations(POSTGRES_URL);

  const { db, pool } = createDb(POSTGRES_URL);
  // `createServer` defaults the F-11 explain-back voice-capture registry and sources
  // the server-side transcript/prosody integrity seams from it (the route NEVER trusts
  // the client-supplied event.transcript — CLAUDE.md "server never trusts the client").
  // The registry is reachable as `server.explainBackCaptureRegistry`: the (deferred)
  // live LiveKit bridge `register()`s a phase-scoped RealtimeSession per explain-back
  // utterance so a real spoken explain-back produces a server-side transcript. Until
  // that live device capture lands (deferred cross-platform smoke — needs real
  // keys/devices, see docs/voice-cross-platform-smoke.md), nothing populates the
  // registry, so every real explain-back runs on an empty transcript and FAILS CLOSED
  // at precondition #3 — never a silent client-trusting pass. The keyed judge
  // (makeExplainBackJudge) self-gates on OPENAI_API_KEY.
  //
  // F-28: `makeAgentClient()` replaces the hardcoded `new StubAgentClient()`.
  // When OPENAI_API_KEY is present the real FlowAgentClient(OpenAIMoveProvider) is
  // selected; otherwise the heuristic StubAgentClient is used unchanged. The boot log
  // line from makeAgentClient confirms which provider was selected.
  const agent = makeAgentClient();
  const server = createServer({ db, agent, allowedOrigins, agentProviderName: selectedAgentProviderName() });

  // Privacy posture (ADR-012, AC#9): periodically hard-delete the events +
  // learner_state of sessions whose deletion grace has expired (sessions are scheduled
  // server-side on WS close). The sweep is non-fatal — a failure logs and retries next
  // interval — and runs an immediate pass on boot to clean up anything that expired
  // while the agent was down.
  const stopSweep = startSessionDeletionSweep(db);

  server.httpServer.listen(PORT, () => {
    console.log(`polymath agent listening on :${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopSweep();
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
