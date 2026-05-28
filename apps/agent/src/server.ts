import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { desc, eq } from 'drizzle-orm';
import { equivalent, parse, variables } from '@polymath/booleans';
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
import { evaluateRuleGate } from './mastery/gate.js';
import {
  deriveState,
  toLearnerState,
  type DerivedState,
  type LoggedEvent,
} from './mastery/eventConsumer.js';
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

/** Cap per-session event scans. `sessionId` is client-controlled and a client
 *  can append a row per frame, so an unbounded `select … where sessionId` re-read
 *  + re-fold every turn would be O(n²) over a long-running/abusive session. A few
 *  hundred recent events far exceeds a real L1 session (~10–30 turns) while
 *  bounding the per-turn cost. */
const MAX_SESSION_EVENTS = 500;

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

/** Project a logged event payload into the consumer's `LoggedEvent` shape. The
 *  learner's `submission` is carried so the consumer can recompute correctness
 *  server-side (the BKT/streak must not trust the client's `correct` flag). */
function toLoggedEvent(kind: string, payload: unknown): LoggedEvent {
  const p = (payload ?? {}) as {
    event?: { itemId?: string; submission?: string; correct?: boolean; responseTimeMs?: number };
    transferVerdict?: { correct?: boolean };
  };
  return {
    kind,
    itemId: p.event?.itemId ?? p.event?.submission,
    submission: p.event?.submission,
    responseTimeMs: p.event?.responseTimeMs,
    transferCorrect: p.transferVerdict?.correct,
  };
}

/**
 * F-09 single-writer of `learner_state`. Folds the session's prior events PLUS the
 * just-arrived `current` event into the derived per-KC BKT + behavioral aggregates
 * (ADR-011), persists them to `learner_state`, and returns the snapshot the agent
 * reasons over — with `ruleGatePassed` computed from the real rule-gate predicate
 * (not the F-05 placeholder flag). Runs before the agent proposes so a transfer
 * probe fires exactly when the gate passes.
 */
async function updateAndReadLearnerState(
  db: Db,
  sessionId: string,
  current: ClientEvent,
  lesson: Lesson,
  transferVerdict: { itemId: string; correct: boolean } | undefined,
): Promise<LearnerSnapshot> {
  // Most-recent N events (bounded), then chronological for the fold.
  const priorRows = (
    await db
      .select({ kind: events.kind, payload: events.payload })
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(desc(events.ts))
      .limit(MAX_SESSION_EVENTS)
  ).reverse();

  const logged: LoggedEvent[] = priorRows.map((r) => toLoggedEvent(r.kind, r.payload));
  // Fold in the current event (not yet persisted), threading the server-computed
  // transfer verdict so a passing transfer counts toward the gate this turn.
  logged.push(toLoggedEvent(current.kind, { event: current, transferVerdict }));

  const derived = deriveState(logged, lesson.content, lesson.masteryConfig);
  const learnerState_ = toLearnerState(derived);
  const gate = evaluateRuleGate(learnerState_, lesson.masteryConfig);

  // Persist one learner_state row per KC (the single writer). Best-effort: a write
  // failure must not block the turn (the agent still proposes from the in-memory
  // derived state), so we don't await-throw into the handler.
  await persistLearnerState(db, sessionId, derived, gate.passed).catch((err) =>
    console.error('learner_state persist failed (non-fatal)', err),
  );

  return {
    bktByKc: learnerState_.bktByKc,
    hintsUsed: derived.hintsUsed,
    consecutiveCorrect: derived.consecutiveCorrect,
    ruleGatePassed: gate.passed,
  };
}

