import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { desc, eq } from 'drizzle-orm';
import { equivalent } from '@polymath/booleans';
import {
  ClientEvent,
  noAction,
  type Action,
  type ServerMessage,
} from '@polymath/contract';
import type { Db } from './db/client.js';
import { events, learnerState, sessions, transferBank } from './db/schema.js';
import type {
  AgentClient,
  AgentInput,
  LearnerSnapshot,
  TransferProbeItem,
  TurnSummary,
} from './agent/client.js';
import { validateLayer2 } from './agent/layer2.js';
import { validateOutboundAction } from './agent/validateAction.js';
import { loadLesson, type Lesson } from './lessons/loader.js';

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

/** The agent turn must not block the WS handler indefinitely (F-01 build note:
 *  the LLM call has no deadline of its own). On timeout the server emits a safe
 *  `no_action` rather than hanging the connection. */
const AGENT_TURN_TIMEOUT_MS = 15_000;

/** Lessons are immutable per process; load once and cache. */
const lessonCache = new Map<number, Lesson>();
function getLesson(lessonId: number): Lesson {
  let lesson = lessonCache.get(lessonId);
  if (!lesson) {
    lesson = loadLesson(lessonId);
    lessonCache.set(lessonId, lesson);
  }
  return lesson;
}

/** The lesson a session is working on. F-05 is L1-only; later features read
 *  `sessions.lessonProgress`. Kept a single function so that grows in one place. */
function lessonIdForEvent(event: ClientEvent): number {
  return event.kind === 'session_start' ? event.lessonId : 1;
}

/** Read the learner snapshot the agent reasons over. F-09 populates
 *  `learner_state`; until then this reads whatever rows exist and reports an
 *  empty/zeroed snapshot with the rule gate closed. */
async function readLearnerSnapshot(db: Db, sessionId: string): Promise<LearnerSnapshot> {
  const rows = await db
    .select({ kc: learnerState.kc, bkt: learnerState.bktProbability, signals: learnerState.signals })
    .from(learnerState)
    .where(eq(learnerState.sessionId, sessionId));
  const bktByKc: Record<string, number> = {};
  let hintsUsed = 0;
  let consecutiveCorrect = 0;
  let ruleGatePassed = false;
  for (const row of rows) {
    if (row.bkt !== null) bktByKc[row.kc] = row.bkt;
    const s = (row.signals ?? {}) as {
      hintsUsed?: number;
      consecutiveCorrect?: number;
      ruleGatePassed?: boolean;
    };
    hintsUsed += s.hintsUsed ?? 0;
    consecutiveCorrect = Math.max(consecutiveCorrect, s.consecutiveCorrect ?? 0);
    ruleGatePassed ||= s.ruleGatePassed ?? false;
  }
  return { bktByKc, hintsUsed, consecutiveCorrect, ruleGatePassed };
}

/** Recent turns (newest last) for short agent context. */
async function readRecentHistory(db: Db, sessionId: string, limit = 5): Promise<TurnSummary[]> {
  const rows = await db
    .select({ kind: events.kind, payload: events.payload })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(desc(events.ts))
    .limit(limit);
  return rows
    .reverse()
    .map((r) => {
      const p = (r.payload ?? {}) as {
        action?: { type?: string; rationale?: string };
        event?: { itemId?: string; submission?: string; correct?: boolean };
      };
      return {
        eventKind: r.kind,
        actionType: p.action?.type ?? 'unknown',
        rationale: p.action?.rationale ?? '',
        correct: p.event?.correct,
        itemId: p.event?.itemId ?? p.event?.submission,
      };
    });
}

/** Held-out transfer items for the lesson the learner has NOT yet seen this
 *  session (ADR-010 Layer 5: never repeat a probed item). "Seen" = any item id
 *  that appeared in a prior `transfer_submitted` event or a mounted `TransferProbe`
 *  for this session. Read-only — the bank is never written at runtime. */
async function readTransferCandidates(
  db: Db,
  sessionId: string,
  lessonId: number,
): Promise<TransferProbeItem[]> {
  const [bank, prior] = await Promise.all([
    db.select().from(transferBank).where(eq(transferBank.lessonId, lessonId)),
    db.select({ payload: events.payload }).from(events).where(eq(events.sessionId, sessionId)),
  ]);
  const seen = new Set<string>();
  for (const row of prior) {
    const p = (row.payload ?? {}) as {
      event?: { kind?: string; itemId?: string };
      action?: { type?: string; component?: { kind?: string; itemId?: string } };
    };
    if (p.event?.kind === 'transfer_submitted' && p.event.itemId) seen.add(p.event.itemId);
    if (p.action?.component?.kind === 'TransferProbe' && p.action.component.itemId) {
      seen.add(p.action.component.itemId);
    }
  }
  return bank
    .filter((b) => !seen.has(b.itemId))
    .map((b) => ({
      itemId: b.itemId,
      targetExpression: b.targetExpression,
      targetRep: b.targetRep as TransferProbeItem['targetRep'],
      hiddenReps: b.hiddenReps as TransferProbeItem['hiddenReps'],
    }));
}

