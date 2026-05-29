import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { scoreEquivalence } from '@polymath/booleans';
import {
  ClientEvent,
  noAction,
  SessionId,
  type Action,
  type ComponentSpec,
  type ExplainBackVerdict,
  type ServerMessage,
} from '@polymath/contract';
import type { Db } from './db/client.js';
import { events, experimentSubjects, learnerState, sessions, transferBank } from './db/schema.js';
import { scheduleSessionDeletion } from './privacy/sessionDeletion.js';
import type {
  AgentClient,
  AgentInput,
  LearnerSnapshot,
  TransferProbeItem,
  TurnSummary,
} from './agent/client.js';
import { validateLayer2 } from './agent/layer2.js';
import {
  evaluateMasteryGate,
  evaluateRuleGate,
  type LearnerState,
  type MasteryGateResult,
} from './mastery/gate.js';
import {
  deriveState,
  recomputeCorrect,
  toLearnerState,
  type DerivedState,
  type LoggedEvent,
} from './mastery/eventConsumer.js';
import { validateOutboundAction } from './agent/validateAction.js';
import { computeRecall } from './agent/recallReflex.js';
import { loadLesson, loadLessonIfExists, type Lesson } from './lessons/loader.js';
import { mintRealtimeToken } from './voice/token.js';
import { createRateLimiter } from './voice/rateLimiter.js';
import { buildReport } from './report/buildReport.js';
import { buildMetricsPayload, computeUiChurn } from './metrics/index.js';
import { circuitSuppressionArm } from './metrics/splitTest.js';
import { handleExplainBack, type ExplainBackRouteDeps } from './explainback/route.js';
import {
  createSubject,
  startPretest,
  submitPretest,
  startPosttest,
  submitPosttest,
  startFollowup,
  submitFollowup,
  linkSession,
  setNotes,
  exportSubjectCsv,
  bodyErrorStatus,
  EXPERIMENT_UUID_RE,
} from './experiment/routes.js';
import type { TransferBankItemRef } from './explainback/itemTokens.js';
import type { ExplainBackJudge, ProsodyFeatures } from '@polymath/graph';
import { makeExplainBackJudge } from '@polymath/graph';
import { ExplainBackCaptureRegistry } from './voice/explainBackRegistry.js';
import { tryHandleBaselineRoute } from './baseline/route.js';
import { tryHandleHandoffRoute } from './handoff/route.js';
import type { BaselineChatProvider } from './baseline/chatProvider.js';
import { makeOpenAiBaselineChatProvider } from './baseline/openaiChatProvider.js';
import { buildTeacherReport } from './report/teacherReport.js';

export interface ServerDeps {
  db: Db;
  agent: AgentClient;
  /** Browser origins allowed to open the WebSocket (CSWSH defense). A request
   *  with no `Origin` header (non-browser clients: the smoke test, the
   *  integration harness, `wscat`) is always allowed. Defaults to localhost. */
  allowedOrigins?: string[];
  /** F-11 explain-back LLM judge (Stage 4b). Injectable for tests; defaults to the
   *  key-gated `@langchain/openai` judge when `OPENAI_API_KEY` is set, else
   *  `undefined` → the rubric fails closed with `judge_unavailable`. */
  explainBackJudge?: ExplainBackJudge;
  /** F-11 prosody provider (AC#10): the WebRTC bridge's captured prosody for a
   *  session's explain-back utterance. Absent → the judge sees no prosody. */
  explainBackProsodyFor?: (sessionId: string, targetItemId: string) => ProsodyFeatures | undefined;
  /** F-11 transcript provider: the WebRTC bridge's server-side authoritative
   *  transcript for a session's explain-back utterance. This is the ONLY integrity
   *  source for the spoken content — the client-supplied `transcript` is NEVER used
   *  (CLAUDE.md "server never trusts the client": a client could otherwise POST a
   *  crafted transcript and pass the rubric without speaking). Absent (no capture for
   *  this key) → the rubric runs on an EMPTY transcript and FAILS CLOSED at
   *  precondition #3. Defaults to the injected `explainBackCaptureRegistry`'s getter
   *  in `createServer`, so the production path has a real server-side transcript seam. */
  explainBackTranscriptFor?: (sessionId: string, targetItemId: string) => string | undefined;
  /** F-11 server-side voice-capture registry (the bridge ↔ explain-back seam). When
   *  the caller doesn't inject `explainBackTranscriptFor`/`explainBackProsodyFor`
   *  directly, `createServer` sources both from this registry — the production wiring
   *  that makes a real spoken explain-back yield a server-side transcript. Defaults to
   *  a fresh registry; populating it from a live device session is the deferred
   *  cross-platform smoke (see explainBackRegistry.ts). */
  explainBackCaptureRegistry?: ExplainBackCaptureRegistry;
  /** F-16 baseline chat provider (the GPT-5 chat-baseline arm). Injectable for
   *  tests (a deterministic stub; CI is offline); defaults to the key-gated GPT-5
   *  provider when `OPENAI_API_KEY` is set, else `undefined` → the `/api/baseline/*`
   *  write routes fail CLOSED with a 503 (the `/api/realtime/session` pattern). */
  baselineChat?: BaselineChatProvider;
  /** F-17 operator-auth secret for the experiment-operator + replay routes (MR !7
   *  review). The experiment subject routes (`/api/experiment/subjects*`) and the
   *  session-replay route stream research/teaching data keyed only by a UUID; without
   *  a gate, anyone who obtains a subject/session UUID on the public agent port could
   *  read or mutate it. Injectable for tests; defaults to `POLYMATH_OPERATOR_SECRET`
   *  in `createServer`. FAIL-CLOSED in production: when this is unset, the gated routes
   *  return 503 in production (no secret ⇒ no operator access), while dev/CI
   *  (`NODE_ENV!=='production'`) stay open so local runs + the offline integration
   *  suite need no secret. When set, the gated routes require it (Bearer or
   *  `X-Operator-Secret`), else 401. The learner-facing followup route is EXEMPT — it
   *  carries its own per-subject random token. */
  operatorSecret?: string;
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

/**
 * Per-(session,item) serialization for explain-back handling (CLUSTER C — the
 * attempt-cap race). The route reads `priorAttempts` from the event log and only
 * persists the attempt row AFTER running the (paid) judge, so two concurrent
 * `explain_back_recording_ended` frames for the same session+item could BOTH read
 * `prior=0`, both pass the MAX_ATTEMPTS cap, and both invoke the judge — defeating
 * the cap and amplifying OpenAI cost. We serialize per key with a promise chain:
 * each frame awaits the prior frame for the same key before it reads the count, so
 * the first frame's row is persisted (and thus visible to `scanSession`) before the
 * next frame reads. Keys are pruned when their chain drains so the map can't grow
 * unboundedly. Per-process is sufficient: a single agent process owns the WS
 * connection for a session.
 */
/** A per-key promise-chain mutex: each caller awaits the prior holder of the same
 *  key before running, so a read-then-write critical section can't interleave across
 *  concurrent frames. Keys are pruned when their chain drains so the map stays
 *  bounded. Per-process is sufficient (one agent process owns a session's socket). */
function makeKeyedLock(): <T>(key: string, fn: () => Promise<T>) => Promise<T> {
  const locks = new Map<string, Promise<unknown>>();
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prior = locks.get(key) ?? Promise.resolve();
    const run = prior.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    locks.set(key, tail);
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
  };
}

const explainBackLockBy = makeKeyedLock();
function withExplainBackLock<T>(sessionId: string, targetItemId: string, fn: () => Promise<T>): Promise<T> {
  return explainBackLockBy(`${sessionId} ${targetItemId}`, fn);
}

/**
 * F-14 finding #3 — serialize the cross-lesson recall decision PER SESSION. The "≤1
 * recall per session per KC" throttle is a read-then-insert: `computeRecall` reads the
 * uncapped `readRecalledKcs` count, and the recall row is only persisted at the end of
 * the turn. `ws.on('message')` dispatches frames concurrently with no per-session
 * serialization, so two rapid submits for the same regressed KC could BOTH read zero
 * prior recalls before either inserts — both mounting a recall, violating AC#4 under
 * concurrency (exactly the race `withExplainBackLock` exists to prevent for the judge
 * cap). Holding this lock from the recall read THROUGH the events insert closes the
 * window: the first frame's recall row is visible to the second frame's read. The lock
 * scopes only the recall-decide→persist tail, so unrelated turn work still parallelizes.
 */
const withRecallLock = makeKeyedLock();

/**
 * CLUSTER E — the topic-guardrail MUST be monotonic across the WHOLE session, not
 * just the bounded `MAX_SESSION_EVENTS` fold window. The off-topic counter derived
 * from the newest-N fold ages out: a learner who tripped the budget could push the
 * off-topic rows out of the window with benign frames and drop back under budget
 * (fail-OPEN). So count the off-topic `answer_question` actions with a SEPARATE,
 * UNCAPPED aggregate query over the full session — the guardrail can never decrease.
 * The `payload.action.{type,topicClassification}` slot is exactly what
 * `toLoggedEvent` reads from the bounded fold; this just counts it across all rows.
 */
/** The default-OFF env opt-in for the visual-utility circuit-suppression split-test
 *  (metric 3, D6). Off ⇒ no arm is ever assigned, so the split-test stays dormant and
 *  the metric reports `unconfigured`. Must match the reader in `metrics/index.ts`. */
function circuitSplitTestEnabled(): boolean {
  return (process.env['POLYMATH_ENABLE_CIRCUIT_SPLIT_TEST'] ?? '').trim() === 'true';
}

async function countOffTopicAnswers(db: Db, sessionId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(
      // `app IS NULL` scopes to Polymath rows only (D3 discriminator; NULL=polymath,
      // 'baseline'=F-16). A baseline session uses its own sessionId so they don't
      // collide today, but the integrity queries must honor the discriminator the
      // barrier added precisely to keep baseline rows out of Polymath metrics — a
      // future shared-session path would otherwise fold baseline turns into this
      // monotonic guardrail (MR !7 review).
      sql`${events.sessionId} = ${sessionId}
        AND ${events.app} IS NULL
        AND ${events.payload} -> 'action' ->> 'type' = 'answer_question'
        AND ${events.payload} -> 'action' ->> 'topicClassification' = 'off_topic'`,
    );
  return rows[0]?.n ?? 0;
}

