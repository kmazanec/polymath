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
import { evaluateRuleGate, isMastered, type LearnerState } from './mastery/gate.js';
import type { MasteryConfig } from '@polymath/contract';
import {
  deriveState,
  recomputeCorrect,
  toLearnerState,
  type DerivedState,
  type LoggedEvent,
} from './mastery/eventConsumer.js';
import { validateOutboundAction } from './agent/validateAction.js';
import { loadLesson, type Lesson } from './lessons/loader.js';
import { mintRealtimeToken } from './voice/token.js';
import { createRateLimiter } from './voice/rateLimiter.js';

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
    action?: { type?: string; component?: { kind?: string } };
  };
  return {
    kind,
    itemId: p.event?.itemId ?? p.event?.submission,
    submission: p.event?.submission,
    responseTimeMs: p.event?.responseTimeMs,
    transferCorrect: p.transferVerdict?.correct,
    // A served hint = the logged action mounted a HintCard (a refused request is a
    // no_action). Only known for persisted events; the current turn's action isn't
    // decided yet (and doesn't count toward its own level).
    hintMounted: p.action?.type === 'mount' && p.action.component?.kind === 'HintCard',
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
): Promise<{
  snapshot: LearnerSnapshot;
  masteryState: LearnerState;
  hintsByItem: Record<string, number>;
  priorMissesByItem: Record<string, number>;
  currentSubmitCorrect: boolean | undefined;
}> {
  // Most-recent N events (bounded), then chronological for the fold.
  const priorRows = (
    await db
      .select({ kind: events.kind, payload: events.payload })
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(desc(events.ts))
      .limit(MAX_SESSION_EVENTS)
  ).reverse();

  const priorLogged: LoggedEvent[] = priorRows.map((r) => toLoggedEvent(r.kind, r.payload));
  // Prior-only fold gives the miss baseline BEFORE this turn (so the heuristic's
  // repeated-miss escalation sees prior misses, not the current one).
  const priorDerived = deriveState(priorLogged, lesson.content, lesson.masteryConfig);

  // Then fold in the current event (not yet persisted), threading the server-computed
  // transfer verdict so a passing transfer counts toward the gate this turn.
  const logged = [...priorLogged, toLoggedEvent(current.kind, { event: current, transferVerdict })];
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
    snapshot: {
      bktByKc: learnerState_.bktByKc,
      hintsUsed: derived.hintsUsed,
      consecutiveCorrect: derived.consecutiveCorrect,
      ruleGatePassed: gate.passed,
    },
    masteryState: learnerState_,
    hintsByItem: derived.hintsByItem,
    priorMissesByItem: priorDerived.missesByItem,
    currentSubmitCorrect:
      current.kind === 'submit' ? recomputeCorrect(lesson.content, current.itemId, current.submission) : undefined,
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
 *  Integrity: the submission is only honored against the item with a *currently
 *  unresolved* probe for this session. A `transfer_submitted` naming a different
 *  bank item (forged/substituted id) OR a resubmission against an already-resolved
 *  probe (e.g. retrying a failed held-out item until it passes) is scored
 *  `correct: false` — the no-repeat held-out transfer gate. */
async function computeTransferVerdict(
  db: Db,
  event: ClientEvent,
): Promise<{ itemId: string; correct: boolean } | undefined> {
  if (event.kind !== 'transfer_submitted') return undefined;

  // There must be an UNRESOLVED probe for this session whose itemId matches.
  const probedItemId = await unresolvedProbeItemId(db, event.sessionId);
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

/** The itemId of the currently-UNRESOLVED transfer probe, or null. Scanning
 *  newest-first: a `transfer_submitted` seen before any probe means the latest
 *  probe was already resolved → null (so a client can't resubmit a resolved/failed
 *  probe item until it finally passes — the no-repeat held-out gate). */
async function unresolvedProbeItemId(db: Db, sessionId: string): Promise<string | null> {
  const rows = await db
    .select({ kind: events.kind, payload: events.payload })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(desc(events.ts))
    .limit(MAX_SESSION_EVENTS);
  for (const row of rows) {
    if (row.kind === 'transfer_submitted') return null; // latest probe already resolved
    const c = (row.payload as { action?: { component?: { kind?: string; itemId?: string } } })?.action
      ?.component;
    if (c?.kind === 'TransferProbe' && typeof c.itemId === 'string') return c.itemId;
  }
  return null;
}

/** Whether a transfer probe is currently active for the session: the most recent
 *  relevant turn mounted a `TransferProbe` and no `transfer_submitted` has resolved
 *  it since. Used to extend the hidden-rep refusal to hints (ADR-005 #2). */
async function isInTransferProbe(db: Db, sessionId: string): Promise<boolean> {
  const rows = await db
    .select({ kind: events.kind, payload: events.payload })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(desc(events.ts))
    .limit(MAX_SESSION_EVENTS);
  for (const row of rows) {
    if (row.kind === 'transfer_submitted') return false; // a probe was resolved
    const c = (row.payload as { action?: { component?: { kind?: string } } })?.action?.component;
    if (c?.kind === 'TransferProbe') return true; // mounted and unresolved
  }
  return false;
}

/** Reject an outbound privileged action the learner hasn't earned, regardless of
 *  what the agent proposed (the server never trusts the agent — defense for a
 *  jailbroken/misbehaving LLM provider). Returns a rejection reason (→ downgrade to
 *  `no_action`) or null if authorized:
 *   - a `TransferProbe` mount needs `ruleGatePassed` AND an exact match to an
 *     allowed unseen `transfer_bank` row;
 *   - a `transition` → `mastered` needs the full mastery predicate satisfied
 *     server-side (`isMastered` over the derived state). In I1 explain-back is
 *     unbuilt, so this can never pass — a forged mastery transition is downgraded. */
function rejectUnauthorizedAction(
  action: Action,
  learner: LearnerSnapshot,
  masteryState: LearnerState,
  config: MasteryConfig,
  candidates: TransferProbeItem[] | undefined,
): string | null {
  if (action.type === 'transition' && action.to === 'mastered') {
    return isMastered(masteryState, config) ? null : 'mastery transition before the full gate is satisfied';
  }
  if (action.type !== 'mount' || action.component.kind !== 'TransferProbe') return null;
  if (!learner.ruleGatePassed) return 'transfer probe before the rule gate passed';
  const c = action.component;
  const match = (candidates ?? []).find(
    (b) =>
      b.itemId === c.itemId &&
      b.targetExpression === c.expression &&
      b.targetRep === c.targetRep &&
      JSON.stringify([...b.hiddenReps].sort()) === JSON.stringify([...c.hiddenReps].sort()),
  );
  return match ? null : 'transfer probe does not match an allowed unseen bank item';
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

/** Cap the request body we'll buffer for a REST POST. These endpoints take tiny
 *  JSON (a single id); a 16 KB ceiling makes an oversized/slowloris body a clean
 *  413 rather than unbounded memory growth. */
const MAX_REST_BODY_BYTES = 16 * 1024;

/** A stalled client that opens a request and dribbles (or never finishes) the
 *  body would otherwise hold the connection open indefinitely (slowloris), since
 *  the size cap alone doesn't bound *time*. Abort a body that isn't complete
 *  within this window. */
const REST_BODY_TIMEOUT_MS = 5_000;

/** Collect a request body up to the cap, then parse it as JSON. Rejects with a
 *  small tagged reason so the route can map it to the right 4xx without leaking
 *  internals. Resolves `null` on an empty body (callers treat that as a 400).
 *  Aborts the socket if the body doesn't complete within REST_BODY_TIMEOUT_MS. */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('body timeout'));
      req.destroy();
    }, REST_BODY_TIMEOUT_MS);
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REST_BODY_BYTES) {
        finish(() => reject(new Error('body too large')));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      finish(() => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (raw === '') {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('invalid JSON'));
        }
      });
    });
    req.on('error', (err) => finish(() => reject(err)));
  });
}

