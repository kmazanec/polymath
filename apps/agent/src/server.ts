import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import {
  ClientEvent,
  type ServerMessage,
} from '@polymath/contract';
import type { Db } from './db/client.js';
import { events, sessions } from './db/schema.js';
import type { AgentClient } from './agent/client.js';
import { validateOutboundAction } from './agent/validateAction.js';

export interface ServerDeps {
  db: Db;
  agent: AgentClient;
  /** Browser origins allowed to open the WebSocket (CSWSH defense). A request
   *  with no `Origin` header (non-browser clients: the smoke test, the
   *  integration harness, `wscat`) is always allowed. Defaults to localhost. */
  allowedOrigins?: string[];
}

/** Cap inbound WS frames — protocol messages are small JSON. Prevents a single
 *  oversized frame from exhausting memory (ws default is 100 MB). */
const MAX_WS_PAYLOAD_BYTES = 64 * 1024;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

/** Handle one inbound WebSocket frame: validate → run agent → validate output →
 *  persist → reply. Exported for direct unit/integration testing. */
export async function handleClientFrame(
  deps: ServerDeps,
  ws: WebSocket,
  raw: string,
): Promise<void> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    send(ws, { kind: 'error', message: 'invalid JSON' });
    return;
  }

  const parsed = ClientEvent.safeParse(json);
  if (!parsed.success) {
    send(ws, { kind: 'error', message: 'unrecognised event' });
    return;
  }
  const event = parsed.data;

  // The sessionId is a valid UUID (contract-enforced) but may not name a real
  // session (sessions are minted via POST /api/session). Reject unknown sessions
  // with a clean error rather than letting the events FK constraint throw.
  const known = await deps.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, event.sessionId))
    .limit(1);
  if (known.length === 0) {
    send(ws, { kind: 'error', sessionId: event.sessionId, message: 'unknown session' });
    return;
  }

  // Propose an action, then validate it server-side before it crosses the wire
  // (ADR-005 / acceptance criterion 5). A malformed proposal is downgraded.
  const proposed = await deps.agent.propose(event);
  const { action } = validateOutboundAction(proposed);

  await deps.db.insert(events).values({
    sessionId: event.sessionId,
    kind: event.kind,
    payload: { event, action },
  });

  send(ws, { kind: 'action', sessionId: event.sessionId, action });
}

/** Build the HTTP + WebSocket server. Dependencies are injected so tests can
 *  supply an in-memory/throwaway DB and a stub agent. */
export function createServer(deps: ServerDeps): http.Server {
  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/session') {
      deps.db
        .insert(sessions)
        .values({})
        .returning({ id: sessions.id, startedAt: sessions.startedAt })
        .then((rows) => {
          const row = rows[0]!;
          sendJson(res, 201, { sessionId: row.id, startedAt: row.startedAt });
        })
        .catch(() => sendJson(res, 500, { error: 'failed to create session' }));
      return;
    }

    const replayMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/replay$/);
    if (req.method === 'GET' && replayMatch) {
      const sessionId = replayMatch[1]!;
      deps.db
        .select()
        .from(events)
        .where(eq(events.sessionId, sessionId))
        .then((rows) => sendJson(res, 200, { sessionId, events: rows }))
        .catch(() => sendJson(res, 500, { error: 'failed to load replay' }));
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });

  const allowed = new Set(
    deps.allowedOrigins ?? ['http://localhost:5173', 'http://localhost:8080'],
  );
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/agent',
    maxPayload: MAX_WS_PAYLOAD_BYTES,
    verifyClient: (info: { origin?: string }) => {
      // Non-browser clients send no Origin header — allow them. Browser clients
      // must come from an allowed origin (CSWSH defense).
      return info.origin === undefined || allowed.has(info.origin);
    },
  });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      // The frame handler must never reject unhandled — an unawaited rejection
      // (e.g. a DB error on a bad sessionId) would crash the process.
      handleClientFrame(deps, ws, data.toString()).catch((err) => {
        console.error('error handling client frame', err);
        try {
          send(ws, { kind: 'error', message: 'internal error' });
        } catch {
          /* socket already closed */
        }
      });
    });
  });

  return httpServer;
}

/** Session-id helper used by the REST layer's callers/tests. */
export function newSessionId(): string {
  return randomUUID();
}