/** Write the derived state to `learner_state`, one row per KC (upsert). */
async function persistLearnerState(
  db: Db,
  sessionId: string,
  derived: DerivedState,
  ruleGatePassed: boolean,
): Promise<void> {
  const signals = {
    hintsUsed: derived.hintsUsed,
    consecutiveCorrect: derived.consecutiveCorrect,
    retries: derived.retries,
    submits: derived.submits,
    transferPassed: derived.transferPassed,
    ruleGatePassed,
  };
  for (const [kc, params] of Object.entries(derived.bktByKc)) {
    await db
      .insert(learnerState)
      .values({ sessionId, kc, bktProbability: params.pMastered, masteryState: ruleGatePassed ? 'rule_gate_passed' : 'practicing', signals })
      .onConflictDoUpdate({
        target: [learnerState.sessionId, learnerState.kc],
        set: { bktProbability: params.pMastered, masteryState: ruleGatePassed ? 'rule_gate_passed' : 'practicing', signals },
      });
  }
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
    db
      .select({ payload: events.payload })
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(desc(events.ts))
      .limit(MAX_SESSION_EVENTS),
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

/** Distinct-variable cap before the 2^n truth-table enumeration in `equivalent`.
 *  The L1 `parse` grammar permits 26 single-letter vars; a 2000-char learner
 *  submission could otherwise force a 2^26-row enumeration on the event loop. */
const MAX_TRANSFER_VARS = 10;

/** Validate a `transfer_submitted` event against the probed bank item's canonical
 *  expression via `@polymath/booleans.equivalent` (ADR-010: the validator is the
 *  source of truth; the server decides the transfer verdict, not the agent).
 *
 *  Integrity: the submission is only honored against the item the agent *actually
 *  probed* for this session — a `transfer_submitted` naming a different bank item
 *  (a forged/substituted id) is scored `correct: false`, so a client can't pick an
 *  easier held-out item or burn a different item from the unseen set. */
async function computeTransferVerdict(
  db: Db,
  event: ClientEvent,
): Promise<{ itemId: string; correct: boolean } | undefined> {
  if (event.kind !== 'transfer_submitted') return undefined;

  // The probe must have been mounted for this session, and the submitted itemId
  // must match it (probe-substitution defense).
  const probedItemId = await mostRecentProbeItemId(db, event.sessionId);
  if (probedItemId === null || probedItemId !== event.itemId) {
    return { itemId: event.itemId, correct: false };
  }

  const rows = await db
    .select({ expr: transferBank.targetExpression })
    .from(transferBank)
    .where(eq(transferBank.itemId, event.itemId))
    .limit(1);
  const canonical = rows[0]?.expr;
  if (!canonical) return { itemId: event.itemId, correct: false };

  let correct = false;
  try {
    // Cap distinct vars before enumerating (DoS guard): an over-wide submission is
    // simply wrong, never an event-loop-blocking 2^n enumeration.
    if (variables(parse(event.submission)).length <= MAX_TRANSFER_VARS) {
      correct = equivalent(event.submission, canonical);
    }
  } catch {
    correct = false; // an unparseable submission is simply wrong, never a crash
  }
  return { itemId: event.itemId, correct };
}

/** The itemId of the most-recently-mounted `TransferProbe` for the session, or
 *  null if none has been mounted. */
async function mostRecentProbeItemId(db: Db, sessionId: string): Promise<string | null> {
  // Newest-first, bounded: the most-recent probe is near the top, so a recent
  // window suffices (and bounds the scan on a long/abusive session).
  const rows = await db
    .select({ payload: events.payload })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(desc(events.ts))
    .limit(MAX_SESSION_EVENTS);
  for (const row of rows) {
    const c = (row.payload as { action?: { component?: { kind?: string; itemId?: string } } })?.action
      ?.component;
    if (c?.kind === 'TransferProbe' && typeof c.itemId === 'string') return c.itemId;
  }
  return null;
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
  // The transfer verdict (server-computed) must be known before deriving learner
  // state, so a passed transfer sets the gate's transfer condition this turn.
  const transferVerdict = await computeTransferVerdict(deps.db, event);
  const [learner, recentHistory, transferCandidates] = await Promise.all([
    updateAndReadLearnerState(deps.db, event.sessionId, event, lesson, transferVerdict),
    readRecentHistory(deps.db, event.sessionId),
    readTransferCandidates(deps.db, event.sessionId, lesson.content.lessonId),
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

  // ADR-010 Layer 3: a HintCard level-3 mount is logged as unverified_prose.
  // All other mounts go through the Layer-2 validator (layer 2); non-mounts
  // are layer 1. This is set on the pre-rejection `shaped` action so the log
  // reflects the original proposal even when it was downgraded.
  const isL3Hint =
    shaped.type === 'mount' &&
    shaped.component.kind === 'HintCard' &&
    shaped.component.level === 3;
  const validationLayer = isL3Hint ? 3 : shaped.type === 'mount' ? 2 : 1;
  const validationStatus = isL3Hint
    ? 'unverified_prose'
    : layer2.ok
      ? 'pass'
      : 'reject';

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
        layer: validationLayer,
        status: validationStatus,
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