/** A UUID matcher local to the REST layer — the WS protocol enforces the same
 *  shape via the contract's `z.string().uuid()`, but the realtime route doesn't
 *  parse a full `ClientEvent`, so it validates the lone `sessionId` itself
 *  rather than taking a contract dependency for one field. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Throttle token minting per session. Each mint signs a JWT + provisions a room
 *  slot, so an unthrottled caller holding a session id could amplify into
 *  unbounded LiveKit/realtime cost. The legitimate client mints once on join and
 *  once per ~4-minute refresh, so 6/min is far above real use yet caps abuse.
 *  Per-process is fine — this is a safety backstop, not a billing quota. */
const realtimeMintLimiter = createRateLimiter({ limit: 6, windowMs: 60_000 });

/** Mint a LiveKit join token for an existing session. The browser calls this to
 *  join the session's room directly, so the long-lived API secret never reaches
 *  the client — only a 5-minute, single-room token does. Read the env credentials
 *  here (matching how PORT etc. are read at the server layer) and keep `token.ts`
 *  pure. */
async function handleRealtimeSession(
  deps: ServerDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  // Credentials are env-only; the repo ships no real keys, so an unconfigured
  // deploy serves a clean 503 rather than minting an unusable token. The URL is
  // required too — a token with no server URL is useless to the browser, so a
  // missing/blank LIVEKIT_URL is "not configured", not a 201 with url:"".
  const livekitUrl = (process.env['LIVEKIT_URL'] ?? '').trim();
  const apiKey = process.env['LIVEKIT_API_KEY'];
  const apiSecret = process.env['LIVEKIT_API_SECRET'];
  if (!apiKey || !apiSecret || livekitUrl === '') {
    sendJson(res, 503, { error: 'voice not configured' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'invalid request body';
    const status = reason === 'body too large' ? 413 : reason === 'body timeout' ? 408 : 400;
    sendJson(res, status, { error: reason });
    return;
  }

  const sessionId = (body as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
    sendJson(res, 400, { error: 'sessionId must be a UUID' });
    return;
  }

  // Cap mints per session before the DB hit — the amplification vector is
  // repeated minting for a held session id, not the lookup itself.
  if (!realtimeMintLimiter.take(sessionId)) {
    sendJson(res, 429, { error: 'too many token requests' });
    return;
  }

  // The room is derived from a real session — minting a token for an unknown
  // session would hand out a join token for a room no agent will ever attend.
  const known = await deps.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (known.length === 0) {
    sendJson(res, 404, { error: 'unknown session' });
    return;
  }

  const minted = await mintRealtimeToken({ sessionId, apiKey, apiSecret, livekitUrl });
  sendJson(res, 201, {
    token: minted.token,
    url: minted.url,
    roomName: minted.roomName,
    expiresAt: minted.expiresAt,
  });
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
  const [learnerDerived, recentHistory, transferCandidates, inTransferProbe] = await Promise.all([
    updateAndReadLearnerState(deps.db, event.sessionId, event, lesson, transferVerdict),
    readRecentHistory(deps.db, event.sessionId),
    readTransferCandidates(deps.db, event.sessionId, lesson.content.lessonId),
    isInTransferProbe(deps.db, event.sessionId),
  ]);
  const input: AgentInput = {
    event,
    lesson,
    learnerState: learnerDerived.snapshot,
    recentHistory,
    transferCandidates,
    transferVerdict,
    inTransferProbe,
    hintsByItem: learnerDerived.hintsByItem,
    priorMissesByItem: learnerDerived.priorMissesByItem,
    currentSubmitCorrect: learnerDerived.currentSubmitCorrect,
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
  // Outbound earned-it gate (server never trusts the agent — matters once an LLM
  // provider is live): a TransferProbe mount is downgraded unless the rule gate
  // passed and it matches an allowed unseen bank row; a transition→mastered is
  // downgraded unless the full mastery predicate holds server-side.
  const earnedItRejection = rejectUnauthorizedAction(
    shaped,
    learnerDerived.snapshot,
    learnerDerived.masteryState,
    lesson.masteryConfig,
    transferCandidates,
  );
  const action: Action = !layer2.ok
    ? noAction('agent_unsure', `outbound Layer-2 rejection: ${layer2.detail}`)
    : earnedItRejection
      ? noAction('agent_unsure', earnedItRejection)
      : shaped;

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
      learnerSnapshot: learnerDerived.snapshot,
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

    if (req.method === 'POST' && url.pathname === '/api/realtime/session') {
      handleRealtimeSession(deps, req, res).catch(() =>
        sendJson(res, 500, { error: 'failed to mint realtime token' }),
      );
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