/** F-14 dev/test seam parser: `NOT:0.72,AND:0.5` → `{ NOT: 0.72, AND: 0.5 }`.
 *  A malformed pair (no colon, non-numeric, NaN, out of [0,1]) is SKIPPED — the seam
 *  degrades a bad value away rather than crashing the connection. An empty/whitespace
 *  string or no valid pairs → `undefined` (the reflex then uses the real
 *  `learner_state` read). Only ever reached behind the gated devSeams flag. */
function parseTestL1Bkt(raw: string | null): Record<string, number> | undefined {
  if (!raw) return undefined;
  const map: Record<string, number> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf(':');
    if (idx <= 0) continue;
    const kc = pair.slice(0, idx).trim();
    const bkt = Number(pair.slice(idx + 1).trim());
    if (kc.length === 0 || Number.isNaN(bkt) || bkt < 0 || bkt > 1) continue;
    map[kc] = bkt;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

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

/**
 * The persisted shape of `sessions.lesson_progress` (jsonb). The durable
 * lesson-arc record: which lesson a session is currently working on. Written by
 * the F-15 L1→L2 advance reflex; read by `currentLessonId` on every subsequent
 * turn. Defined as a typed interface (F-15/F-18/F-20 read it). A missing/absent
 * column → lesson 1 (the default, pre-advance state).
 */
export interface LessonProgress {
  currentLessonId: number;
}

/**
 * The lesson a session is working on — the BARRIER lesson-binding signature
 * (F-15 owns the durable write; F-13 wires the L2 read for `?lesson=2`; F-14
 * reads cross-lesson state through it).
 *
 * For a `session_start` event the lesson travels on the event itself (the session
 * is being (re)started on that lesson). For every other turn the binding is read
 * from the durable `sessions.lessonProgress.currentLessonId`, NOT hardcoded to 1
 * — the pre-barrier `lessonIdForEvent` silently folded every L2 turn against L1
 * content/config/kc-vocab after the first frame. Unknown/absent progress → 1.
 */
export async function currentLessonId(db: Db, sessionId: string): Promise<number> {
  const rows = await db
    .select({ progress: sessions.lessonProgress })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const progress = rows[0]?.progress as LessonProgress | null | undefined;
  const id = progress?.currentLessonId;
  return typeof id === 'number' && Number.isInteger(id) && id >= 1 ? id : 1;
}

/** The lesson a turn binds to — for EVERY kind (incl. `session_start`) this reads
 *  the durable per-session binding via `currentLessonId`, never the raw client
 *  frame. On `session_start` the frame handler has ALREADY committed the clamped
 *  binding (`bound = max(durable, seam-allowed request)`, server.ts ~920-934)
 *  before this read, so the turn's lesson is read-after-write of that clamped
 *  value — a forged `session_start.lessonId > 1` with the seam OFF is clamped to
 *  L1 here too, not just in the durable write (the in-turn fold must fail closed
 *  identically, else turn 1 leaks gated content; and a durably-advanced session
 *  that reconnects sending a lower lessonId folds against its real lesson, not
 *  the downgraded frame value). NOT trusting `event.lessonId` for the fold is the
 *  fix; the clamp lives in the handler that wrote `bound`. */
async function lessonIdForEvent(db: Db, event: ClientEvent): Promise<number> {
  return currentLessonId(db, event.sessionId);
}

/** Project a logged event payload into the consumer's `LoggedEvent` shape. The
 *  learner's `submission` is carried so the consumer can recompute correctness
 *  server-side (the BKT/streak must not trust the client's `correct` flag). */
function toLoggedEvent(kind: string, payload: unknown): LoggedEvent {
  const p = (payload ?? {}) as {
    event?: { itemId?: string; submission?: string; correct?: boolean; responseTimeMs?: number; targetItemId?: string };
    transferVerdict?: { correct?: boolean };
    // F-12 extends the projection to read `topicClassification` for the
    // topic-guardrail counter (was type + component.kind only).
    action?: { type?: string; component?: { kind?: string }; topicClassification?: string };
    // F-11 writes / F-12 reads F-11's persisted verdict slot (write-full /
    // read-narrow split, mirroring `transferVerdict`). Absent → undefined →
    // fail-closed (no pass).
    explainBackVerdict?: { passed?: boolean };
  };
  return {
    kind,
    // An explain-back event names its item via `targetItemId` (not `itemId`).
    itemId: p.event?.itemId ?? p.event?.targetItemId ?? p.event?.submission,
    submission: p.event?.submission,
    responseTimeMs: p.event?.responseTimeMs,
    transferCorrect: p.transferVerdict?.correct,
    // A served hint = the logged action mounted a HintCard (a refused request is a
    // no_action). Only known for persisted events; the current turn's action isn't
    // decided yet (and doesn't count toward its own level).
    hintMounted: p.action?.type === 'mount' && p.action.component?.kind === 'HintCard',
    // F-12 topic-guardrail: the agent's persisted answer was tagged off_topic.
    offTopic: p.action?.type === 'answer_question' && p.action.topicClassification === 'off_topic',
    // F-11 → F-12 seam: the server-computed explain-back verdict so the derived
    // state flips `explainBackPassed` (never a client flag). `=== true` so a
    // missing/false verdict stays false (fail-closed).
    explainBackPassed: p.explainBackVerdict?.passed === true,
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
  explainBackVerdict: ExplainBackVerdict | undefined,
): Promise<{
  snapshot: LearnerSnapshot;
  masteryState: LearnerState;
  hintsByItem: Record<string, number>;
  priorMissesByItem: Record<string, number>;
  currentSubmitCorrect: boolean | undefined;
}> {
  // Most-recent N events (bounded), then chronological for the fold. The off-topic
  // guardrail is counted SEPARATELY and UNCAPPED (CLUSTER E) so it can't age out of
  // this window; both are read in parallel.
  const [priorRowsDesc, offTopicTotal] = await Promise.all([
    db
      .select({ kind: events.kind, payload: events.payload })
      .from(events)
      // `app IS NULL` keeps baseline rows (D3 discriminator) out of the Polymath
      // integrity fold (BKT/streak/hints/rule gate) — MR !7 review.
      .where(and(eq(events.sessionId, sessionId), isNull(events.app)))
      .orderBy(desc(events.ts))
      .limit(MAX_SESSION_EVENTS),
    countOffTopicAnswers(db, sessionId),
  ]);
  const priorRows = priorRowsDesc.reverse();

  const priorLogged: LoggedEvent[] = priorRows.map((r) => toLoggedEvent(r.kind, r.payload));
  // Prior-only fold gives the miss baseline BEFORE this turn (so the heuristic's
  // repeated-miss escalation sees prior misses, not the current one).
  const priorDerived = deriveState(priorLogged, lesson.content, lesson.masteryConfig);

  // Then fold in the current event (not yet persisted), threading the server-computed
  // transfer verdict (so a passing transfer counts toward the gate this turn) AND the
  // explain-back verdict (so a passing explain-back counts the same turn it lands).
  const logged = [
    ...priorLogged,
    toLoggedEvent(current.kind, { event: current, transferVerdict, explainBackVerdict }),
  ];
  const derived = deriveState(logged, lesson.content, lesson.masteryConfig);
  // CLUSTER E: override the windowed off-topic count with the UNCAPPED session-wide
  // total (monotonic — never less than what the bounded fold saw). This is the
  // authoritative guardrail count; without it the budget could age out of the window.
  derived.offTopicCount = Math.max(derived.offTopicCount, offTopicTotal);
  const learnerState_ = toLearnerState(derived, lesson.masteryConfig);
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
      // F-12: thread the explain-back + topic-guardrail signals so the agent can
      // organically propose mastery only when the FULL gate (not just the rule gate)
      // is satisfied. Derived from the real fold — never a client flag.
      explainBackPassed: learnerState_.explainBackPassed,
      topicGuardrailClean: learnerState_.topicGuardrailClean,
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

/** Validate a `transfer_submitted` event against the probed bank item's canonical
 *  expression via the shared `scoreEquivalence` (ADR-010: the validator is the
 *  source of truth; the server decides the transfer verdict, not the agent). The
 *  scorer applies the var cap + parse-error→false guard — an over-wide or
 *  unparseable submission is simply `false`, never an event-loop-blocking 2^n
 *  enumeration or a crash.
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

  return { itemId: event.itemId, correct: scoreEquivalence(event.submission, canonical) };
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
 *   - a `transition` → `mastered` OR a direct `mount MasteryCelebration` (the two
 *     equivalent privileged mastery routes) needs the full mastery predicate satisfied
 *     server-side (the threaded `gate` over the derived state). When explain-back is
 *     unmet the gate cannot pass — a forged mastery transition/celebration is downgraded. */
function rejectUnauthorizedAction(
  action: Action,
  learner: LearnerSnapshot,
  gate: MasteryGateResult,
  candidates: TransferProbeItem[] | undefined,
): string | null {
  // Both privileged mastery routes get the earned-it gate: the `transition→mastered`
  // proposal AND a DIRECT `mount MasteryCelebration` (a forged/jailbroken provider can
  // emit either — MasteryCelebration is a valid mountable ComponentSpec that passes Zod
  // + passes Layer-2 trivially). The server is the truth-maker (the XState machine is not
  // driven at agent runtime — BUILD-PLAN decision #7), so this rejection path IS the
  // statechart guard. The legitimate celebration is server-minted via the accepted-
  // transition reflex (masteryCelebrationAction) with server-sourced conceptsMastered;
  // any agent-proposed celebration is therefore rejected unless the gate is satisfied —
  // and even then the agent's claimed conceptsMastered are never forwarded.
  const isMasteryTransition = action.type === 'transition' && action.to === 'mastered';
  const isDirectCelebration =
    action.type === 'mount' && action.component.kind === 'MasteryCelebration';
  if (isMasteryTransition || isDirectCelebration) {
    // The full-gate evaluation is computed ONCE per turn by the caller and threaded
    // in (no stale recompute). On rejection, name the blockers so AC#3's log records *why*.
    return gate.passed ? null : `mastery_gate_failed: ${gate.blockers.join(',')}`;
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

/** F-12: build the MasteryCelebration mount for an AUTHORIZED mastery transition.
 *  `conceptsMastered` is the set of KCs the learner has actually mastered (BKT ≥ the
 *  lesson's threshold) — sourced from the derived learner_state, not the agent's
 *  claim (AC#6).
 *
 *  F-15: `nextLessonId` is set to `lessonId + 1` ONLY when that next lesson actually
 *  loads (`loadLessonIfExists` — a NON-FATAL existence check). A hardcoded `2` before
 *  `lessons/2/` exists would render an enabled "continue" button whose
 *  `advance_lesson` reflex then crashes/refuses; gating on the existence check makes
 *  the affordance enabled ⇔ a real next lesson is present (fail-closed). The client
 *  enables the button iff `nextLessonId !== undefined`. */
function masteryCelebrationAction(masteryState: LearnerState, lesson: Lesson): Action {
  const conceptsMastered = Object.entries(masteryState.bktByKc)
    .filter(([, p]) => p >= lesson.masteryConfig.bktMasteryThreshold)
    .map(([kc]) => kc)
    .sort();
  const candidateNext = lesson.content.lessonId + 1;
  const nextExists = loadLessonIfExists(candidateNext) !== undefined;
  return {
    type: 'mount',
    component: {
      kind: 'MasteryCelebration',
      conceptsMastered,
      // F-15: only offer the next lesson when it exists + validates (guarded existence
      // check). Undefined → the client keeps the affordance disabled.
      ...(nextExists ? { nextLessonId: candidateNext } : {}),
    },
    rationale: 'mastery gate satisfied server-side — celebrating mastered concepts (F-12)',
  };
}

/** CLUSTER F — remediation when the explain-back PASSED but the full mastery gate is
 *  still blocked (e.g. `topic_guardrail_exceeded`). A bare `no_action` leaves the
 *  learner stuck: the transfer-pass reflex won't re-mount (explainBackPassed has
 *  latched true), so there's no retry/remediation path. Instead mount an explicit
 *  blocker UI keyed to the remaining blockers, using the EXISTING `HintCard`
 *  ComponentSpec variant (no new contract variant) so the learner sees WHY mastery is
 *  withheld and what to do. The body is keyed to the gate blockers. */
function blockerRemediationAction(blockers: MasteryGateResult['blockers']): Action {
  const messages: Record<string, string> = {
    topic_guardrail_exceeded:
      'Your explanation was solid! Mastery is held back only because we drifted off-topic too many times this session. Stay focused on the lesson and you can clear the gate.',
    rule_gate_failed:
      'Your explanation was solid! Keep practicing the items consistently (no hints, steady pace) to clear the remaining mastery requirements.',
    transfer_not_passed:
      'Your explanation was solid! You still need to pass a transfer probe on a fresh problem to demonstrate mastery.',
    explain_back_not_passed:
      'Your explanation was solid, but the mastery gate still needs a passing explain-back on this item.',
  };
  const body = blockers.map((b) => messages[b] ?? `Mastery blocked: ${b}.`).join(' ');
  return {
    type: 'mount',
    component: { kind: 'HintCard', level: 1, body },
    rationale: `explain-back passed but mastery gate blocked (${blockers.join(',')}); mounting blocker remediation (F-12)`,
  };
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

/** Read + parse a JSON body for an experiment POST, mapping the body-read failure
 *  reasons to their 4xx (shared with the realtime route's semantics). Returns the
 *  parsed body, or sends the error response and returns the sentinel `undefined`. */
async function readExperimentBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<unknown | undefined> {
  try {
    return (await readJsonBody(req)) ?? {};
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'invalid request body';
    sendJson(res, bodyErrorStatus(reason), { error: reason });
    return undefined;
  }
}

/**
 * F-17 experiment route dispatcher. Mirrors `handleRealtimeSession`'s
 * read-body/validate/respond shape; each branch maps a method+pathname to a
 * handler in `experiment/routes.ts`, building the CSV/JSON from Postgres (the
 * source of truth — nothing on disk). Unmatched experiment paths fall through to
 * a 404.
 */
/**
 * Operator-auth gate for the experiment-operator + replay routes (MR !7 review).
 * Returns `null` when the request is authorized to proceed, or a `{ status, body }`
 * to send otherwise. Three states, fail-closed in production:
 *  - secret configured → require a matching `Authorization: Bearer <secret>` or
 *    `X-Operator-Secret: <secret>` (constant-time compare); mismatch/absent → 401.
 *  - secret unset + production → 503 (no operator access without a configured secret;
 *    the `/api/realtime/session` env-gated-fail-closed pattern).
 *  - secret unset + non-production → allow (local dev + the offline integration suite
 *    run with no secret).
 * The learner-facing `/api/experiment/followup/:token` route does NOT call this — it
 * authenticates with its own per-subject random token.
 */
function checkOperatorAuth(
  req: http.IncomingMessage,
  secret: string | undefined,
): { status: number; body: unknown } | null {
  if (!secret) {
    if (process.env['NODE_ENV'] === 'production') {
      return { status: 503, body: { error: 'operator routes not configured' } };
    }
    return null; // dev/CI: no secret required
  }
  const header = req.headers['authorization'];
  const bearer = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : undefined;
  const xHeader = req.headers['x-operator-secret'];
  const presented = bearer ?? (typeof xHeader === 'string' ? xHeader : undefined);
  if (presented === undefined) {
    return { status: 401, body: { error: 'operator auth required' } };
  }
  // Constant-time compare; length-mismatch is a definite non-match (timingSafeEqual
  // throws on unequal lengths, so guard first).
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { status: 401, body: { error: 'operator auth required' } };
  }
  return null;
}

async function handleExperimentRoute(
  deps: ServerDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  const { pathname } = url;
  const method = req.method ?? 'GET';
  const routeDeps = { db: deps.db };

  // Operator-auth gate (MR !7): everything EXCEPT the learner-facing followup route
  // (which carries its own per-subject random token) requires operator auth. Applied
  // once here so a new operator route can't forget it.
  if (!pathname.startsWith('/api/experiment/followup/')) {
    const denied = checkOperatorAuth(req, deps.operatorSecret);
    if (denied) {
      sendJson(res, denied.status, denied.body);
      return;
    }
  }

  // POST /api/experiment/subjects — create a subject (counterbalanced + token).
  if (method === 'POST' && pathname === '/api/experiment/subjects') {
    const r = await createSubject(routeDeps);
    sendJson(res, r.status, r.body);
    return;
  }

  // /api/experiment/subjects/:id/...
  const subjMatch = pathname.match(/^\/api\/experiment\/subjects\/([^/]+)(\/.*)?$/);
  if (subjMatch) {
    const subjectId = subjMatch[1]!;
    const sub = subjMatch[2] ?? '';
    if (!EXPERIMENT_UUID_RE.test(subjectId)) {
      sendJson(res, 400, { error: 'subjectId must be a UUID' });
      return;
    }
    if (method === 'POST' && sub === '/pretest/start') {
      const r = await startPretest(routeDeps, subjectId);
      sendJson(res, r.status, r.body);
      return;
    }
    if (method === 'POST' && sub === '/pretest/submit') {
      const body = await readExperimentBody(req, res);
      if (body === undefined) return;
      const r = await submitPretest(routeDeps, subjectId, body);
      sendJson(res, r.status, r.body);
      return;
    }
    if (method === 'POST' && sub === '/posttest/start') {
      const r = await startPosttest(routeDeps, subjectId);
      sendJson(res, r.status, r.body);
      return;
    }
    if (method === 'POST' && sub === '/posttest/submit') {
      const body = await readExperimentBody(req, res);
      if (body === undefined) return;
      const r = await submitPosttest(routeDeps, subjectId, body);
      sendJson(res, r.status, r.body);
      return;
    }
    if (method === 'POST' && sub === '/session') {
      const body = await readExperimentBody(req, res);
      if (body === undefined) return;
      const r = await linkSession(routeDeps, subjectId, body);
      sendJson(res, r.status, r.body);
      return;
    }
    if (method === 'POST' && sub === '/notes') {
      const body = await readExperimentBody(req, res);
      if (body === undefined) return;
      const r = await setNotes(routeDeps, subjectId, body);
      sendJson(res, r.status, r.body);
      return;
    }
    if (method === 'GET' && sub === '/export.csv') {
      const r = await exportSubjectCsv(routeDeps, subjectId);
      if (r.status !== 200) {
        sendJson(res, r.status, { error: 'unknown subject' });
        return;
      }
      const payload = r.csv;
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${subjectId}.csv"`,
        'content-length': Buffer.byteLength(payload),
      });
      res.end(payload);
      return;
    }
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  // /api/experiment/followup/:token — token is the random secret, NOT the subj id.
  const followMatch = pathname.match(/^\/api\/experiment\/followup\/([^/]+)$/);
  if (followMatch) {
    const token = followMatch[1]!;
    if (method === 'GET') {
      const r = await startFollowup(routeDeps, token);
      sendJson(res, r.status, r.body);
      return;
    }
    if (method === 'POST') {
      const body = await readExperimentBody(req, res);
      if (body === undefined) return;
      const r = await submitFollowup(routeDeps, token, body);
      sendJson(res, r.status, r.body);
      return;
    }
  }

  sendJson(res, 404, { error: 'not found' });
}

/** Per-connection options resolved from the WS upgrade request (dev seams). */
export interface FrameOptions {
  /** F-12 AC#3 dev seam (`?testForce=mastered`): inject a real `transition→mastered`
   *  proposal so the earned-it gate's refusal is demoable. Gated — the connection
   *  handler only sets it when `NODE_ENV!=='production'` AND `POLYMATH_ENABLE_TEST_SEAMS
   *  ==='true'` (explicit opt-in, default OFF; fail-closed on the seam itself). It does
   *  NOT grant mastery: the gate still rejects it when the predicate fails; it only
   *  forces the proposal so the rejection path runs. */
  testForceMastered?: boolean;
  /** F-11/F-12 dev/test seam (`?testExplainBackVerdict=pass|fail`): synthesize the
   *  `explain_back_recording_ended` turn's `explainBackVerdict`. The integration tests
   *  drive the explain-back turn through this because the real LLM judge needs an
   *  `OPENAI_API_KEY` they lack in CI; the seam is therefore KEPT (not deleted) but is
   *  now wired INTO the explain-back route (`handleExplainBack` honors it as the verdict
   *  and skips the real judge), rather than read at the fold. Dev-only
   *  (`NODE_ENV!=='production'` — inert in prod; a keyed prod deploy runs the real
   *  judge, a keyless one fails closed). NOT a fail-open: absent the seam, the real
   *  rubric runs and an unmet precondition / unavailable judge → `passed:false` → no
   *  pass folded → mastery blocked (the fail-closed default). */
  testExplainBackVerdict?: ExplainBackVerdict;
  /** F-13 AC#8 dev/test seam (`?lesson=2`): allow a `session_start` to BIND the
   *  session to a lesson > 1 it has not durably earned. Gated identically to the
   *  other seams (`NODE_ENV!=='production'` AND `POLYMATH_ENABLE_TEST_SEAMS==='true'`,
   *  explicit opt-in, default OFF). FAIL-CLOSED: without the seam a client-supplied
   *  `session_start.lessonId > 1` is IGNORED for binding (a learner cannot skip L1 by
   *  forging the frame; the real L1→L2 gate is F-15's statechart-driven advance). A
   *  session that has *durably* advanced (F-15 wrote `lessonProgress`) keeps its
   *  lesson regardless of the seam — the binding is `max(durable, seam-allowed
   *  request)`, never a downgrade. */
  allowLessonOverride?: boolean;
  /** F-14 dev/test seam (`?testL1Bkt=NOT:0.72,AND:0.5`): a synthetic prior-lesson
   *  (L1) KC → BKT map injected for the cross-lesson recall reflex. There is NO
   *  production recall trigger until F-15 preserves L1 `learner_state` in-session;
   *  standalone build/eval drives the reflex deterministically through this seam.
   *  Gated like the others (`NODE_ENV!=='production'` AND `POLYMATH_ENABLE_TEST_SEAMS
   *  ==='true'`, default OFF). When present it REPLACES the `learner_state` read; the
   *  recall still flows through the same throttle + phase suppression, so the seam
   *  exercises the real reflex, it doesn't bypass it. */
  testL1Bkt?: Record<string, number>;
}

/**
 * F-11/F-12 SERIAL JOIN (Option A — same-turn mastery celebration). Handle one
 * `explain_back_recording_ended` frame end-to-end and persist exactly one event row.
 *
 *   1. Run the explain-back rubric via `handleExplainBack` (or honor the dev/test
 *      synthetic verdict) → `{ verdict, failPathAction, passed, validation }`.
 *   2. Fold the verdict into the learner state THIS turn (`updateAndReadLearnerState`
 *      threads it so the just-arrived passing verdict makes `explainBackPassed=true` in
 *      the fold) and evaluate the full mastery gate.
 *   3. On a PASS where the gate clears: run the earned-it check (defense-in-depth — a
 *      server-minted MasteryCelebration must still satisfy the gate) and reply with a
 *      server-minted `MasteryCelebration` (server-sourced `conceptsMastered`), recording
 *      `statechartDecision:'accept'`. The celebration mounts the SAME turn.
 *   4. On a PASS where the gate does NOT clear (e.g. topic-guardrail tripped): reply
 *      with `no_action` and persist the blocking `gateEvaluation` (no celebration).
 *   5. On a FAIL / cap / precondition-fail: reply with F-11's `failPathAction` (retry
 *      mount or escalation) and persist the failing verdict + the blocking gate.
 *
 * The persisted row carries `{ event, action, learnerSnapshot, explainBackVerdict,
 * gateEvaluation, statechart…, validation }` — so the replay shows the verdict, the
 * gate flipping false→true, and the `accept` decision on the explain-back turn.
 */
async function handleExplainBackTurn(
  deps: ServerDeps,
  ws: WebSocket,
  event: Extract<ClientEvent, { kind: 'explain_back_recording_ended' }>,
  lesson: Lesson,
  opts: FrameOptions,
): Promise<void> {
  // Resolve a probed transfer item's tokens (#5) from the bank too (read-only).
  const bankRows = await deps.db
    .select({ itemId: transferBank.itemId, targetExpression: transferBank.targetExpression })
    .from(transferBank)
    .where(eq(transferBank.lessonId, lesson.content.lessonId));
  const transferItems: TransferBankItemRef[] = bankRows.map((b) => ({
    itemId: b.itemId,
    targetExpression: b.targetExpression,
  }));
  const routeDeps: ExplainBackRouteDeps = {
    db: deps.db,
    ...(deps.explainBackJudge ? { judge: deps.explainBackJudge } : {}),
    ...(deps.explainBackProsodyFor ? { prosodyFor: deps.explainBackProsodyFor } : {}),
    ...(deps.explainBackTranscriptFor ? { transcriptFor: deps.explainBackTranscriptFor } : {}),
    transferItems,
    // The dev/test seam (NODE_ENV-gated by the connection handler) injects the verdict
    // so `handleExplainBack` skips the real judge — the tests' verdict source.
    ...(opts.testExplainBackVerdict ? { syntheticVerdict: opts.testExplainBackVerdict } : {}),
  };
  const outcome = await handleExplainBack(routeDeps, event, lesson);

  // Fold this turn's verdict into the learner state SAME-TURN: a passing verdict makes
  // `explainBackPassed=true` in the fold so the full gate can clear THIS turn (Option A).
  // A failing/cap verdict folds fail-closed (the gate stays blocked on explain-back).
  const learnerDerived = await updateAndReadLearnerState(
    deps.db,
    event.sessionId,
    event,
    lesson,
    undefined, // no transfer verdict on an explain-back turn
    outcome.verdict,
  );
  const gateEvaluation = evaluateMasteryGate(learnerDerived.masteryState, lesson.masteryConfig);

  // Decide the same-turn action. On a PASS where the gate clears, mint the celebration;
  // otherwise forward F-11's fail-path action (a non-pass) or a no_action (a pass that
  // the gate still blocks, e.g. topic guardrail).
  let action: Action;
  let statechart: { statechartDecision: 'accept'; statechartReason: string } | undefined;
  if (outcome.passed && gateEvaluation.passed) {
    // Earned-it defense-in-depth: the server-minted celebration must itself satisfy the
    // gate (it does here by construction, but route the same predicate as the agent path
    // so the rule can never drift). The legitimate celebration is ALWAYS server-minted
    // with server-sourced conceptsMastered (never an agent/client claim).
    action = masteryCelebrationAction(learnerDerived.masteryState, lesson);
    statechart = { statechartDecision: 'accept', statechartReason: 'mastery_gate_satisfied' };
  } else if (outcome.passed) {
    // CLUSTER F: explain-back PASSED but the full gate is still blocked (e.g.
    // topic_guardrail_exceeded). Don't return a bare no_action — explainBackPassed has
    // latched true, so the transfer-pass reflex won't re-mount and the learner has no
    // path forward. Mount an explicit blocker-remediation (HintCard, an existing
    // variant) keyed to the remaining blockers so the learner sees WHY + what to do.
    action = blockerRemediationAction(gateEvaluation.blockers);
  } else {
    // A non-pass → F-11's retry mount / escalation. The blocking gate is persisted below.
    action = outcome.failPathAction;
  }

  // Persist exactly one row for this turn (the route no longer writes its own). It
  // carries the verdict, the per-turn gate evaluation (so the replay shows false→true),
  // the `accept` statechart decision (on a gate-clearing pass), and the Layer-4 validation.
  await deps.db.insert(events).values({
    sessionId: event.sessionId,
    kind: event.kind,
    payload: {
      event,
      action,
      learnerSnapshot: learnerDerived.snapshot,
      explainBackVerdict: outcome.verdict,
      gateEvaluation: { passed: gateEvaluation.passed, blockers: gateEvaluation.blockers },
      ...(statechart ?? {}),
      validation: outcome.validation,
    },
  });

  send(ws, { kind: 'action', sessionId: event.sessionId, action });
}

/**
 * F-15 L1→L2 ADVANCE REFLEX (the I3 merge sink). A dedicated SERVER reflex (modeled
 * on the explain-back branch) — NOT the LLM, NOT the agent menu, NOT XState (the
 * server runs no actor; this branch IS the macro guard, mirroring
 * `rejectUnauthorizedAction`'s earned-it pattern).
 *
 * The single highest-risk correctness invariants (BUILD-PLAN):
 *   - SAME sessionId, ALWAYS. We never mint a new session — the prior-lesson
 *     `learner_state` rows must survive under this sessionId so F-14's cross-lesson
 *     recall/regression detector can read them.
 *   - DETERMINISTIC mount of L2's `content.items[0]` (a server reflex, ~<500ms),
 *     never the LLM (which is ~5-10s at a phase boundary and would miss AC#2).
 *   - The `alreadyStarted` reflex is SIDESTEPPED: we mount L2's first item here
 *     directly and never re-send `session_start`, so the heuristic provider's
 *     "session already in progress → no_action" path is never hit on advance.
 *
 * The EARNED-IT GUARD (real AC#4 server enforcement, fail-closed):
 *   - L1 mastery is re-derived server-side from the event log (the same
 *     `evaluateMasteryGate` over the freshly-folded learner state) — never trusted
 *     from the client frame. If the gate does NOT pass, the advance is REFUSED with
 *     `no_action` and the blocking gate is persisted (no lesson change, no mount).
 *   - `toLessonId` must be exactly `currentLessonId + 1` (no skipping) and must
 *     actually load (`loadLessonIfExists`) — otherwise refuse. A missing/forged
 *     target is *block*, never a half-valid advance.
 */
async function handleAdvanceLessonTurn(
  deps: ServerDeps,
  ws: WebSocket,
  event: Extract<ClientEvent, { kind: 'advance_lesson' }>,
  fromLesson: Lesson,
): Promise<void> {
  // Re-derive the CURRENT (L1) learner state + the full mastery gate server-side from
  // the event log — the earned-it guard. `advance_lesson` carries no submission, so the
  // fold just re-reads the persisted log; the gate is the authoritative L1-mastered
  // signal (never the client). No transfer/explain-back verdict is introduced this turn.
  const learnerDerived = await updateAndReadLearnerState(
    deps.db,
    event.sessionId,
    event,
    fromLesson,
    undefined,
    undefined,
  );
  const gateEvaluation = evaluateMasteryGate(learnerDerived.masteryState, fromLesson.masteryConfig);

  // Guard #1: the target must be exactly the next lesson (no skipping) AND must load.
  const expectedNext = fromLesson.content.lessonId + 1;
  const nextLesson =
    event.toLessonId === expectedNext ? loadLessonIfExists(event.toLessonId) : undefined;

  // Guard #2: L1 mastery must hold server-side. Fail-closed: any unmet condition (or a
  // bad/forged target) → no_action, no lesson change, no mount. The blockers are named
  // so the replay records *why* (AC#3-style), mirroring the mastery earned-it rejection.
  const refuseReason = !gateEvaluation.passed
    ? `mastery_gate_failed: ${gateEvaluation.blockers.join(',')}`
    : !nextLesson
      ? `next_lesson_unavailable: ${event.toLessonId}`
      : null;

  let action: Action;
  let statechart: { statechartDecision: 'accept' | 'reject'; statechartReason: string };
  if (refuseReason || !nextLesson) {
    action = noAction('agent_unsure', refuseReason ?? `next_lesson_unavailable: ${event.toLessonId}`);
    statechart = { statechartDecision: 'reject', statechartReason: refuseReason ?? 'next_lesson_unavailable' };
  } else {
    // ACCEPTED. Write the durable lesson-arc binding on the SAME session (so the next
    // turn's `currentLessonId` reads L2 and prior-lesson learner_state survives), then
    // DETERMINISTICALLY mount L2's first item (server reflex — not the LLM).
    const progress: LessonProgress = { currentLessonId: event.toLessonId };
    await deps.db.update(sessions).set({ lessonProgress: progress }).where(eq(sessions.id, event.sessionId));

    const first = nextLesson.content.items[0];
    action = first
      ? {
          type: 'mount',
          component: {
            kind: 'TruthTablePractice',
            expression: first.targetExpression,
            claimedTruthTable: first.truthTable,
            visibleReps: ['truth_table'],
          },
          rationale: `L1 mastery earned — advancing to lesson ${event.toLessonId} and mounting its first item "${first.itemId}" (server reflex, F-15)`,
        }
      : noAction('wait_for_learner', `lesson ${event.toLessonId} has no items to mount`);
    statechart = { statechartDecision: 'accept', statechartReason: 'l1_mastery_earned' };
  }

  // Persist exactly one event row for the advance turn, carrying the gate evaluation +
  // the accept/reject decision so the replay shows the guard's verdict.
  await deps.db.insert(events).values({
    sessionId: event.sessionId,
    kind: event.kind,
    payload: {
      event,
      action,
      learnerSnapshot: learnerDerived.snapshot,
      gateEvaluation: { passed: gateEvaluation.passed, blockers: gateEvaluation.blockers },
      ...statechart,
    },
  });

  send(ws, { kind: 'action', sessionId: event.sessionId, action });
}

/** Handle one inbound WebSocket frame: validate → run agent → validate output →
 *  persist → reply. Exported for direct unit/integration testing. */
export async function handleClientFrame(
  deps: ServerDeps,
  ws: WebSocket,
  raw: string,
  opts: FrameOptions = {},
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

  // Observability telemetry beacons (`ui_mount`, `intelligibility_response`) are NOT
  // learner actions: they never fold into the mastery state and must never trigger an
  // agent turn (no mount/no_action proposal). Ack and return early so they stay off the
  // critical path.
  if (event.kind === 'ui_mount' || event.kind === 'intelligibility_response') {
    // The `ui_mount` beacon is PERSISTED (app:null, payload:{componentKind,phase}) so
    // the UI-churn endpoint can fold it later — it is append-only and NON-integrity: it
    // does NOT route through the mastery/eventConsumer fold (no BKT/streak/off-topic
    // effect) and must not block the WS happy path. Persist fire-and-forget; a write
    // failure must not break the round-trip, so we ack regardless.
    if (event.kind === 'ui_mount') {
      try {
        await deps.db.insert(events).values({
          sessionId: event.sessionId,
          kind: 'ui_mount',
          payload: { componentKind: event.componentKind, phase: event.phase },
          app: null,
        });
      } catch {
        // Beacon write is best-effort telemetry; never fail the round-trip on it.
      }
    }
    // The intelligibility beacon is DURABLE: the intelligibility counter-metric folds
    // the learner's yes/no/skip answers off the `events` table under `events.app IS NULL`
    // (the polymath turn-write convention). Persist it with the whole frame under
    // `payload.event` so the metric reads `mountedKind` + `answer` exactly where the
    // pure fold expects them.
    if (event.kind === 'intelligibility_response') {
      await deps.db
        .insert(events)
        // app: null explicitly (MR !8 review) — match ui_mount and EVERY app-IS-NULL
        // integrity read, so a future writer that sets events.app can't accidentally
        // exclude intelligibility rows from the metric fold while still inserting them.
        .values({ sessionId: event.sessionId, kind: event.kind, payload: { event }, app: null })
        .catch(() => {
          // A telemetry write failure must never break the connection — the beacon is
          // best-effort, off the critical path; degrade to a dropped sample.
        });
    }
    send(ws, { kind: 'ack', sessionId: event.sessionId, event: event.kind });
    return;
  }

  // F-13: bind the session to the lesson it STARTS on. `session_start` carries its
  // own lessonId (e.g. the `?lesson=2` dev seam); persist it into the durable
  // `sessions.lessonProgress` so EVERY subsequent turn reads L2 via `currentLessonId`
  // — without this the second turn folds against L1 again (the pre-barrier bug the
  // spec names). This is the READ-wiring only: F-15 owns the durable L1→L2 *advance*
  // (the mid-session reflex). We never DOWNGRADE: if a session already advanced to a
  // higher lesson (F-15), a re-announced `session_start` on a lower lesson (e.g. a
  // reconnect) must not stomp the progress — bind to the max.
  if (event.kind === 'session_start') {
    const current = await currentLessonId(deps.db, event.sessionId);
    // FAIL-CLOSED: a client-supplied lesson > 1 only binds when the dev seam allows
    // it (a forged frame can't skip L1 in prod). A durably-advanced session (F-15)
    // keeps its lesson via the max — never a downgrade on a reconnect.
    const requested = opts.allowLessonOverride ? event.lessonId : Math.min(event.lessonId, 1);
    const bound = Math.max(current, requested);
    if (bound !== current) {
      const progress: LessonProgress = { currentLessonId: bound };
      await deps.db
        .update(sessions)
        .set({ lessonProgress: progress })
        .where(eq(sessions.id, event.sessionId));
    }
  }

  // Assemble the turn input the agent reasons over: lesson content, the learner
  // snapshot, and recent history (ADR-003: fresh-per-turn, structured state only).
  // ORDERING IS LOAD-BEARING: the `session_start` bind above must commit `bound`
  // BEFORE this read — `lessonIdForEvent` reads the durable (clamped) binding for
  // every kind incl. `session_start`, so the turn folds against the SAME clamped
  // lesson as the durable write (a forged `session_start.lessonId > 1` with the
  // seam off is L1 here too, not just in the row). Do not move this above the bind.
  const lesson = getLesson(await lessonIdForEvent(deps.db, event));

  // F-11/F-12 SERIAL JOIN (Option A — same-turn mastery celebration). The explain-back
  // rubric is a deterministic SERVER REFLEX — it does NOT go through proposeMove (off
  // the forgeable/jailbroken-LLM path, out of the menu lockstep). Handle it BEFORE the
  // generic agent turn: run the rubric (preconditions → judge, fail closed) to get the
  // verdict, then — on a PASS — CONTINUE into F-12's gate: fold the passing verdict into
  // the learner state THIS turn, evaluate the full mastery gate, and (when it clears)
  // mint the MasteryCelebration on this same turn (no longer a next-turn `no_action`).
  // On a FAIL/cap/precondition-fail, keep F-11's behavior (retry mount / escalation).
  // Exactly ONE event row is persisted, carrying the verdict, the gate evaluation, and
  // (on a pass-and-gate-clear) the `accept` statechart decision — so the replay shows
  // the gate flipping false→true on the explain-back turn.
  if (event.kind === 'explain_back_recording_ended') {
    // CLUSTER C: serialize per session+item so concurrent frames can't all read the
    // same pre-insert attempt count and each fire the paid judge past MAX_ATTEMPTS.
    await withExplainBackLock(event.sessionId, event.targetItemId, () =>
      handleExplainBackTurn(deps, ws, event, lesson, opts),
    );
    return;
  }

  // F-15 L1→L2 advance: a dedicated SERVER reflex (re-derives L1 mastery as the
  // earned-it guard, writes sessions.lessonProgress on the SAME session, and
  // deterministically mounts L2's first item — never the LLM). `lesson` here is the
  // CURRENT (from) lesson, resolved via `currentLessonId` above. Handled BEFORE the
  // generic agent turn so it never touches the menu / `alreadyStarted` reflex.
  if (event.kind === 'advance_lesson') {
    await handleAdvanceLessonTurn(deps, ws, event, lesson);
    return;
  }

  // ADR-012 stretch — the free-build playground. These four event kinds are NOT
  // graded practice: they carry no authored answer key, must never fold into the
  // BKT/streak or transfer path, and never reach the menu/`proposeMove`. The
  // contract shape + this routing land here; the owning feature fills in the
  // scaffold/equivalence behavior. Acknowledge and return so a playground frame
  // can't be misrouted into the practice turn below.
  if (
    event.kind === 'enter_playground' ||
    event.kind === 'playground_submit' ||
    event.kind === 'playground_request_scaffold' ||
    event.kind === 'exit_playground'
  ) {
    send(ws, { kind: 'ack', sessionId: event.sessionId, event: event.kind });
    return;
  }
  // The transfer verdict (server-computed) must be known before deriving learner
  // state, so a passed transfer sets the gate's transfer condition this turn.
  const transferVerdict = await computeTransferVerdict(deps.db, event);
  // Non-explain-back turns never carry an explain-back verdict — it is resolved on the
  // explain_back_recording_ended turn (handled above) and folded from the persisted log
  // thereafter. Fail-closed by default: undefined → no verdict → mastery blocked.
  const explainBackVerdict: ExplainBackVerdict | undefined = undefined;
  const [learnerDerived, recentHistory, transferCandidates, inTransferProbe] = await Promise.all([
    updateAndReadLearnerState(deps.db, event.sessionId, event, lesson, transferVerdict, explainBackVerdict),
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
  const agentProposed = await proposeWithTimeout(deps.agent, input);
  // F-12 AC#3 dev seam: `?testForce=mastered` injects a real mastery-transition
  // proposal (bypassing the agent's own choice) so the earned-it gate's refusal is
  // demoable. It still flows through validateOutboundAction → the earned-it gate, so
  // it is REJECTED whenever the gate predicate fails — it proves the refusal, it does
  // NOT grant mastery.
  const proposed: Action = opts.testForceMastered
    ? { type: 'transition', to: 'mastered', rationale: 'dev seam ?testForce=mastered — forced mastery proposal' }
    : agentProposed;
  const { action: shaped, downgraded } = validateOutboundAction(proposed);
  const layer2 = validateLayer2(shaped);

  // F-12: the single full-gate evaluation for this turn. The earned-it rejection AND
  // the (informational) statechart decision both derive from THIS one call — no stale
  // recompute. Computed every turn so the replay can show the gate failing then
  // passing (AC#5).
  const gateEvaluation = evaluateMasteryGate(learnerDerived.masteryState, lesson.masteryConfig);

  // Outbound earned-it gate (server never trusts the agent — matters once an LLM
  // provider is live): a TransferProbe mount is downgraded unless the rule gate
  // passed and it matches an allowed unseen bank row; a transition→mastered is
  // downgraded unless the full mastery predicate holds server-side.
  const earnedItRejection = rejectUnauthorizedAction(
    shaped,
    learnerDerived.snapshot,
    gateEvaluation,
    transferCandidates,
  );

  // F-12 AC#3: the server rejection path IS the mastery-transition truth-maker. Record
  // the statechart-style decision for a proposed mastery transition so the demo's
  // "show the gate failing then passing" reads `statechartDecision`/`statechartReason`.
  // A DIRECT `mount MasteryCelebration` is the equivalent privileged route (a forged
  // provider could emit it instead of a transition); it is treated identically so an
  // authorized celebration is always SERVER-MINTED (server-sourced conceptsMastered),
  // never forwarded with the agent's claimed concepts.
  const isMasteryTransition =
    (shaped.type === 'transition' && shaped.to === 'mastered') ||
    (shaped.type === 'mount' && shaped.component.kind === 'MasteryCelebration');
  const statechart = isMasteryTransition
    ? earnedItRejection
      ? { statechartDecision: 'reject' as const, statechartReason: earnedItRejection }
      : { statechartDecision: 'accept' as const, statechartReason: 'mastery_gate_satisfied' }
    : undefined;

  // F-12 AC#1/AC#6: an ACCEPTED mastery transition mounts the MasteryCelebration. The
  // transition Action itself carries no component, so the server reflexively resolves
  // an authorized mastery transition into a MasteryCelebration mount listing the KCs
  // the learner has actually mastered (BKT ≥ threshold). The F-11 transfer-pass reflex
  // (below) may still supersede this with an ExplainBackPrompt mount.
  const validatedAction: Action = !layer2.ok
    ? noAction('agent_unsure', `outbound Layer-2 rejection: ${layer2.detail}`)
    : earnedItRejection
      ? noAction('agent_unsure', earnedItRejection)
      : isMasteryTransition
        ? masteryCelebrationAction(learnerDerived.masteryState, lesson)
        : shaped;

  // F-11 TRANSFER-PASS REFLEX (deterministic, NOT via the LLM menu): when this turn
  // is a PASSED transfer probe and the lesson requires explain-back, the SERVER
  // mounts `ExplainBackPrompt` directly — superseding the stub/LLM `no_action` arm.
  // This keeps the integrity prompt off the forgeable/jailbroken-LLM path and out of
  // the two-place menu lockstep. `targetItemId` is the just-passed transfer item; the
  // browser TTSes `promptBody` then opens the server-clamped `maxDurationSec` window.
  // Guard: do NOT re-mount explain-back once it has already passed for this session.
  // Without this, every subsequent correct transfer (in a future where the judge is
  // wired and a learner CAN pass) loops a mastered learner back into explain-back.
  // explainBackPassed is server-derived from the full log (never a client flag).
  const action: Action =
    transferVerdict?.correct === true &&
    lesson.masteryConfig.requireExplainBackPass &&
    !learnerDerived.masteryState.explainBackPassed
      ? {
          type: 'mount',
          component: {
            kind: 'ExplainBackPrompt',
            targetItemId: transferVerdict.itemId,
            promptBody:
              'Nice — you passed the transfer. In your own words, walk me through how you solved that specific problem.',
            maxDurationSec: 15,
          },
          rationale: `transfer passed for ${transferVerdict.itemId}; mounting explain-back (server reflex, F-11)`,
        }
      : validatedAction;

  // F-14 CROSS-LESSON RECALL REFLEX (deterministic SERVER reflex, NOT an LLM menu
  // move — it never goes through proposeMove/TacticalMove/MoveSchema). When the
  // learner regresses on a prior-lesson (L1) KC mid-L2 (its server-derived BKT slips
  // below 0.85), the SERVER mounts a text-only `CrossLessonRecall` card — bypassing
  // the LLM (the BKT check IS the earned-it gate, so the server is the truth-maker).
  //
  // Gating (fail-closed defaults):
  //  - SUPPRESS during the `transferring` phase (`inTransferProbe`): a recall mid-probe
  //    would break the held-out-rep measurement and distract the assessment.
  //  - Only ever supersede a ROUTINE turn — recall is the LOWEST-precedence reflex.
  //    This is an ALLOW-LIST, not a deny-list: recall fires ONLY when the turn would
  //    otherwise be a `no_action` OR a routine practice/intro `mount` (a practice
  //    item, a worked example, an intro, a hint, a confidence check). It must NEVER
  //    replace an `answer_question` (the learner asked a question — discarding their
  //    answer for a recall card silently swallows the question), a `transition`, or an
  //    integrity/privileged mount (MasteryCelebration, ExplainBackPrompt, TransferProbe,
  //    AgentAnswer). A deny-list of three kinds would let recall hijack exactly those
  //    legitimate turns — the "fixed the happy path, broke the legitimate path" trap.
  //  - NO production trigger until F-15. The reflex fires ONLY through the
  //    `POLYMATH_ENABLE_TEST_SEAMS`-gated synthetic-L1-BKT seam (`opts.testL1Bkt`),
  //    which drives it standalone for build/eval. A bare `lessonId > 1` heuristic
  //    would fire on ordinary low L2 BKT (the (session,kc)-keyed `learner_state`
  //    holds the LIVE L2 value, not a preserved L1 snapshot) — a false-positive
  //    recall. F-15 supplies the real preserved-L1 trigger (finding #5).
  // The "≤1 recall per session per KC" throttle is a SEPARATE UNCAPPED count query
  // (computeRecall → readRecalledKcs), never the bounded fold (monotonic invariant).
  const recallSupersedableMountKinds = new Set<ComponentSpec['kind']>([
    'TruthTablePractice',
    'CircuitBuilder',
    'PseudocodeChallenge',
    'LessonIntro',
    'IntroExplanation',
    'WorkedExample',
    'HintCard',
    'ConfidenceCheck',
  ]);
  const recallEligible =
    !inTransferProbe &&
    (action.type === 'no_action' ||
      (action.type === 'mount' && recallSupersedableMountKinds.has(action.component.kind)));
  // The recall throttle is a read-then-insert (`computeRecall` reads the uncapped
  // recalled-KC count; the row is persisted below). Hold the per-session recall lock
  // across BOTH so two concurrent frames for the same regressed KC can't each read
  // zero prior recalls and both mount a recall (F-14 finding #3 / AC#4 under
  // concurrency). The whole decide→persist→send tail runs inside the lock.
  await withRecallLock(event.sessionId, async () => {
    let recallAction: Action | null = null;
    if (recallEligible) {
      // F-14 finding #5 — the reflex fires ONLY through the `POLYMATH_ENABLE_TEST_SEAMS`-
      // gated synthetic-L1-BKT seam, NOT on a bare `lessonId > 1` heuristic. The build
      // plan is explicit: there is NO production recall trigger until F-15 preserves a
      // *distinguishable* L1 `learner_state` in-session. Without that, `learner_state`
      // is keyed `(sessionId, kc)` with ONE row per pair and L1/L2 share KC names, so a
      // bare `lessonId > 1` trigger reads the learner's LIVE, mid-L2-updated BKT and
      // fires on ordinary low L2 BKT (normal learning) — a "your BKT is low" card
      // mislabeled "you mastered this in Lesson 1". So gate on the seam alone here;
      // F-15 supplies the real preserved-L1 trigger (a frozen snapshot it can pass in).
      const useReflex = opts.testL1Bkt !== undefined;
      if (useReflex) {
        // L1 KCs come from lesson 1's content (always loadable); the cross-lesson
        // reflex reminds the learner of a *prior*-lesson KC regardless of which L2
        // item is current. `currentItemId` is the item the learner is working.
        const l1Kcs = getLesson(1).content.knowledgeComponents;
        // `explain_back_recording_ended` is handled+returned earlier, so the only
        // item-bearing kinds reachable here are submit / request_hint / transfer_submitted.
        const currentItemId =
          event.kind === 'submit' ||
          event.kind === 'request_hint' ||
          event.kind === 'transfer_submitted'
            ? event.itemId
            : '';
        const hit = await computeRecall(
          deps.db,
          event.sessionId,
          currentItemId,
          l1Kcs,
          opts.testL1Bkt,
        );
        if (hit) {
          recallAction = {
            type: 'mount',
            component: {
              kind: 'CrossLessonRecall',
              kc: hit.kc,
              currentItemId: hit.currentItemId,
              priorBktAtRegression: hit.priorBktAtRegression,
              reminderBody: hit.reminderBody,
            },
            rationale: `cross-lesson recall: L1 KC "${hit.kc}" regressed to BKT ${hit.priorBktAtRegression.toFixed(3)} mid-L2 (server reflex, F-14)`,
          };
        }
      }
    }
    const finalAction: Action = recallAction ?? action;

    // ADR-010 Layer 3: a HintCard level-3 mount is logged as unverified_prose.
    // All other mounts go through the Layer-2 validator (layer 2); non-mounts
    // are layer 1. This is set on the pre-rejection `shaped` action so the log
    // reflects the original proposal even when it was downgraded.
    // The transfer-pass reflex replaced the proposal with a deterministic
    // server-authored ExplainBackPrompt mount; record THAT as a clean pass (it never
    // went through the LLM, so the proposal-based layer below would mislabel it). The
    // F-14 cross-lesson recall reflex is likewise a server-authored mount → clean pass.
    const reflexFired = action !== validatedAction || recallAction !== null;
    const isL3Hint =
      shaped.type === 'mount' &&
      shaped.component.kind === 'HintCard' &&
      shaped.component.level === 3;
    const validationLayer = reflexFired ? 2 : isL3Hint ? 3 : shaped.type === 'mount' ? 2 : 1;
    const validationStatus = reflexFired
      ? 'pass'
      : isL3Hint
        ? 'unverified_prose'
        : layer2.ok
          ? 'pass'
          : 'reject';

    // Visual-utility split-test (metric 3, DORMANT by default): on a `submit` to a
    // matched item, annotate which suppression arm the turn ran in. Append-only — the
    // field is absent on every non-matched turn and when the split-test env is off, so
    // it never reshapes the payload and never touches `spec.visibleReps` (the marker is
    // a metrics annotation, orthogonal to the probe-integrity boundary).
    const splitArm =
      event.kind === 'submit'
        ? circuitSuppressionArm(event.itemId, circuitSplitTestEnabled())
        : undefined;
    const persistedEvent =
      splitArm === undefined ? event : { ...event, circuitSuppressed: splitArm };

    // SECURITY (MR !8 review): the counter-metrics (dependency_check, visual_utility)
    // must fold SERVER-recomputed correctness, never the client `submit.correct` flag —
    // a scripted client could send wrong answers with `correct:true` (+ tiny
    // responseTimeMs) to manufacture a passing operator dashboard. We recompute the
    // verdict here from the canonical submission + lesson item (the same `recomputeCorrect`
    // the BKT path already trusts) and persist it as `submitVerdict`, mirroring
    // `transferVerdict`; `fetchMetricInputs` reads this, not `event.correct`.
    const submitVerdict =
      event.kind === 'submit'
        ? { correct: recomputeCorrect(lesson.content, event.itemId, event.submission) }
        : undefined;

    await deps.db.insert(events).values({
      sessionId: event.sessionId,
      kind: event.kind,
      payload: {
        event: persistedEvent,
        action: finalAction,
        ...(submitVerdict ? { submitVerdict } : {}),
        learnerSnapshot: learnerDerived.snapshot,
        // The transfer verdict (when this turn is a transfer_submitted) is recorded
        // so the replay shows pass/fail and F-09 can read the transfer-pass condition.
        ...(transferVerdict ? { transferVerdict } : {}),
        // F-12: the explain-back verdict (when this turn is explain_back_recording_ended)
        // persisted at `payload.explainBackVerdict` — the F-11→F-12 seam. `toLoggedEvent`
        // reads `.passed` on a later fold so the gate's explain-back condition clears.
        // (F-11's route will produce this verdict; F-12 reads/persists the shared slot.)
        ...(explainBackVerdict ? { explainBackVerdict } : {}),
        // F-12 AC#5: the per-turn mastery-gate evaluation, so the replay can show the
        // gate failing then passing across the session (the demo "show the gate").
        gateEvaluation: { passed: gateEvaluation.passed, blockers: gateEvaluation.blockers },
        // F-12 AC#3: the statechart-style decision on a proposed mastery transition
        // (present only on a transition→mastered turn).
        ...(statechart ?? {}),
        validation: {
          layer: validationLayer,
          status: validationStatus,
          detail: layer2.ok ? (downgraded ? 'downgraded malformed proposal' : 'ok') : layer2.detail,
        },
      },
    });

    send(ws, { kind: 'action', sessionId: event.sessionId, action: finalAction });
  });
}

export interface PolymathServer {
  httpServer: http.Server;
  wss: WebSocketServer;
  /** The server-side explain-back voice-capture registry backing the integrity seam.
   *  Exposed so the (deferred) live LiveKit bridge can `register()` a phase-scoped
   *  RealtimeSession per explain-back utterance — making a real spoken explain-back
   *  produce the server-side transcript the route reads (never the client string). */
  explainBackCaptureRegistry: ExplainBackCaptureRegistry;
  /** Drain WS connections, close the HTTP server, then resolve. Without
   *  terminating the WS clients first, `httpServer.close()` waits forever for
   *  open sockets and a SIGTERM hangs (the container never exits). */
  close(): Promise<void>;
}

/** Build the HTTP + WebSocket server. Dependencies are injected so tests can
 *  supply an in-memory/throwaway DB and a stub agent. */
export function createServer(rawDeps: ServerDeps): PolymathServer {
  // Default the explain-back judge from the key-gated `@langchain/openai` impl when
  // the caller didn't inject one (tests inject a deterministic double; production
  // never constructs it). `makeExplainBackJudge` self-gates on `OPENAI_API_KEY` and
  // returns `undefined` without a key — so a key-less deploy still fails CLOSED
  // (`judge_unavailable`), and a keyed deploy now actually RUNS the judge instead of
  // shipping it as dead code (Stage 4b was previously unreachable: index.ts never
  // called makeExplainBackJudge and createServer never defaulted it).
  const defaultedJudge = rawDeps.explainBackJudge ?? makeExplainBackJudge();

  // The server-side explain-back voice-capture registry IS the integrity seam: the
  // route reads the spoken content from here (via explainBackTranscriptFor), never
  // from the client-supplied event.transcript. Default a fresh registry and source
  // BOTH the transcript and prosody getters from it unless the caller injected its
  // own (tests inject either a registry or the getters directly). This wires the real
  // production path: a captured explain-back utterance produces a server-side
  // transcript; with nothing captured for a key, the getter returns undefined → the
  // rubric runs on an empty transcript → fails CLOSED (no learner is silently trusted
  // via the client string). Populating the registry from a live device session is the
  // deferred cross-platform smoke (explainBackRegistry.ts) — the SEAM exists + is wired.
  const captureRegistry = rawDeps.explainBackCaptureRegistry ?? new ExplainBackCaptureRegistry();
  const transcriptFor =
    rawDeps.explainBackTranscriptFor ??
    ((sessionId: string, targetItemId: string) => captureRegistry.transcriptFor(sessionId, targetItemId));
  const prosodyFor =
    rawDeps.explainBackProsodyFor ??
    ((sessionId: string, targetItemId: string) => captureRegistry.prosodyFor(sessionId, targetItemId));

  // F-16: default the baseline chat provider from the key-gated GPT-5 impl when the
  // caller didn't inject one (tests inject a deterministic stub; production never
  // constructs it). `makeOpenAiBaselineChatProvider` self-gates on `OPENAI_API_KEY`
  // and returns `undefined` without a key — so a key-less deploy's baseline write
  // routes fail CLOSED (503), and a keyed deploy actually runs GPT-5 (fairness).
  const defaultedBaselineChat = rawDeps.baselineChat ?? makeOpenAiBaselineChatProvider();

  // Operator-auth secret for the experiment-operator + replay routes (MR !7). Defaults
  // from POLYMATH_OPERATOR_SECRET; unset → fail-closed in production, open in dev/CI
  // (see `checkOperatorAuth`). A blank/whitespace env value is treated as unset.
  const envOperatorSecret = (process.env['POLYMATH_OPERATOR_SECRET'] ?? '').trim();
  const defaultedOperatorSecret = rawDeps.operatorSecret ?? (envOperatorSecret || undefined);

  const deps: ServerDeps = {
    ...rawDeps,
    ...(defaultedJudge ? { explainBackJudge: defaultedJudge } : {}),
    ...(defaultedBaselineChat ? { baselineChat: defaultedBaselineChat } : {}),
    ...(defaultedOperatorSecret ? { operatorSecret: defaultedOperatorSecret } : {}),
    explainBackCaptureRegistry: captureRegistry,
    explainBackTranscriptFor: transcriptFor,
    explainBackProsodyFor: prosodyFor,
  };

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/session') {
      // Optional F-16/F-17 linkage: a session can be created THROUGH a subject
      // (so the CSV joins automatically) and/or tagged with its `app` arm. Both
      // are additive + nullable — an unadorned `POST /api/session` (the default
      // polymath path) is unchanged.
      void readJsonBody(req)
        .catch(() => null)
        .then(async (body) => {
          const b = (body ?? {}) as { subjectId?: unknown; app?: unknown };
          const subjectId =
            typeof b.subjectId === 'string' && UUID_RE.test(b.subjectId) ? b.subjectId : undefined;
          const app = b.app === 'baseline' ? 'baseline' : undefined;
          // MR !7: when a subjectId is EXPLICITLY provided, verify the subject exists
          // before linking. `sessions.subjectId` is a soft reference (no FK by design),
          // so a typo would otherwise silently create an UNLINKED session and the
          // experiment CSV would miss its polymath_session_id until manual repair.
          // Surfacing 404 here is a caller error worth reporting; an unadorned create
          // (no subjectId) is untouched and still robust.
          if (subjectId !== undefined) {
            const subj = await deps.db
              .select({ id: experimentSubjects.id })
              .from(experimentSubjects)
              .where(eq(experimentSubjects.id, subjectId))
              .limit(1);
            if (subj.length === 0) {
              sendJson(res, 404, { error: 'unknown subjectId' });
              return undefined;
            }
          }
          const rows = await deps.db
            .insert(sessions)
            .values({
              ...(subjectId ? { subjectId } : {}),
              ...(app ? { app } : {}),
            })
            .returning({ id: sessions.id, startedAt: sessions.startedAt });
          const row = rows[0]!;
          sendJson(res, 201, { sessionId: row.id, startedAt: row.startedAt });
          return undefined;
        })
        .catch(() => sendJson(res, 500, { error: 'failed to create session' }));
      return;
    }

    if (url.pathname.startsWith('/api/experiment/')) {
      handleExperimentRoute(deps, req, res, url).catch(() =>
        sendJson(res, 500, { error: 'experiment route failed' }),
      );
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
      // The replay streams the full teaching transcript (learner submissions, gate
      // evaluations, explain-back verdict metadata) for a session UUID — operator/debug
      // data, not learner-facing. Gate it like the experiment-operator routes (MR !7
      // review): a leaked sessionId must not expose the transcript on the public port.
      const denied = checkOperatorAuth(req, deps.operatorSecret);
      if (denied) {
        sendJson(res, denied.status, denied.body);
        return;
      }
      const sessionId = replayMatch[1]!;
      // Chronological order is load-bearing for AC#5 (the replay must "show the gate
      // failing then passing"): a default `select` returns rows in arbitrary order, so
      // a consumer reading the latest turn's gate (`.at(-1)`) could pick the wrong turn.
      // Order by the insert timestamp (turns are sequential WS round-trips).
      deps.db
        .select()
        .from(events)
        .where(eq(events.sessionId, sessionId))
        .orderBy(events.ts)
        .then((rows) => sendJson(res, 200, { sessionId, events: rows }))
        .catch(() => sendJson(res, 500, { error: 'failed to load replay' }));
      return;
    }

    // GET /api/session/:id/report — the end-of-session summary (`SessionSummary`).
    // Operator/teaching data keyed by a session UUID, so gate it exactly like
    // /replay (MR !7 review: a leaked sessionId must not expose the report on the
    // public port). 404 for an unknown session.
    const reportMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/report$/);
    if (req.method === 'GET' && reportMatch) {
      const denied = checkOperatorAuth(req, deps.operatorSecret);
      if (denied) {
        sendJson(res, denied.status, denied.body);
        return;
      }
      const sessionId = reportMatch[1]!;
      buildReport(deps.db, sessionId)
        .then((summary) =>
          summary === null
            ? sendJson(res, 404, { error: 'unknown session' })
            : sendJson(res, 200, summary),
        )
        .catch(() => sendJson(res, 500, { error: 'failed to build report' }));
      return;
    }

    // GET /api/metrics — the operator metrics dashboard payload (`MetricsPayload`).
    // Aggregate research data, so gated identically to /replay (operator auth; 401
    // on a bad secret, 503 when the secret is unset in production).
    if (req.method === 'GET' && url.pathname === '/api/metrics') {
      const denied = checkOperatorAuth(req, deps.operatorSecret);
      if (denied) {
        sendJson(res, denied.status, denied.body);
        return;
      }
      buildMetricsPayload(deps.db)
        .then((payload) => sendJson(res, 200, payload))
        .catch(() => sendJson(res, 500, { error: 'failed to build metrics' }));
      return;
    }

    // GET /api/session/:id/observability/ui-churn — the UI-churn counter-metric
    // (mounts/min during a session). Aggregate research/teaching data keyed by a session
    // UUID, so gated identically to /replay (operator auth; 401 on a bad secret, 503 when
    // unset in production). The fold scopes `app IS NULL` (D3) like every integrity read.
    const churnMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/observability\/ui-churn$/);
    if (req.method === 'GET' && churnMatch) {
      const denied = checkOperatorAuth(req, deps.operatorSecret);
      if (denied) {
        sendJson(res, denied.status, denied.body);
        return;
      }
      const sessionId = churnMatch[1]!;
      // A malformed (non-UUID) id is a 400 client error, not a 500 — match the
      // contract's SessionId shape before touching the DB.
      if (!SessionId.safeParse(sessionId).success) {
        sendJson(res, 400, { error: 'invalid session id' });
        return;
      }
      deps.db
        .select({ kind: events.kind, ts: events.ts, app: events.app, payload: events.payload })
        .from(events)
        .where(and(eq(events.sessionId, sessionId), isNull(events.app)))
        .orderBy(events.ts)
        .then((rows) => sendJson(res, 200, computeUiChurn(sessionId, rows)))
        .catch(() => sendJson(res, 500, { error: 'failed to compute ui churn' }));
      return;
    }

    // ADR-012 stretch: the tutor-handoff routes. `GET /api/session/:id/handoff` (owner;
    // builds + returns the artifact, surfaces an EXISTING share URL but never mints),
    // `POST /api/session/:id/handoff/share` (explicitly mint-or-fetch the share token —
    // creating a durable public link is an action, not a read side effect; MR !9), and
    // `GET /api/session/:id/handoff/:token` (a shared link authenticated by the random
    // per-session token, NOT the session UUID). NO operator auth — the per-request
    // random token is the access control (the followup-route exemption pattern); the
    // artifact is the learner's own, intentionally shareable. The session read is scoped
    // to Polymath rows (`sessions.app IS NULL`) inside the builder. The route helper
    // enforces the per-shape method (405 otherwise), so dispatch on GET OR POST.
    if (
      (req.method === 'GET' || req.method === 'POST') &&
      /^\/api\/session\/[^/]+\/handoff(\/[^/]+)?$/.test(url.pathname)
    ) {
      tryHandleHandoffRoute({ db: deps.db }, req.method, url.pathname)
        .then((r) => {
          if (r === null) sendJson(res, 404, { error: 'not found' });
          else sendJson(res, r.status, r.body);
        })
        .catch(() => sendJson(res, 500, { error: 'failed to build handoff' }));
      return;
    }

    // Teacher report: operator-auth gated (a session's per-KC mastery snapshot for
    // the teacher / VT4S surface). Follows the replay-route auth pattern (MR !7):
    // a leaked sessionId must not expose teaching data on the public port. Returns
    // the `TeacherReportPayload` JSON or 404 if the session does not exist.
    const teacherReportMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/teacher-report$/);
    if (req.method === 'GET' && teacherReportMatch) {
      const denied = checkOperatorAuth(req, deps.operatorSecret);
      if (denied) {
        sendJson(res, denied.status, denied.body);
        return;
      }
      const sessionId = teacherReportMatch[1]!;
      buildTeacherReport(deps.db, sessionId)
        .then((report) => {
          if (report === null) {
            sendJson(res, 404, { error: 'session not found' });
          } else {
            sendJson(res, 200, report);
          }
        })
        .catch(() => sendJson(res, 500, { error: 'failed to build teacher report' }));
      return;
    }

    // F-16 baseline routes (purely additive; topology D2). Returns true once it
    // has matched + responded; falls through to 404 otherwise.
    if (
      tryHandleBaselineRoute(
        {
          db: deps.db,
          ...(deps.baselineChat ? { chat: deps.baselineChat } : {}),
        },
        req,
        res,
        url,
      )
    ) {
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
  wss.on('connection', (ws, req) => {
    // F-12 AC#3 dev seam: a `?testForce=mastered` on the WS upgrade URL injects a
    // forced mastery-transition proposal so the earned-it refusal is demoable. Gated
    // behind NODE_ENV!=='production' (fail-closed on the seam itself) — inert in prod,
    // and even in dev the earned-it gate still rejects it when the predicate fails.
    const reqUrl = new URL(req.url ?? '/agent', 'http://localhost');
    // CLUSTER D thread 6: the synthetic test seams (`?testForce=mastered`,
    // `?testExplainBackVerdict=…`) require an EXPLICIT opt-in env (default OFF) AND
    // must stay off in production. `NODE_ENV!=='production'` alone is risky — staging /
    // preview / an unset NODE_ENV would silently enable them. The integration test
    // harness sets `POLYMATH_ENABLE_TEST_SEAMS=true`; a real deploy never does, so the
    // seams are inert everywhere except an explicitly-opted-in non-prod environment.
    const devSeams =
      process.env['NODE_ENV'] !== 'production' && process.env['POLYMATH_ENABLE_TEST_SEAMS'] === 'true';
    const testForceMastered = devSeams && reqUrl.searchParams.get('testForce') === 'mastered';
    // F-12 dev seam: `?testExplainBackVerdict=pass|fail` synthesizes the explain-back
    // turn's verdict so the full mastery path is drivable before F-11's judge lands.
    // Inert in production (devSeams gate); an unrecognised value yields no verdict
    // (fail-closed). A `fail` verdict carries `judge_unavailable` (the F-11 fail-closed
    // reason) so the demo can show an explicit explain-back block too.
    const ebSeam = devSeams ? reqUrl.searchParams.get('testExplainBackVerdict') : null;
    const testExplainBackVerdict: ExplainBackVerdict | undefined =
      ebSeam === 'pass'
        ? { passed: true, reasons: [] }
        : ebSeam === 'fail'
          ? { passed: false, reasons: ['judge_unavailable'] }
          : undefined;
    // F-13 AC#8 dev seam: `?lesson=2` on the WS upgrade URL lets a `session_start`
    // bind the session to L2 even though F-15's earned L1→L2 advance hasn't landed.
    // Same explicit-opt-in gate as the other seams (default OFF, inert in prod): a
    // forged `session_start.lessonId` can't skip L1 in production (it's clamped to 1
    // in the frame handler for BOTH the durable write AND the turn-1 fold —
    // `lessonIdForEvent` reads the clamped binding, never the raw frame). The web
    // client sets it from its own `?lesson` param.
    const allowLessonOverride = devSeams && reqUrl.searchParams.get('lesson') !== null;
    // F-14 dev seam: `?testL1Bkt=NOT:0.72,AND:0.5` injects a synthetic prior-lesson
    // KC → BKT map so the cross-lesson recall reflex is drivable standalone (no real
    // L1 `learner_state` exists in an L2 session until F-15). Gated (devSeams) — inert
    // in production. A malformed pair is skipped (degrade, never crash); empty → no map
    // → the real `learner_state` read is used instead.
    const testL1Bkt = devSeams ? parseTestL1Bkt(reqUrl.searchParams.get('testL1Bkt')) : undefined;
    // Privacy posture (ADR-012, AC#9): the END of a session is detected SERVER-SIDE
    // from the WS close, not a client beacon (`beforeunload`/`sendBeacon` is unreliable
    // and the web client doesn't emit `session_end`). We track the session this socket
    // is bound to (from its frames' sessionId) so on close we can schedule its data for
    // deletion after the configurable grace. Fail-closed: a session that ends is always
    // scheduled; scheduling is `app IS NULL`-scoped so only Polymath sessions are touched.
    // SECURITY (MR !8 review): bind this socket to a session ONLY via a `session_start`
    // frame on THIS connection — never from an arbitrary frame's `sessionId`. The old
    // "last sessionId seen on any frame wins" let anyone who knows a victim's session
    // UUID open a socket, send one frame naming it, disconnect, and stamp the victim's
    // data for hard-deletion after the grace window (a destructive DoS with no creds) —
    // and it mis-fired the deletion timer on a stray frame. A connection establishes its
    // session by opening with `session_start` (the web client's first frame); only that
    // binds. Once bound, it never rebinds to a different id on the same socket (a forged
    // cross-session `session_start` mid-connection can't steal the binding). This mirrors
    // the repo invariant: a route/action keyed by a UUID needs binding, not trust.
    let boundSessionId: string | null = null;
    const noteSessionId = (raw: string): void => {
      if (boundSessionId !== null) return; // bind once, on the first session_start
      try {
        const parsed = JSON.parse(raw) as { kind?: unknown; sessionId?: unknown };
        if (
          parsed.kind === 'session_start' &&
          typeof parsed.sessionId === 'string' &&
          parsed.sessionId.length > 0
        ) {
          boundSessionId = parsed.sessionId;
        }
      } catch {
        /* not JSON / not a session_start — ignore; the frame handler reports its own error */
      }
    };
    ws.on('close', () => {
      if (!boundSessionId) return;
      // Non-fatal: a deletion-scheduling failure must never crash the process on a
      // socket close. The boot/interval sweep is the backstop.
      void scheduleSessionDeletion(deps.db, boundSessionId).catch((err) => {
        console.error('failed to schedule session-data deletion on WS close', err);
      });
    });
    ws.on('message', (data) => {
      noteSessionId(data.toString());
      // The frame handler must never reject unhandled — an unawaited rejection
      // (e.g. a DB error on a bad sessionId) would crash the process.
      handleClientFrame(deps, ws, data.toString(), {
        testForceMastered,
        testExplainBackVerdict,
        allowLessonOverride,
        testL1Bkt,
      }).catch((err) => {
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

  return { httpServer, wss, explainBackCaptureRegistry: captureRegistry, close };
}

/** Session-id helper used by the REST layer's callers/tests. */
export function newSessionId(): string {
  return randomUUID();
}