/** Validate a `transfer_submitted` event against the probed bank item's canonical
 *  expression via `@polymath/booleans.equivalent` (ADR-010: the validator is the
 *  source of truth; the server decides the transfer verdict, not the agent). */
async function computeTransferVerdict(
  db: Db,
  event: ClientEvent,
): Promise<{ itemId: string; correct: boolean } | undefined> {
  if (event.kind !== 'transfer_submitted') return undefined;
  const rows = await db
    .select({ expr: transferBank.targetExpression })
    .from(transferBank)
    .where(eq(transferBank.itemId, event.itemId))
    .limit(1);
  const canonical = rows[0]?.expr;
  if (!canonical) return { itemId: event.itemId, correct: false };
  let correct = false;
  try {
    correct = equivalent(event.submission, canonical);
  } catch {
    correct = false; // an unparseable submission is simply wrong, never a crash
  }
  return { itemId: event.itemId, correct };
}

/** Run the agent turn under a timeout; a timeout degrades to `no_action`. */
async function proposeWithTimeout(agent: AgentClient, input: AgentInput): Promise<Action> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Action>((resolve) => {
    timer = setTimeout(
      () => resolve(noAction('thinking', `agent turn exceeded ${AGENT_TURN_TIMEOUT_MS}ms; deferring`)),
      AGENT_TURN_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([agent.propose(input), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

  // Assemble the turn input the agent reasons over: lesson content, the learner
  // snapshot, and recent history (ADR-003: fresh-per-turn, structured state only).
  const lesson = getLesson(lessonIdForEvent(event));
  const [learner, recentHistory, transferCandidates, transferVerdict] = await Promise.all([
    readLearnerSnapshot(deps.db, event.sessionId),
    readRecentHistory(deps.db, event.sessionId),
    readTransferCandidates(deps.db, event.sessionId, lesson.content.lessonId),
    computeTransferVerdict(deps.db, event),
  ]);
  const input: AgentInput = {
    event,
    lesson,
    learnerState: learner,
    recentHistory,
    transferCandidates,
    transferVerdict,
  };

  // Propose an action (under a timeout), then validate it server-side before it
  // crosses the wire (ADR-005 / criterion 5). The agent's own flow already ran
  // Layer 2, but the wire boundary re-validates and *enforces*: a Zod-malformed
  // proposal OR an item whose claimedTruthTable fails the recompute is downgraded
  // to `no_action` rather than forwarded. The server never trusts the agent, even
  // its own — defense in depth (CLAUDE.md invariant).
  const proposed = await proposeWithTimeout(deps.agent, input);
  const { action: shaped, downgraded } = validateOutboundAction(proposed);
  const layer2 = validateLayer2(shaped);
  const action: Action = layer2.ok
    ? shaped
    : noAction('agent_unsure', `outbound Layer-2 rejection: ${layer2.detail}`);

  await deps.db.insert(events).values({
    sessionId: event.sessionId,
    kind: event.kind,
    payload: {
      event,
      action,
      learnerSnapshot: learner,
      // The transfer verdict (when this turn is a transfer_submitted) is recorded
      // so the replay shows pass/fail and F-09 can read the transfer-pass condition.
      ...(transferVerdict ? { transferVerdict } : {}),
      validation: {
        layer: shaped.type === 'mount' ? 2 : 1,
        status: layer2.ok ? 'pass' : 'reject',
        detail: layer2.ok ? (downgraded ? 'downgraded malformed proposal' : 'ok') : layer2.detail,
      },
    },
  });

  send(ws, { kind: 'action', sessionId: event.sessionId, action });
}

export interface PolymathServer {
  httpServer: http.Server;
  wss: WebSocketServer;
  /** Drain WS connections, close the HTTP server, then resolve. Without
   *  terminating the WS clients first, `httpServer.close()` waits forever for
   *  open sockets and a SIGTERM hangs (the container never exits). */
  close(): Promise<void>;
}

/** Build the HTTP + WebSocket server. Dependencies are injected so tests can
 *  supply an in-memory/throwaway DB and a stub agent. */
export function createServer(deps: ServerDeps): PolymathServer {
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

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      for (const client of wss.clients) client.terminate();
      wss.close(() => httpServer.close(() => resolve()));
    });

  return { httpServer, wss, close };
}

/** Session-id helper used by the REST layer's callers/tests. */
export function newSessionId(): string {
  return randomUUID();
}
