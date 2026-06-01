import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  scoreEquivalence,
  playgroundEquivalence,
  truthTable,
  parse,
  variables,
  MAX_EQUIVALENCE_VARS,
} from '@polymath/booleans';
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
import { compileMove, type TacticalMove } from './agent/menu.js';
import { defaultItemPrompt, explanationBeforeNextItem } from './agent/introAdvance.js';
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
import { LearnerUtteranceRegistry } from './voice/learnerUtteranceRegistry.js';
import { tryHandleBaselineRoute } from './baseline/route.js';
import { tryHandleHandoffRoute } from './handoff/route.js';
import type { BaselineChatProvider } from './baseline/chatProvider.js';
import { makeOpenAiBaselineChatProvider } from './baseline/openaiChatProvider.js';
import { buildTeacherReport } from './report/teacherReport.js';
import { loadMisconceptions } from './hints/misconceptions.js';

export interface ServerDeps {
  db: Db;
  agent: AgentClient;
  /** Human/debug-visible provider selected at boot (`openai`, `heuristic`, or test-injected). */
  agentProviderName?: string;
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
  /**
   * F-30 (ADR-016): the general-utterance registry backing `latestLearnerUtteranceFor`.
   * This IS the integrity seam: the `spoken_turn` handler reads from here, NEVER from
   * the client frame. When not injected, `createServer` defaults a fresh registry and
   * exposes it as `server.learnerUtteranceRegistry`.
   *
   * NOTE (MR !11 review — do not overclaim): the registry is *designed to be filled*
   * by a server-side `VoiceBridge.onLearnerUtterance` callback, but — exactly like the
   * sibling `explainBackCaptureRegistry` — that bridge is NOT constructed in production
   * yet. `handleRealtimeSession` only mints a LiveKit token; connecting a server-side
   * VoiceBridge to the LiveKit room (so a real spoken utterance reaches this registry)
   * is the DEFERRED cross-platform voice-capture smoke (docs/voice-cross-platform-smoke.md),
   * pending a human tester with real devices + keys. Until then the registry stays empty
   * in production and every `spoken_turn` fails closed to an ack — the gate is built and
   * airtight, but the legitimate fill path is deferred together with explain-back's.
   * Tests inject either the registry (to prime it) or the getter directly.
   */
  learnerUtteranceRegistry?: LearnerUtteranceRegistry;
  /**
   * F-30: server-captured utterance getter for the `spoken_turn` handler. Mirrors
   * `explainBackTranscriptFor` (same integrity pattern). When not injected, `createServer`
   * defaults to `learnerUtteranceRegistry.latestFor(sessionId)`. A missing capture →
   * undefined → the spoken-turn handler acks without answering (fail closed).
   */
  latestLearnerUtteranceFor?: (sessionId: string) => string | undefined;
  /**
   * F-30: the CONSUMING read of the server-captured utterance — read-and-clear, so a
   * captured utterance answers exactly one `spoken_turn` (no replay). The production
   * handler prefers this over `latestLearnerUtteranceFor`. When not injected,
   * `createServer` defaults to `learnerUtteranceRegistry.takeLatest(sessionId)`. (MR !11.)
   */
  takeLearnerUtteranceFor?: (sessionId: string) => string | undefined;
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
    event?: {
      itemId?: string;
      submission?: string;
      correct?: boolean;
      responseTimeMs?: number;
      targetItemId?: string;
      repSubmission?: Extract<ClientEvent, { kind: 'submit' }>['repSubmission'];
    };
    transferVerdict?: { correct?: boolean };
    // F-12 extends the projection to read `topicClassification` for the
    // topic-guardrail counter (was type + component.kind only). The integrity
    // hardening (rep-gating) additionally reads the mounted component's target
    // expression so the fold can derive a SERVER-TRUSTED rep per item — never the
    // client's `repSubmission.rep`.
    action?: {
      type?: string;
      component?: { kind?: string; expression?: string; targetExpression?: string };
      topicClassification?: string;
    };
    // F-11 writes / F-12 reads F-11's persisted verdict slot (write-full /
    // read-narrow split, mirroring `transferVerdict`). Absent → undefined →
    // fail-closed (no pass).
    explainBackVerdict?: { passed?: boolean };
  };
  // INTEGRITY HARDENING (rep-gating): map the SERVER-mounted practice component to its
  // rep. This is the rep the server actually presented for the item — the trusted
  // signal the rep-gating fold credits, NOT the client-declared `repSubmission.rep`.
  // Only the three item-bearing practice mounts carry a rep; everything else → undefined.
  const mountedComponent = p.action?.type === 'mount' ? p.action.component : undefined;
  const mountedRep: 'truth_table' | 'circuit' | 'pseudocode' | undefined =
    mountedComponent?.kind === 'TruthTablePractice'
      ? 'truth_table'
      : mountedComponent?.kind === 'CircuitBuilder'
        ? 'circuit'
        : mountedComponent?.kind === 'PseudocodeChallenge'
          ? 'pseudocode'
          : undefined;
  // The target expression of the mounted practice item (so the fold can bind the
  // trusted rep to the item the learner later submits against).
  const mountedItemExpression =
    mountedComponent?.kind === 'TruthTablePractice'
      ? mountedComponent.expression
      : mountedComponent?.kind === 'CircuitBuilder' || mountedComponent?.kind === 'PseudocodeChallenge'
        ? mountedComponent.targetExpression
        : undefined;
  return {
    kind,
    // An explain-back event names its item via `targetItemId` (not `itemId`).
    itemId: p.event?.itemId ?? p.event?.targetItemId ?? p.event?.submission,
    submission: p.event?.submission,
    repSubmission: p.event?.repSubmission,
    responseTimeMs: p.event?.responseTimeMs,
    transferCorrect: p.transferVerdict?.correct,
    mountedRep,
    mountedItemExpression,
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
  passedItemIds: Set<string>;
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
    // The POST-current-event fold (`derived`), so a correct submit THIS turn already
    // marks its item passed — the B7 forward-progress fallback then advances past it.
    passedItemIds: derived.passedItemIds,
    currentSubmitCorrect:
      current.kind === 'submit'
        ? recomputeCorrect(lesson.content, current.itemId, current.submission, current.repSubmission)
        : undefined,
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
        action?: {
          type?: string;
          rationale?: string;
          component?: {
            kind?: string;
            topic?: string;
            expression?: string;
            targetExpression?: string;
          };
        };
        event?: { itemId?: string; submission?: string; correct?: boolean };
      };
      return {
        eventKind: r.kind,
        actionType: p.action?.type ?? 'unknown',
        rationale: p.action?.rationale ?? '',
        componentKind: p.action?.component?.kind,
        topic: p.action?.component?.topic,
        expression: p.action?.component?.expression ?? p.action?.component?.targetExpression,
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

/** Server-side recompute of the correct truth table for an arbitrary learner-attempted
 *  expression (R2-2). The server NEVER trusts a client-supplied answer key — the wrong-submit
 *  retry must carry a `claimedTruthTable` the Layer-2 gate (validateLayer2) will accept, so we
 *  recompute it here from the expression via @polymath/booleans. Honors the distinct-variable
 *  cap (the booleans grammar permits 26 vars → 2^26 enumeration blocks the event loop;
 *  CLAUDE.md invariant). Over-cap or unparseable → null (skip), NEVER an enumeration. */
function recomputeTruthTableForExpression(expression: string): (0 | 1)[] | null {
  try {
    if (variables(parse(expression)).length > MAX_EQUIVALENCE_VARS) return null;
    return truthTable(expression).out.map((b) => (b ? 1 : 0));
  } catch {
    return null;
  }
}

/** Build a rep-aware, editable practice/retry mount for an arbitrary expression + recomputed
 *  truth table. Shared by the authored and NON-AUTHORED (LLM-generated continued-practice)
 *  wrong-submit remediation paths (R2-2) so both yield an editable retry, never `no_action`.
 *  `visibleReps` always includes the item's own rep so the surface renders (the
 *  `repairVisibleReps` chokepoint in validateAction.ts also enforces this; we set it correctly
 *  regardless). This mount still flows through validateOutboundAction + Layer-2 + the earned-it
 *  gate at the call site — it is never privileged (no MasteryCelebration/TransferProbe/ExplainBack). */
function retryMountForExpression(
  lesson: Lesson,
  expression: string,
  truthTableOut: (0 | 1)[],
  rep: 'truth_table' | 'circuit' | 'pseudocode',
  prompt: string,
  rationale: string,
): Action {
  const visibleReps = [rep];
  switch (rep) {
    case 'truth_table':
      return {
        type: 'mount',
        component: {
          kind: 'TruthTablePractice',
          expression,
          claimedTruthTable: truthTableOut,
          visibleReps,
          prompt,
        },
        rationale,
      };
    case 'circuit':
      return {
        type: 'mount',
        component: {
          kind: 'CircuitBuilder',
          targetExpression: expression,
          claimedTruthTable: truthTableOut,
          allowedGates: lesson.content.lessonId === 3 ? ['NAND'] : ['AND', 'OR', 'NOT'],
          visibleReps,
          prompt,
        },
        rationale,
      };
    case 'pseudocode':
      return {
        type: 'mount',
        component: {
          kind: 'PseudocodeChallenge',
          targetExpression: expression,
          claimedTruthTable: truthTableOut,
          visibleReps,
          prompt,
        },
        rationale,
      };
  }
}

export function wrongSubmitRemediationAction(
  event: ClientEvent,
  lesson: Lesson,
  priorMissesByItem: Record<string, number>,
  proposedAction?: Action,
): Action | null {
  if (event.kind !== 'submit') return null;
  const submittedRep = event.repSubmission?.rep ?? 'truth_table';
  const attempt = (priorMissesByItem[event.itemId] ?? 0) + 1;
  const llmExplanation = remediationTextFromAction(proposedAction);
  // B11: the default retry guidance must match the REP the learner is using. The
  // truth-table wording ("work row by row… mark 1 only for those rows") is nonsense
  // under a pseudocode editor or a circuit canvas, where there are no rows to mark.
  const repGuidance: Record<RepKind, string> = {
    truth_table:
      'work row by row, ask what would make the expression true, then mark 1 only for those rows.',
    circuit:
      'rebuild the circuit gate by gate, tracing how each input flows through to the output.',
    pseudocode:
      'rewrite the expression step by step, checking it matches the operator rule for every input.',
  };

  const item = lesson.content.items.find(
    (candidate) => candidate.itemId === event.itemId || candidate.targetExpression === event.itemId,
  );

  // #4: an L3 NAND-construction retry stays in the circuit rep (can't be assessed in
  // a truth table); every other item retries in the rep the learner submitted in.
  const rep: RepKind = item ? forceCircuitNandRep(lesson, item, submittedRep) : submittedRep;

  if (item) {
    // Authored item: use the item's own (validator-checked) truthTable.
    const prompt =
      llmExplanation ??
      `Try ${item.targetExpression} again. Attempt ${attempt.toString()}: ${repGuidance[rep]}`;
    const rationale = llmExplanation
      ? `incorrect submit for "${event.itemId}"; converting agent explanation into editable retry mount (server reflex)`
      : `incorrect submit for "${event.itemId}" produced no usable agent remediation; remounting same item (server reflex)`;
    return retryMountForExpression(lesson, item.targetExpression, item.truthTable, rep, prompt, rationale);
  }

  // R2-2 (CRITICAL dead-end class): the submitted item is NOT one of the lesson's authored
  // `content.items` — it is an LLM-GENERATED continued-practice item (e.g. "A & B" minted by
  // the agent past the authored ladder). The old lookup returned null here, so a WRONG submit
  // produced `no_action` and the workspace stayed LOCKED on the disabled item — the learner
  // was STRANDED with no retry. Instead, re-mount the SAME expression the learner just
  // attempted, using only data carried on the submit frame: the expression is `event.itemId`
  // (the client sets currentItemId = spec.expression; `event.submission` echoes it as the
  // canonical string). We RECOMPUTE the correct truth table server-side (never trust a client
  // answer key) so the retry has a Layer-2-valid `claimedTruthTable`. Over-cap/unparseable
  // expression → null (no editable retry possible) → fall through to the forward-progress net.
  const expression = (event.itemId || event.submission || '').trim();
  if (expression.length === 0) return null;
  const recomputed = recomputeTruthTableForExpression(expression);
  if (!recomputed) return null;
  const prompt =
    llmExplanation ?? `Try ${expression} again. Attempt ${attempt.toString()}: ${repGuidance[rep]}`;
  const rationale = llmExplanation
    ? `incorrect submit for non-authored item "${event.itemId}"; converting agent explanation into editable retry mount with server-recomputed truth table (server reflex, R2-2)`
    : `incorrect submit for non-authored item "${event.itemId}" produced no usable agent remediation; remounting same expression with server-recomputed truth table (server reflex, R2-2)`;
  return retryMountForExpression(lesson, expression, recomputed, rep, prompt, rationale);
}

function remediationTextFromAction(action: Action | undefined): string | null {
  if (!action) return null;
  if (action.type === 'mount') {
    const component = action.component;
    if (component.kind === 'HintCard') return component.body.trim() || null;
    if (component.kind === 'WorkedExample') {
      const steps = component.steps
        .map((step) => `${step.label}: ${step.detail}`)
        .join(' ');
      return steps.trim().length > 0
        ? `Review this idea, then try again. ${steps}`
        : null;
    }
    if (
      (component.kind === 'TruthTablePractice' ||
        component.kind === 'CircuitBuilder' ||
        component.kind === 'PseudocodeChallenge') &&
      component.prompt
    ) {
      return component.prompt.trim() || null;
    }
  }
  if (action.type === 'answer_question') return action.answer.trim() || null;
  return null;
}

function isEditablePracticeMount(action: Action): boolean {
  return (
    action.type === 'mount' &&
    (action.component.kind === 'TruthTablePractice' ||
      action.component.kind === 'CircuitBuilder' ||
      action.component.kind === 'PseudocodeChallenge')
  );
}

function practiceTargetExpression(action: Action): string | null {
  if (action.type !== 'mount') return null;
  const component = action.component;
  if (component.kind === 'TruthTablePractice') return component.expression;
  if (component.kind === 'CircuitBuilder' || component.kind === 'PseudocodeChallenge') {
    return component.targetExpression;
  }
  return null;
}

function matchesSubmittedAuthoredItem(action: Action, event: ClientEvent, lesson: Lesson): boolean {
  if (event.kind !== 'submit') return false;
  const item = lesson.content.items.find(
    (candidate) => candidate.itemId === event.itemId || candidate.targetExpression === event.itemId,
  );
  if (!item) return false;
  if (practiceTargetExpression(action) !== item.targetExpression) return false;

  const rep = event.repSubmission?.rep ?? 'truth_table';
  if (action.type !== 'mount') return false;
  const component = action.component;
  switch (rep) {
    case 'truth_table':
      return component.kind === 'TruthTablePractice' && component.visibleReps.includes('truth_table');
    case 'circuit':
      return component.kind === 'CircuitBuilder' && component.visibleReps.includes('circuit');
    case 'pseudocode':
      return component.kind === 'PseudocodeChallenge' && component.visibleReps.includes('pseudocode');
  }
}

function authoredLessonPlanAction(input: AgentInput): Action | null {
  const requiredExplanation = explanationBeforeNextItem(input);
  if (!requiredExplanation) return null;
  return validateOutboundAction(compileMove(requiredExplanation)).action;
}

function firstPracticeItemPerKc(lesson: Lesson): Lesson['content']['items'] {
  const seen = new Set<string>();
  const items: Lesson['content']['items'] = [];
  for (const item of lesson.content.items) {
    if (seen.has(item.kc)) continue;
    seen.add(item.kc);
    items.push(item);
  }
  return items;
}

function authoredPracticeAction(
  lesson: Lesson,
  item: Lesson['content']['items'][number],
  rationale: string,
  rep: 'truth_table' | 'circuit' | 'pseudocode' = 'truth_table',
): Action {
  const prompt = defaultItemPrompt(item.targetExpression, rep);
  switch (rep) {
    case 'truth_table':
      return {
        type: 'mount',
        component: {
          kind: 'TruthTablePractice',
          expression: item.targetExpression,
          claimedTruthTable: item.truthTable,
          visibleReps: ['truth_table'],
          prompt,
        },
        rationale,
      };
    case 'circuit':
      return {
        type: 'mount',
        component: {
          kind: 'CircuitBuilder',
          targetExpression: item.targetExpression,
          claimedTruthTable: item.truthTable,
          allowedGates: lesson.content.lessonId === 3 ? ['NAND'] : ['AND', 'OR', 'NOT'],
          visibleReps: ['circuit'],
          prompt,
        },
        rationale,
      };
    case 'pseudocode':
      return {
        type: 'mount',
        component: {
          kind: 'PseudocodeChallenge',
          targetExpression: item.targetExpression,
          claimedTruthTable: item.truthTable,
          visibleReps: ['pseudocode'],
          prompt,
        },
        rationale,
      };
  }
}

/** Render a single concrete truth-table row of `expression` as a worked L2 hint
 *  fragment — e.g. "When A=1, B=1, the output is 1". Picks the FIRST row whose
 *  output is 1 (the discriminating case for most operators); falls back to row 0
 *  when the expression is constant-false. Honors the distinct-variable cap (DoS
 *  guard, CLAUDE.md invariant): an over-cap or unparseable expression returns null
 *  and the caller degrades to the generic L2 wording. */
function concreteRowHint(expression: string): string | null {
  try {
    if (variables(parse(expression)).length > MAX_EQUIVALENCE_VARS) return null;
    const tt = truthTable(expression);
    if (tt.vars.length === 0) return null;
    const rowIdx = tt.out.findIndex((v) => v) >= 0 ? tt.out.findIndex((v) => v) : 0;
    const assignment = tt.vars
      .map((v, i) => `${v}=${tt.rows[rowIdx]![i] ? 1 : 0}`)
      .join(', ');
    const out = tt.out[rowIdx] ? 1 : 0;
    return `Work one row: when ${assignment}, the output of ${expression} is ${out}. Verify that row against the operator rule, then do the next.`;
  } catch {
    return null;
  }
}

/** A near-complete (faded) L3 scaffold for the truth table: state how many rows are
 *  1 and ask the learner to place the LAST one — a completion problem (Sweller's
 *  faded worked example). Over-cap/unparseable → null (caller degrades). */
function completionScaffoldHint(expression: string): string | null {
  try {
    if (variables(parse(expression)).length > MAX_EQUIVALENCE_VARS) return null;
    const tt = truthTable(expression);
    const ones = tt.out.filter((v) => v).length;
    return (
      `Almost there — the full table for ${expression} has ${ones.toString()} row(s) that output 1 ` +
      `and ${(tt.out.length - ones).toString()} that output 0. Fill in every row you are sure of, ` +
      `then place the single remaining row by applying the operator rule one last time.`
    );
  } catch {
    return null;
  }
}

/**
 * #7 GENUINE HINT FADING (ADR-010 Layer 3). A real fade, not three paraphrases:
 *   - L1 = a strategy CUE (rep-aware: rows for truth_table, gates for circuit,
 *     step-by-step for pseudocode). Light-touch direction, no answer content.
 *   - L2 = work ONE concrete row/partial of THIS expression, computed correctly
 *     server-side via @polymath/booleans (var-capped). If a misconception entry
 *     exists for the item (`lessons/<id>/misconceptions.json`, matched by itemId),
 *     route L2 to that misconception's specific `hintBody` — the targeted nudge for
 *     the most common error — instead of the generic concrete-row text.
 *   - L3 = a near-complete completion-problem scaffold (reveal the answer SHAPE and
 *     leave the learner the last step) — the classic faded worked example.
 *
 * Rep-aware where it matters: the "row" language is only used for truth_table; the
 * circuit/pseudocode variants give an analogous concrete partial. The hint LEVEL is
 * server-derived from `hintsByItem` (the full session), never a capped window.
 */
export function authoredHintAction(input: AgentInput, item: Lesson['content']['items'][number]): Action {
  const event = input.event;
  const itemId = event.kind === 'request_hint' ? event.itemId : item.itemId;
  const priorHints = input.hintsByItem?.[itemId] ?? 0;
  const level = Math.min(priorHints + 1, 3) as 1 | 2 | 3;

  // The rep the learner is working THIS item in: derived from the most-recent
  // practice mount in the bounded history (request_hint carries no rep), forced to
  // circuit for the L3 NAND-construction items (#4).
  const activeRep = forceCircuitNandRep(
    input.lesson,
    item,
    lastPracticeMount(input)?.rep ?? 'truth_table',
  );

  let body: string;
  if (level === 1) {
    // L1 strategy cue, rep-aware.
    body =
      activeRep === 'circuit'
        ? `Start at the output gate of ${item.targetExpression} and trace backward: which gate must produce the final value, and what inputs does it need?`
        : activeRep === 'pseudocode'
          ? `Write ${item.targetExpression} step by step: name each sub-result, then combine them with the operator. Check it against one input row.`
          : `Work row by row for ${item.targetExpression}. Ask what would make the expression output 1, then mark only those rows.`;
  } else if (level === 2) {
    // L2: route to the item's named misconception if one exists; else a concrete
    // worked row/partial computed server-side.
    const misconception = loadMisconceptions(input.lesson.content.lessonId).items.find(
      (m) => m.itemId === item.itemId,
    );
    if (misconception) {
      body = misconception.hintBody;
    } else if (activeRep === 'circuit') {
      body = `For ${item.targetExpression}, build ONE branch first: wire the gate nearest an input and confirm its output for a single input combination before adding the rest.`;
    } else if (activeRep === 'pseudocode') {
      body = `For ${item.targetExpression}, write just the FIRST sub-expression as a line of code and evaluate it for one set of inputs; then add the next operator.`;
    } else {
      body =
        concreteRowHint(item.targetExpression) ??
        `For ${item.targetExpression}, compare each row to the operator rule before touching the Output column. Leave rows that do not satisfy the rule as 0.`;
    }
  } else {
    // L3: a near-complete completion-problem scaffold.
    if (activeRep === 'circuit') {
      body = `You're one step from the full circuit for ${item.targetExpression}. Place every gate you're confident in, then add the SINGLE remaining gate by asking which connective still needs to be represented.`;
    } else if (activeRep === 'pseudocode') {
      body = `You're nearly done: write out all of ${item.targetExpression} except the final operator, then add that last line by reading the expression left to right.`;
    } else {
      body =
        completionScaffoldHint(item.targetExpression) ??
        `Reset the table mentally: read the inputs across each row, apply ${item.kc}, and write the output. If a row fails the rule for ${item.kc}, its output is 0.`;
    }
  }

  return {
    type: 'mount',
    component: { kind: 'HintCard', level, body },
    rationale: `authored lesson sequence — faded hint L${level.toString()} for "${item.itemId}" (rep=${activeRep})`,
  };
}

export function deterministicAuthoredPhaseAction(input: AgentInput): Action | null {
  const event = input.event;
  if (event.kind !== 'session_start' && event.kind !== 'submit' && event.kind !== 'request_hint') return null;

  const controlledItems = firstPracticeItemPerKc(input.lesson);
  if (event.kind === 'session_start') {
    if (!event.startRep) return null;
    const first = controlledItems[0];
    if (!first) return null;
    // #4: the L3 NAND-construction first item is forced to circuit even if the
    // learner requested a different start rep.
    const startRep = forceCircuitNandRep(input.lesson, first, event.startRep);
    return authoredPracticeAction(
      input.lesson,
      first,
      `representation shortcut — starting lesson ${input.lesson.content.lessonId} in ${startRep}`,
      startRep,
    );
  }

  if (event.kind === 'request_hint') {
    const item = controlledItems.find(
      (candidate) => candidate.itemId === event.itemId || candidate.targetExpression === event.itemId,
    );
    return item ? authoredHintAction(input, item) : null;
  }

  const idx = controlledItems.findIndex(
    (item) => item.itemId === event.itemId || item.targetExpression === event.itemId,
  );
  // #1/#3 INTEGRATION: a correct submit on an item that is NOT a first-per-KC item
  // (L1's l1-review-mix, or a re-mounted ladder item) is the CONTINUED-PRACTICE / ladder
  // phase. The per-KC walk has nothing to advance to here, so OWN it with the
  // deterministic INTERLEAVED forward-progress ladder (which rotates reps and prefers the
  // next not-yet-passed authored item — always lesson-correct) rather than returning null
  // and letting the rep-blind stub mount everything in one rep, which would make the new
  // ≥2-rep gate (#1) unreachable. Fail-closed: forward-progress returns null when the
  // gate is already satisfied (a privileged path owns the turn).
  if (idx < 0) {
    if (event.kind === 'submit' && input.currentSubmitCorrect === false) {
      return wrongSubmitRemediationAction(event, input.lesson, input.priorMissesByItem ?? {});
    }
    if (event.kind === 'submit' && input.currentSubmitCorrect === true) {
      return forwardProgressFallbackAction(input, input.learnerState.ruleGatePassed);
    }
    return null;
  }

  if (input.currentSubmitCorrect === false) {
    return wrongSubmitRemediationAction(event, input.lesson, input.priorMissesByItem ?? {});
  }
  if (input.currentSubmitCorrect !== true) return null;

  const next = controlledItems[idx + 1];
  // Per-KC walk exhausted (last first-KC item answered correctly): hand off to the
  // INTERLEAVED forward-progress ladder so continued practice rotates reps on the
  // trusted deterministic path (#3), instead of the rep-blind stub.
  if (!next) return forwardProgressFallbackAction(input, input.learnerState.ruleGatePassed);

  // REP-PRESERVATION (R2-3): the learner picked a representation (?rep=circuit /
  // ?rep=pseudocode, "Skip to code", …) and is answering THIS item in it — read
  // it back off the submit's `repSubmission`. Thread it into the NEXT item's
  // mount so the authored per-KC walk stays in the learner's rep instead of
  // silently snapping every subsequent item to the `authoredPracticeAction`
  // default of `truth_table`. (The just-in-time explanation below is rep-neutral
  // — a concept card — and `practiceAfterLatestExplanation` independently
  // re-derives the active rep from `recentHistory` for the item it follows.)
  // #4: force the L3 NAND-construction items into the circuit rep regardless of the
  // learner's preserved rep (a NAND build can't be assessed in a truth table).
  const rep = forceCircuitNandRep(input.lesson, next, repFromSubmitEvent(event));

  const explanation = authoredLessonPlanAction(input);
  if (explanation) return explanation;
  return authoredPracticeAction(
    input.lesson,
    next,
    `authored lesson sequence — mounting next first-KC practice item "${next.itemId}" in rep "${rep}"`,
    rep,
  );
}

/** Pick the rep the learner is currently working in, defaulting to truth_table.
 *  Used by the forward-progress fallback so a re-mount honors the active rep. */
function repFromSubmitEvent(event: ClientEvent): 'truth_table' | 'circuit' | 'pseudocode' {
  if (event.kind === 'submit') return event.repSubmission?.rep ?? 'truth_table';
  return 'truth_table';
}

type RepKind = 'truth_table' | 'circuit' | 'pseudocode';

/**
 * #4: the genuine NAND-construction items in Lesson 3 must be practiced/assessed in
 * the CIRCUIT representation (build the function from NAND gates). A truth table for
 * `NOT A` cannot distinguish "constructed from NAND" from "remembered NOT's table",
 * so these items are forced to `circuit` (the `allowedGates: ['NAND']` palette is
 * applied by `authoredPracticeAction`/`retryMountForExpression` for lessonId === 3).
 * Every OTHER item (incl. L3's plain `composition` items, re-tagged in f4c66b6, and
 * `nand-universality`) is left in whatever rep the interleaver/learner chose.
 */
const L3_NAND_CONSTRUCTION_ITEMS: ReadonlySet<string> = new Set([
  'l3-nand-basic',
  'l3-not-from-nand',
  'l3-and-from-nand',
  'l3-or-from-nand',
]);

function forceCircuitNandRep(
  lesson: Lesson,
  item: Lesson['content']['items'][number],
  rep: RepKind,
): RepKind {
  if (lesson.content.lessonId === 3 && L3_NAND_CONSTRUCTION_ITEMS.has(item.itemId)) {
    return 'circuit';
  }
  return rep;
}

/** The rep cycle for interleaving (#3/#8): rotate truth_table → circuit → pseudocode → … */
const REP_CYCLE: readonly RepKind[] = ['truth_table', 'circuit', 'pseudocode'];

/** Map a mounted component kind back to its rep (mirrors introAdvance.activeRepFromHistory). */
function repFromComponentKind(kind: string | undefined): RepKind | undefined {
  switch (kind) {
    case 'TruthTablePractice':
      return 'truth_table';
    case 'CircuitBuilder':
      return 'circuit';
    case 'PseudocodeChallenge':
      return 'pseudocode';
    default:
      return undefined;
  }
}

/** The (targetExpression, rep) of the most-recent item-bearing PRACTICE mount in the
 *  bounded recent history, so the ladder never re-mounts the identical (item, rep)
 *  back-to-back (#2/#3 anti-massing). Undefined when no prior practice mount is in
 *  the window. */
function lastPracticeMount(input: AgentInput): { expression: string; rep: RepKind } | undefined {
  for (const turn of [...input.recentHistory].reverse()) {
    if (turn.actionType !== 'mount') continue;
    const rep = repFromComponentKind(turn.componentKind);
    if (rep && turn.expression) return { expression: turn.expression, rep };
  }
  return undefined;
}

/**
 * #3/#8 INTERLEAVING: choose the next ladder mount so that (a) it never re-mounts the
 * identical (item, rep) as the immediately-preceding practice mount, and (b) the rep
 * ROTATES across the cycle so the consecutive-correct ladder is actually built from
 * multiple representations — which is exactly what #1's `requireDifferentRepresentation`
 * gate now demands. Without (b) the multi-rep REQUIREMENT would face a single-rep
 * PRACTICE loop — a gate nobody could pass.
 *
 * Strategy:
 *   - Prefer a DIFFERENT hardest-tier item than the one just shown (interleaving across
 *     items) when the lesson has ≥2 hardest-tier items (lessons 2–4); pick its rep by
 *     advancing the rep cycle from the previous rep.
 *   - When the lesson has only ONE hardest-tier item (L1's AND ladder has l1-and +
 *     l1-review-mix, but a lesson with a single hardest item), rotate the REP of that
 *     same item instead — never the identical (item, rep) twice in a row.
 *   - The chosen (item, rep) is guaranteed distinct from the previous mount.
 */
function pickInterleavedLadderMount(
  hardestItems: Lesson['content']['items'],
  prev: { expression: string; rep: RepKind } | undefined,
): { item: Lesson['content']['items'][number]; rep: RepKind } | null {
  if (hardestItems.length === 0) return null;
  const prevRep = prev?.rep ?? 'truth_table';
  const nextRep = REP_CYCLE[(REP_CYCLE.indexOf(prevRep) + 1) % REP_CYCLE.length]!;

  // Prefer a hardest-tier item that differs from the one just shown.
  const differentItem = hardestItems.find((i) => i.targetExpression !== prev?.expression);
  if (hardestItems.length >= 2 && differentItem) {
    // A different item + the rotated rep is always distinct from the previous mount.
    return { item: differentItem, rep: nextRep };
  }

  // Single hardest-tier item (or only the same item available): rotate the REP so we
  // never re-mount the identical (item, rep). If the rotated rep somehow equals the
  // previous rep (cycle length issue — impossible for 3 distinct reps), advance once more.
  const item = hardestItems[0]!;
  const rep = nextRep === prevRep ? REP_CYCLE[(REP_CYCLE.indexOf(nextRep) + 1) % REP_CYCLE.length]! : nextRep;
  return { item, rep };
}

/**
 * B7 FORWARD-PROGRESS FALLBACK (deterministic, fail-NEVER-no_action).
 *
 * The class of bug this fixes: on a CORRECT `submit` during `practicing`, the
 * learner must always be handed the next thing to do. The deterministic per-KC
 * walk (`deterministicAuthoredPhaseAction`) only iterates `firstPracticeItemPerKc`
 * — the KC-DEDUPED list — so after the last UNIQUE-KC item it returns null and
 * drops authored items whose KC was already seen (e.g. L1's `l1-review-mix`, a
 * second AND item). The LLM and the existing `authoredLessonPlanAction` fallback
 * only emit just-in-time concept explanations BEFORE a next NEW KC, so past the
 * last new KC they too return null. Net result before this fix: `no_action` →
 * the solved item stays mounted with a disabled Submit and the learner is
 * STRANDED while still `practicing` and not yet eligible to advance (the mastery
 * gate needs `consecutiveCorrectAtHardestTier` + transfer + explain-back).
 *
 * This is the deterministic, in-spirit safety net: it runs ONLY on a correct
 * submit, ONLY when no earlier (privileged/transfer/wrong/per-KC/LLM) arm produced
 * a usable forward action, and it NEVER mounts a privileged/integrity surface
 * (MasteryCelebration / TransferProbe / ExplainBackPrompt keep their own earned-it
 * gating). It uses the authored item's own `truthTable` (never a fabricated
 * `claimedTruthTable`) and still flows through `validateOutboundAction` + Layer-2
 * + the earned-it gate at the call site.
 *
 * Order of preference (fail-CLOSED on a satisfied gate — never advance past it):
 *   1. If the full mastery gate is ALREADY satisfied, return null — a privileged
 *      path (transfer/explain-back/mastery) owns this turn; do NOT mint practice.
 *   2. Otherwise mount the next authored item (FULL `items` list, not the deduped
 *      per-KC list) the learner has NOT yet passed — picking up `l1-review-mix`.
 *   3. If every authored item is already passed but the gate is still unmet,
 *      re-mount the HARDEST-tier authored item so the consecutive-correct ladder
 *      can keep climbing (spaced practice), rather than dead-ending.
 */
export function forwardProgressFallbackAction(
  input: AgentInput,
  gateSatisfied: boolean,
): Action | null {
  const event = input.event;
  if (event.kind !== 'submit') return null;
  if (input.currentSubmitCorrect !== true) return null;
  // (1) Gate already satisfied → let a privileged path own the turn.
  if (gateSatisfied) return null;

  const items = input.lesson.content.items;
  if (items.length === 0) return null;
  const passed = input.passedItemIds ?? new Set<string>();
  // #3/#8: the continued-practice / ladder phase must INTERLEAVE representations so
  // the cross-rep evidence #1 now gates on can actually accumulate. We never re-mount
  // the identical (item, rep) as the immediately-preceding practice mount, and we
  // rotate the rep across the cycle. `prev` is the last item-bearing practice mount
  // (read from the bounded recent history); the learner's just-submitted rep is the
  // tie-breaking default when no prior mount is in the window.
  const prev = lastPracticeMount(input) ?? {
    expression: '',
    rep: repFromSubmitEvent(event),
  };
  const rotatedRep = REP_CYCLE[(REP_CYCLE.indexOf(prev.rep) + 1) % REP_CYCLE.length]!;

  // (2) Next not-yet-passed authored item, in authored order. Vary the rep away from
  //     the previous mount (rotate the cycle) so the continued walk builds cross-rep
  //     fluency rather than doing every item in one rep (#8). If the next unfinished
  //     item is the SAME expression as the previous mount, the rotated rep guarantees
  //     we don't re-mount the identical (item, rep).
  const nextUnfinished = items.find((item) => !passed.has(item.itemId));
  if (nextUnfinished) {
    const repForNext = forceCircuitNandRep(input.lesson, nextUnfinished, rotatedRep);
    return authoredPracticeAction(
      input.lesson,
      nextUnfinished,
      `B7 forward-progress fallback — mounting next unfinished authored item "${nextUnfinished.itemId}" interleaved in rep=${repForNext} (prev rep=${prev.rep})`,
      repForNext,
    );
  }

  // (3) All authored items passed but the gate is unmet — keep the ladder going by
  //     re-mounting a hardest-tier item, ROTATED across items and reps so it never
  //     repeats the identical (item, rep) back-to-back (massed practice trains a
  //     memorized answer; #2 would not even credit it). NEVER no_action.
  const maxTier = Math.max(...items.map((i) => i.difficultyTier));
  const hardest = items.filter((i) => i.difficultyTier === maxTier);
  const picked = pickInterleavedLadderMount(hardest, prev);
  if (!picked) return null;
  const ladderRep = forceCircuitNandRep(input.lesson, picked.item, picked.rep);
  return authoredPracticeAction(
    input.lesson,
    picked.item,
    `B7 forward-progress fallback — all authored items passed but mastery gate unmet; re-mounting hardest-tier item "${picked.item.itemId}" in rep=${ladderRep} (prev rep=${prev.rep}) to continue the INTERLEAVED consecutive-correct ladder`,
    ladderRep,
  );
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

/** Whether voice is configured on this deployment. The LiveKit credentials are
 *  env-only and fail closed: all three of key, secret, and a non-empty URL must be
 *  present (a token with no server URL is useless to the browser). This is the single
 *  source of truth shared by the mint route (503 when false) and the lightweight
 *  availability probe (`GET /api/realtime/availability`) the client uses to decide
 *  whether to offer the voice button at all — so the two can never disagree. */
function voiceConfigured(): boolean {
  const livekitUrl = (process.env['LIVEKIT_URL'] ?? '').trim();
  const apiKey = process.env['LIVEKIT_API_KEY'];
  const apiSecret = process.env['LIVEKIT_API_SECRET'];
  return Boolean(apiKey) && Boolean(apiSecret) && livekitUrl !== '';
}

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
  // deploy serves a clean 503 rather than minting an unusable token.
  if (!voiceConfigured()) {
    sendJson(res, 503, { error: 'voice not configured' });
    return;
  }
  const livekitUrl = (process.env['LIVEKIT_URL'] ?? '').trim();
  const apiKey = process.env['LIVEKIT_API_KEY']!;
  const apiSecret = process.env['LIVEKIT_API_SECRET']!;

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
  /**
   * F-30 (ADR-016): the session id bound to THIS WebSocket connection via its opening
   * `session_start` frame. The spoken-turn handler keys off the bound id, NOT the id
   * on the incoming `spoken_turn` frame (the MR !8 deletion-scheduling binding rule:
   * any stateful WS-triggered action must key off the `session_start`-bound id).
   *
   * Production: set from `boundSessionId` in the `ws.on('message')` closure (already
   * bound in `createServer`). Tests that exercise `spoken_turn` must supply this so the
   * handler can look up the captured utterance.
   *
   * null/undefined → treated as "no bound session" → ack without answering (fail closed).
   */
  boundSessionId?: string | null;
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
            // F-27 AC#7: backfill prompt so the surface boundary never shows
            // PromptMissing (finding F27-1).  F-29's LLM generation will supply
            // a richer prompt; this is the keyless heuristic fallback that ships
            // first and is the live-drive target.
            prompt: defaultItemPrompt(first.targetExpression, 'truth_table'),
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

// ---------------------------------------------------------------------------
// ADR-013 stretch — the free-build playground.
//
// The playground is an UNGRADED sibling mode (its own micro-statechart on the
// client). None of its turns fold into BKT/streak/transfer/mastery — they persist
// a record and reply with an ack/mount. The integrity rules still apply:
//   - Entry is EARNED: the server re-derives the current lesson's mastery gate from
//     the (bounded, `app IS NULL`-scoped) event log; an unmet gate fails CLOSED.
//   - The verdict authority is the CLIENT-SIDE `playgroundEquivalence` (correctness
//     off the network); the server recompute here is defense-in-depth for the
//     persisted record only — NEVER a BKT/mastery write.
// The final lesson (no `loadLessonIfExists(currentLessonId + 1)`) is the only place
// the playground is offered; the entry gate re-checks mastery regardless.
// ---------------------------------------------------------------------------

/** READ-ONLY mastery derive over the persisted log (`app IS NULL`-scoped, with the
 *  uncapped off-topic total). Unlike `updateAndReadLearnerState` it writes NOTHING —
 *  the playground is ungraded, so its turns must never (re-)persist `learner_state`.
 *  Returns the current lesson's mastery state + its server-sourced `conceptsMastered`. */
async function deriveMasteryReadOnly(
  db: Db,
  sessionId: string,
  lesson: Lesson,
): Promise<LearnerState> {
  const [priorRowsDesc, offTopicTotal] = await Promise.all([
    db
      .select({ kind: events.kind, payload: events.payload })
      .from(events)
      // `app IS NULL`: keep foreign-app rows (D3 discriminator) out of the fold.
      .where(and(eq(events.sessionId, sessionId), isNull(events.app)))
      .orderBy(desc(events.ts))
      .limit(MAX_SESSION_EVENTS),
    countOffTopicAnswers(db, sessionId),
  ]);
  const logged: LoggedEvent[] = priorRowsDesc.reverse().map((r) => toLoggedEvent(r.kind, r.payload));
  const derived = deriveState(logged, lesson.content, lesson.masteryConfig);
  derived.offTopicCount = Math.max(derived.offTopicCount, offTopicTotal);
  return toLearnerState(derived, lesson.masteryConfig);
}

/** The mastery gate the playground entry earns against — re-derived server-side
 *  from the persisted log (the earned-it guard), never trusted from the client. */
/** The full playground-entry earned-it check (MR !10 review): the current lesson's
 *  mastery gate passes AND the lesson is TERMINAL (no next lesson). The playground is
 *  the post-curriculum capstone, so opening it mid-curriculum — even with the current
 *  lesson mastered — is refused (a forged enter_playground can't skip ahead). Mirrors
 *  the masteryCelebration affordance (`loadLessonIfExists(lessonId+1) === undefined`).
 *  Returns the gate result plus an explicit `terminal` flag and a combined `passed`. */
async function playgroundEntryEarned(
  db: Db,
  sessionId: string,
  lesson: Lesson,
): Promise<{ passed: boolean; blockers: string[] }> {
  const masteryState = await deriveMasteryReadOnly(db, sessionId, lesson);
  const gate = evaluateMasteryGate(masteryState, lesson.masteryConfig);
  const isTerminal = loadLessonIfExists(lesson.content.lessonId + 1) === undefined;
  const blockers: string[] = [...gate.blockers];
  if (!isTerminal) blockers.push('not_terminal_lesson');
  return { passed: gate.passed && isTerminal, blockers };
}

/** Server-side recompute of the playground verdict for the persisted record
 *  (ADR-013 defense-in-depth). For circuit/pseudocode the learner authors an
 *  expression → `playgroundEquivalence` (caps BOTH sides). For truth_table the
 *  learner fills the target's table → compare the cells to `truthTable(target).out`
 *  directly (the cells ARE the answer; there is no authored expression). A missing
 *  rep is simply absent from the verdict. Never throws, never enumerates over cap. */
function recomputePlaygroundVerdict(
  event: Extract<ClientEvent, { kind: 'playground_submit' }>,
): { byKey: Record<string, boolean>; allEquivalent: boolean } {
  const exprByKey: Record<string, string> = {};
  const { submissions, targetExpression } = event;
  if (submissions.circuit?.rep === 'circuit') exprByKey.circuit = submissions.circuit.expression;
  if (submissions.pseudocode?.rep === 'pseudocode') exprByKey.pseudocode = submissions.pseudocode.expression;
  const exprResult = playgroundEquivalence(targetExpression, exprByKey);
  const byKey: Record<string, boolean> = { ...exprResult.byKey };

  const tt = submissions.truth_table;
  if (tt?.rep === 'truth_table') {
    let ttOk = false;
    try {
      // DoS cap (MR !10 review): the truth_table path calls truthTable() on the
      // learner-controlled targetExpression — it MUST honor the distinct-variable cap
      // (the same one playgroundEquivalence applies to the expression reps), or a
      // forged high-arity target forces synchronous 2^n enumeration on the WS turn.
      // Over-cap → ttOk=false, never enumerate (per the repo invariant; over-cap input
      // is simply "not equivalent").
      if (variables(parse(targetExpression)).length <= MAX_EQUIVALENCE_VARS) {
        const expected = truthTable(targetExpression).out;
        ttOk =
          tt.cells.length === expected.length &&
          expected.every((b, i) => (b ? 1 : 0) === tt.cells[i]);
      }
    } catch {
      ttOk = false;
    }
    byKey.truth_table = ttOk;
  }
  const keys = Object.keys(byKey);
  const allEquivalent = keys.length > 0 && keys.every((k) => byKey[k] === true);
  return { byKey, allEquivalent };
}

/** `enter_playground`: gate on the current lesson's mastery (earned-it, fail-closed,
 *  `app IS NULL`-scoped). On a pass, ack so the client mounts the canvas; on a fail,
 *  refuse with an error (no canvas). Persists a record either way. */
async function handleEnterPlaygroundTurn(
  deps: ServerDeps,
  ws: WebSocket,
  event: Extract<ClientEvent, { kind: 'enter_playground' }>,
  lesson: Lesson,
): Promise<void> {
  const gate = await playgroundEntryEarned(deps.db, event.sessionId, lesson);
  await deps.db.insert(events).values({
    sessionId: event.sessionId,
    kind: event.kind,
    payload: {
      event,
      gateEvaluation: { passed: gate.passed, blockers: gate.blockers },
      statechartDecision: gate.passed ? 'accept' : 'reject',
      statechartReason: gate.passed ? 'playground_entry_earned' : `mastery_gate_failed: ${gate.blockers.join(',')}`,
    },
  });
  if (!gate.passed) {
    send(ws, {
      kind: 'error',
      sessionId: event.sessionId,
      message: `playground locked: mastery not yet earned (${gate.blockers.join(',')})`,
    });
    return;
  }
  send(ws, { kind: 'ack', sessionId: event.sessionId, event: event.kind });
}

/** `playground_submit`: recompute the verdict for the persisted record only — NO
 *  BKT/streak/mastery write. Ack so the client knows the record landed (the client
 *  already showed its own verdict — correctness off the network). */
async function handlePlaygroundSubmitTurn(
  deps: ServerDeps,
  ws: WebSocket,
  event: Extract<ClientEvent, { kind: 'playground_submit' }>,
  lesson: Lesson,
): Promise<void> {
  // Earned-it gate (MR !10 review): a playground frame is a privileged capstone action;
  // refuse it unless the session has earned entry (mastery + terminal lesson). Without
  // this, a forged frame (or the optimistic UI after a refused enter) gets full ungraded
  // playground use without earning the capstone. Fail closed.
  const gate = await playgroundEntryEarned(deps.db, event.sessionId, lesson);
  if (!gate.passed) {
    send(ws, {
      kind: 'error',
      sessionId: event.sessionId,
      message: `playground locked: mastery not yet earned (${gate.blockers.join(',')})`,
    });
    return;
  }
  const verdict = recomputePlaygroundVerdict(event);
  await deps.db.insert(events).values({
    sessionId: event.sessionId,
    kind: event.kind,
    payload: { event, verdict },
  });
  send(ws, { kind: 'ack', sessionId: event.sessionId, event: event.kind });
}

/** A deterministic, Socratic scaffold for a playground hint request (ADR-013 AC#5).
 *  The agent SCAFFOLDS, never directs: it nudges the learner toward checking their
 *  own work across the three representations — it never reveals the target's answer
 *  key (the playground is ungraded free-build; the equivalence VERDICT is the
 *  client-side `playgroundEquivalence`, never the LLM — D26-3). Kept off the graded
 *  path and free of any `equivalent()`/`truthTable()` over learner input, so there is
 *  no new DoS/var-cap surface. A live LLM provider may later enrich this copy, but the
 *  offline default must always produce a usable scaffold so the gesture works with no
 *  key (the heuristic-provider discipline). */
function playgroundScaffoldText(
  event: Extract<ClientEvent, { kind: 'playground_request_scaffold' }>,
): string {
  const target = event.targetExpression.trim();
  const opener = event.learnerQuestion?.trim()
    ? `On "${event.learnerQuestion.trim()}": `
    : '';
  return (
    `${opener}I won't give you the answer — that's the whole point of the playground. ` +
    `Work it in all three forms and let them check each other: fill the truth table for ` +
    `${target ? `\`${target}\`` : 'your target'} row by row, wire the same function as a ` +
    `circuit, and write it as pseudocode — then press Submit and the workspace tells you ` +
    `which representations already agree. Where two of them disagree, the odd one out is ` +
    `where your bug is. Start from the rows where the output is true.`
  );
}

/** `playground_request_scaffold`: the agent SCAFFOLDS on request (AC#5) — it must
 *  actually deliver something to the learner, not just ack. We build the scaffold-only
 *  `verify_playground_equivalence` move, compile it to a wire `Action` (an on-topic
 *  answer mount), and re-validate it at the wire boundary like every outbound action
 *  (the server never trusts even its own move). The move can ONLY compile to an
 *  answer/no_action — never a transition — so the playground stays ungraded; the
 *  equivalence verdict is the client's, never this turn's. */
async function handlePlaygroundRequestScaffoldTurn(
  deps: ServerDeps,
  ws: WebSocket,
  event: Extract<ClientEvent, { kind: 'playground_request_scaffold' }>,
  lesson: Lesson,
): Promise<void> {
  // Earned-it gate (MR !10 review): the scaffold is a playground privilege — refuse it
  // for a session that hasn't earned entry, so a known session id can't farm tutor
  // scaffolds without mastering/entering the playground. Fail closed.
  const gate = await playgroundEntryEarned(deps.db, event.sessionId, lesson);
  if (!gate.passed) {
    send(ws, {
      kind: 'error',
      sessionId: event.sessionId,
      message: `playground locked: mastery not yet earned (${gate.blockers.join(',')})`,
    });
    return;
  }
  const move: TacticalMove = {
    move: 'verify_playground_equivalence',
    scaffold: playgroundScaffoldText(event),
    rationale: 'playground scaffold-on-request (ADR-013): nudge across reps, never the answer',
  };
  // compileMove → an `answer_question` action; validateOutboundAction is the wire-boundary
  // re-check (a malformed action would downgrade to no_action, never crash the socket).
  const { action } = validateOutboundAction(compileMove(move));
  await deps.db.insert(events).values({
    sessionId: event.sessionId,
    kind: event.kind,
    payload: { event, action },
  });
  send(ws, { kind: 'action', sessionId: event.sessionId, action });
}

/** `exit_playground`: mount a session-end celebration (server-sourced
 *  `conceptsMastered`, never a client claim) and persist the record. */
async function handleExitPlaygroundTurn(
  deps: ServerDeps,
  ws: WebSocket,
  event: Extract<ClientEvent, { kind: 'exit_playground' }>,
  lesson: Lesson,
): Promise<void> {
  // Earned-it gate (MR !10 review — the highest-impact of this cluster): exit mints a
  // `mount MasteryCelebration` action, which buildReport + the counter-metrics treat as
  // the PRODUCTION "declared mastered" signal. So a known UNMASTERED session forging
  // exit_playground would otherwise persist a false mastery signal and poison metric-6.
  // Refuse unless entry was earned (mastery + terminal lesson); never mount a celebration
  // for an unmastered session.
  const gate = await playgroundEntryEarned(deps.db, event.sessionId, lesson);
  if (!gate.passed) {
    await deps.db.insert(events).values({
      sessionId: event.sessionId,
      kind: event.kind,
      payload: {
        event,
        statechartDecision: 'reject',
        statechartReason: `playground_not_earned: ${gate.blockers.join(',')}`,
      },
    });
    send(ws, {
      kind: 'error',
      sessionId: event.sessionId,
      message: `playground locked: mastery not yet earned (${gate.blockers.join(',')})`,
    });
    return;
  }
  const masteryState = await deriveMasteryReadOnly(deps.db, event.sessionId, lesson);
  const action = masteryCelebrationAction(masteryState, lesson);
  await deps.db.insert(events).values({
    sessionId: event.sessionId,
    kind: event.kind,
    payload: { event, action },
  });
  send(ws, { kind: 'action', sessionId: event.sessionId, action });
}

/**
 * F-30 (ADR-016): `spoken_turn` handler.
 *
 * The client fires `spoken_turn { sessionId }` (no transcript, no question field)
 * after the learner has spoken. The server reads the captured utterance from the
 * `takeLearnerUtteranceFor` seam (consume-on-read, backed by `LearnerUtteranceRegistry`,
 * which is *designed* to be populated by a server-side `VoiceBridge.onLearnerUtterance` —
 * that bridge wiring is the DEFERRED cross-platform voice smoke, so in production today the
 * registry is empty and this path fails closed). If no utterance was captured, the handler
 * acks and returns — NEVER answers a client-provided string.
 *
 * When a captured utterance exists, it builds a synthetic in-process `learner_question`
 * event (reusing the same generic Q&A turn: `proposeWithTimeout → answer_question`)
 * so off-topic folding, topic classification, and the text reply come for free. The
 * persisted event row uses the `spoken_turn` kind so the replay is traceable. The
 * outbound action carries `spoken:true` so F-27's surface renders the learner side
 * as a spoken bubble.
 *
 * WS binding invariant (MR !8 review): the utterance lookup ALWAYS uses
 * `opts.boundSessionId` (the id bound from the opening `session_start` frame),
 * never the `event.sessionId` on the incoming frame. This ensures a client forging
 * a `spoken_turn` with a different `sessionId` cannot trigger an answer for that
 * victim's captured utterance.
 *
 * Integrity guarantees:
 *  - No capture → ack, no answer, no persisted row.
 *  - The answered `question` is the server-captured string, never the client frame.
 *  - Off-topic folding via `countOffTopicAnswers` (the uncapped monotonic query).
 *  - `events.app IS NULL` (Polymath discriminator) on the persisted row.
 */
async function handleSpokenTurnTurn(
  deps: ServerDeps,
  ws: WebSocket,
  event: Extract<ClientEvent, { kind: 'spoken_turn' }>,
  lesson: Lesson,
  opts: FrameOptions,
): Promise<void> {
  // WS-binding rule (MR !8): key off the bound session, not the frame's sessionId.
  // A client that forges spoken_turn.sessionId=victimSession can't make the server:
  //   (a) look up the victim's captured utterance (boundId prevents this), or
  //   (b) persist state under the victim's session (effectiveSessionId = boundId).
  // If no bound session or bound ≠ frame session, ack without answering.
  const boundId = opts.boundSessionId ?? null;
  if (!boundId) {
    send(ws, { kind: 'ack', sessionId: event.sessionId, event: event.kind });
    return;
  }
  // The comment above promised "bound ≠ frame session → ack without answering" but
  // the code only checked boundId presence. A frame naming a DIFFERENT (valid) session
  // would still get a full answer from the bound session's utterance. Enforce it: a
  // mismatched frame is acked and dropped before any agent call. (MR !11 review.)
  if (event.sessionId !== boundId) {
    send(ws, { kind: 'ack', sessionId: boundId, event: event.kind });
    return;
  }
  // Consume-on-read: a captured utterance answers exactly ONE spoken_turn. Reading
  // via the consuming getter clears it, so a client cannot replay spoken_turn to
  // re-answer (and re-bill / re-pollute the off-topic counter for) the same stale
  // text without speaking again. Falls back to the non-consuming peek only if a
  // caller injected just that getter. (MR !11 review.)
  const utterance =
    deps.takeLearnerUtteranceFor?.(boundId) ?? deps.latestLearnerUtteranceFor?.(boundId);

  if (!utterance) {
    // No server capture → fail closed (AC#2). Ack the trigger so the client knows
    // the frame was received, but do NOT answer a non-existent question.
    send(ws, { kind: 'ack', sessionId: boundId, event: event.kind });
    return;
  }

  // Use the WS-bound session id for ALL DB operations (not the frame's sessionId).
  // This ensures a forged sessionId on the frame can't route state reads/writes
  // to a different session.
  const effectiveSessionId = boundId;

  // Build a synthetic in-process `learner_question` event so the spoken Q&A goes
  // through the SAME generic Q&A path (proposeWithTimeout → answer_question) as
  // a typed question. This gives off-topic folding + topic classification for free.
  const syntheticQuestion: Extract<ClientEvent, { kind: 'learner_question' }> = {
    kind: 'learner_question',
    sessionId: effectiveSessionId,
    question: utterance,
  };

  // Run the generic agent turn on the synthetic question.
  const [learnerDerived, recentHistory, transferCandidates, inTransferProbe] = await Promise.all([
    updateAndReadLearnerState(deps.db, effectiveSessionId, syntheticQuestion, lesson, undefined, undefined),
    readRecentHistory(deps.db, effectiveSessionId),
    readTransferCandidates(deps.db, effectiveSessionId, lesson.content.lessonId),
    isInTransferProbe(deps.db, effectiveSessionId),
  ]);

  const agentInput: AgentInput = {
    event: syntheticQuestion,
    lesson,
    learnerState: learnerDerived.snapshot,
    recentHistory,
    transferCandidates,
    transferVerdict: undefined,
    inTransferProbe,
    hintsByItem: learnerDerived.hintsByItem,
    priorMissesByItem: learnerDerived.priorMissesByItem,
    currentSubmitCorrect: undefined,
  };

  const proposed = await proposeWithTimeout(deps.agent, agentInput);
  const { action: shaped } = validateOutboundAction(proposed);
  const layer2 = validateLayer2(shaped);
  const validatedAction: Action = !layer2.ok
    ? noAction('agent_unsure', `outbound Layer-2 rejection (spoken turn): ${layer2.detail}`)
    : shaped;

  // Annotate the action as spoken so F-27's surface renders a spoken-turn bubble.
  // Only apply to `answer_question` (the expected type for a Q&A response).
  const spokenAction: Action =
    validatedAction.type === 'answer_question'
      ? { ...validatedAction, spoken: true }
      : validatedAction;

  // Persist under `spoken_turn` kind (not `learner_question`) so the replay is
  // traceable as a spoken interaction. `events.app IS NULL` (Polymath discriminator).
  // Key by effectiveSessionId (= boundId) — never the forged frame sessionId.
  await deps.db.insert(events).values({
    sessionId: effectiveSessionId,
    kind: 'spoken_turn',
    payload: {
      // Persist the BOUND session id, not the client frame's `sessionId`. Spreading
      // `...event` recorded the (possibly forged) frame sessionId inside the blob, so
      // replay/operator tools reading `payload.event.sessionId` would mis-attribute the
      // turn even though every real DB key uses effectiveSessionId. (MR !11 review.)
      event: { kind: 'spoken_turn', sessionId: effectiveSessionId, capturedQuestion: utterance },
      action: spokenAction,
      learnerSnapshot: learnerDerived.snapshot,
    },
    app: null,
  });

  send(ws, { kind: 'action', sessionId: effectiveSessionId, action: spokenAction });
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

  // ADR-013 stretch — the free-build playground. These four event kinds are NOT
  // graded practice: they carry no authored answer key, must never fold into the
  // BKT/streak or transfer path, and never reach the menu/`proposeMove`. Each is a
  // dedicated server reflex handled BEFORE the generic practice turn, so a
  // playground frame can never be misrouted into BKT/streak/transfer/mastery.
  if (event.kind === 'enter_playground') {
    // Earned-it: re-derive the current lesson's mastery gate (fail-closed).
    await handleEnterPlaygroundTurn(deps, ws, event, lesson);
    return;
  }
  if (event.kind === 'playground_submit') {
    // Recompute the verdict for the persisted record only — no BKT/mastery write.
    await handlePlaygroundSubmitTurn(deps, ws, event, lesson);
    return;
  }
  if (event.kind === 'playground_request_scaffold') {
    await handlePlaygroundRequestScaffoldTurn(deps, ws, event, lesson);
    return;
  }
  if (event.kind === 'exit_playground') {
    // Mount the session-end celebration (server-sourced conceptsMastered).
    await handleExitPlaygroundTurn(deps, ws, event, lesson);
    return;
  }

  // F-30 (ADR-016): spoken-turn trigger — dispatch BEFORE the generic practice turn.
  // The handler reads the server-captured utterance (latestLearnerUtteranceFor keyed by
  // the WS-bound id), NOT the frame's sessionId. No capture → ack+return (fail closed).
  if (event.kind === 'spoken_turn') {
    await handleSpokenTurnTurn(deps, ws, event, lesson, opts);
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
    passedItemIds: learnerDerived.passedItemIds,
    currentSubmitCorrect: learnerDerived.currentSubmitCorrect,
  };

  const deterministicAuthoredAction =
    event.kind === 'submit' &&
    (learnerDerived.currentSubmitCorrect === false || learnerDerived.snapshot.ruleGatePassed)
      ? null
      : deterministicAuthoredPhaseAction(input);

  // Propose an action (under a timeout), then validate it server-side before it
  // crosses the wire (ADR-005 / criterion 5). The agent's own flow already ran
  // Layer 2, but the wire boundary re-validates and *enforces*: a Zod-malformed
  // proposal OR an item whose claimedTruthTable fails the recompute is downgraded
  // to `no_action` rather than forwarded. The server never trusts the agent, even
  // its own — defense in depth (CLAUDE.md invariant).
  const agentProposed = deterministicAuthoredAction ?? await proposeWithTimeout(deps.agent, input);
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
  const privilegedActionRejected = isMasteryTransition && earnedItRejection !== null;

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
  // R2-2: the wrong-submit remediation reflex must flow through the SAME outbound gates as the
  // agent's own proposals (validateOutboundAction + Layer-2 + earned-it) — it never bypasses
  // them. The recomputed `claimedTruthTable` (server-sourced) means Layer-2 always accepts; the
  // mount is a plain editable practice item, so the earned-it gate is a no-op (it only ever
  // refuses privileged TransferProbe/mastery surfaces). Guard the result so a (defensive)
  // rejection collapses to null rather than forwarding an unvalidated/refused action.
  const wrongSubmitFallback: Action | null = (() => {
    if (
      event.kind !== 'submit' ||
      learnerDerived.currentSubmitCorrect !== false ||
      matchesSubmittedAuthoredItem(validatedAction, event, lesson)
    ) {
      return null;
    }
    const candidate = wrongSubmitRemediationAction(
      event,
      lesson,
      learnerDerived.priorMissesByItem,
      validatedAction,
    );
    if (!candidate) return null;
    const { action: wsShaped } = validateOutboundAction(candidate);
    if (!validateLayer2(wsShaped).ok) return null;
    if (rejectUnauthorizedAction(wsShaped, learnerDerived.snapshot, gateEvaluation, transferCandidates)) {
      return null;
    }
    return wsShaped;
  })();
  const authoredSequenceFallback =
    !privilegedActionRejected &&
    event.kind === 'submit' &&
    learnerDerived.currentSubmitCorrect === true &&
    !learnerDerived.snapshot.ruleGatePassed
      ? authoredLessonPlanAction(input)
      : null;

  const shouldMountExplainBack =
    transferVerdict?.correct === true &&
    lesson.masteryConfig.requireExplainBackPass &&
    !learnerDerived.masteryState.explainBackPassed;

  const preFallbackAction: Action = privilegedActionRejected
    ? validatedAction
    : shouldMountExplainBack
      ? {
          type: 'mount',
          component: {
            kind: 'ExplainBackPrompt',
            targetItemId: transferVerdict!.itemId,
            promptBody:
              'Nice — you passed the transfer. In your own words, walk me through how you solved that specific problem.',
            maxDurationSec: 15,
          },
          rationale: `transfer passed for ${transferVerdict!.itemId}; mounting explain-back (server reflex, F-11)`,
        }
      : wrongSubmitFallback
        ? wrongSubmitFallback
        : authoredSequenceFallback
          ? authoredSequenceFallback
        : validatedAction;

  // B7 FORWARD-PROGRESS FALLBACK (last resort, deterministic). If, after every
  // earlier arm (privileged transfer/explain-back reflex, wrong-submit remediation,
  // authored just-in-time explanation, the validated agent/per-KC action) the turn
  // would STILL be `no_action` on a CORRECT `practicing` submit, the learner would
  // be stranded (B7). Hand them the next thing to do instead — the next unfinished
  // authored item, or a hardest-tier re-mount to continue the ladder — NEVER
  // `no_action`. The candidate is re-run through `validateOutboundAction` + Layer-2
  // + the earned-it gate (it never bypasses them, and it never mints a privileged
  // surface). The fallback is itself fail-closed: it returns null when the mastery
  // gate is already satisfied (a privileged path owns that turn).
  let action = preFallbackAction;
  let forwardProgressFired = false;
  if (
    !privilegedActionRejected &&
    action.type === 'no_action' &&
    event.kind === 'submit' &&
    learnerDerived.currentSubmitCorrect === true
  ) {
    const candidate = forwardProgressFallbackAction(
      input,
      gateEvaluation.passed || learnerDerived.snapshot.ruleGatePassed,
    );
    if (candidate) {
      const { action: fpShaped } = validateOutboundAction(candidate);
      const fpLayer2 = validateLayer2(fpShaped);
      const fpRejection = rejectUnauthorizedAction(
        fpShaped,
        learnerDerived.snapshot,
        gateEvaluation,
        transferCandidates,
      );
      if (fpLayer2.ok && !fpRejection) {
        action = fpShaped;
        forwardProgressFired = true;
      }
    }
  }

  // R2-2 WRONG-SUBMIT FORWARD-PROGRESS NET (belt-and-suspenders, mirrors the B7 correct-submit
  // net above). The invariant: a `submit` in `practicing` the learner can still act on must
  // NEVER resolve to `no_action`. The B7 net only catches a CORRECT submit; a WRONG submit on
  // a NON-authored (LLM-generated) item whose `wrongSubmitRemediationAction` somehow still
  // failed (e.g. an over-cap/unparseable expression slipped past) would otherwise dead-end with
  // the workspace LOCKED on the disabled item and no retry. This last-resort arm re-mounts the
  // SAME expression the learner just attempted, editable, with a server-recomputed truth table.
  // It is fail-closed: it NEVER mints a privileged surface (respects privilegedActionRejected),
  // and still flows through validateOutboundAction + Layer-2 + the earned-it gate. If even the
  // recompute is impossible (over-cap), it leaves `no_action` (truly unactionable — nothing to
  // re-mount) rather than fabricating a surface.
  let wrongSubmitNetFired = false;
  if (
    !privilegedActionRejected &&
    action.type === 'no_action' &&
    event.kind === 'submit' &&
    learnerDerived.currentSubmitCorrect === false
  ) {
    const candidate = wrongSubmitRemediationAction(event, lesson, learnerDerived.priorMissesByItem);
    if (candidate) {
      const { action: wsShaped } = validateOutboundAction(candidate);
      const wsLayer2 = validateLayer2(wsShaped);
      const wsRejection = rejectUnauthorizedAction(
        wsShaped,
        learnerDerived.snapshot,
        gateEvaluation,
        transferCandidates,
      );
      if (wsLayer2.ok && !wsRejection && isEditablePracticeMount(wsShaped)) {
        action = wsShaped;
        wrongSubmitNetFired = true;
      }
    }
  }

  // B7/R2-2: lightweight, greppable per-turn decision log so a future dead-end is visible
  // in the agent's stdout (the agent previously logged NOTHING about its decisions).
  // Names which arm produced the wire action: deterministic per-KC / llm / the wrong-submit
  // remediation reflex / a reflex fallback / the B7 correct-submit forward-progress net /
  // the R2-2 wrong-submit forward-progress net / a terminal no_action. The wrong-submit arms
  // are named distinctly (`wrong_submit_remediation` / `wrong_submit_forward_progress`) so a
  // re-occurrence of the R2-2 wrong-answer dead-end is greppable in stdout.
  const decisionArm = wrongSubmitNetFired
    ? 'wrong_submit_forward_progress'
    : forwardProgressFired
      ? 'forward_progress_fallback'
      : action.type === 'no_action'
        ? 'no_action'
        : action === wrongSubmitFallback
          ? 'wrong_submit_remediation'
          : action !== validatedAction
            ? 'reflex_fallback'
            : deterministicAuthoredAction
              ? 'deterministic'
              : 'llm';
  console.info(
    `[polymath] turn decided session=${event.sessionId} event=${event.kind} ` +
      `correct=${String(learnerDerived.currentSubmitCorrect)} gatePassed=${String(gateEvaluation.passed)} ` +
      `arm=${decisionArm} action=${action.type}` +
      (action.type === 'mount' ? `:${action.component.kind}` : ''),
  );

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
        ? { correct: recomputeCorrect(lesson.content, event.itemId, event.submission, event.repSubmission) }
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
  /**
   * F-30: the general-utterance registry backing `latestLearnerUtteranceFor`.
   * Exposed so the production VoiceBridge can call `setLatest(sessionId, text)` via
   * its `onLearnerUtterance` callback when a learner chunk finalizes — filling the
   * seam the spoken-turn handler reads. Without this exposure, the registry only
   * exists in the server closure and the live bridge can't populate it.
   */
  learnerUtteranceRegistry: LearnerUtteranceRegistry;
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

  // F-30 (ADR-016): the general-utterance registry IS the integrity seam for spoken Q&A.
  // Default a fresh registry, exposed as `server.learnerUtteranceRegistry`. The production
  // fill path — a server-side VoiceBridge calling `onLearnerUtterance → setLatest` — is the
  // DEFERRED cross-platform voice-capture smoke (see the ServerDeps doc above and
  // docs/voice-cross-platform-smoke.md), identical to explain-back's deferral; until then the
  // registry stays empty in production and `spoken_turn` fails closed. Tests inject a registry
  // pre-primed with utterances. `latestLearnerUtteranceFor` / `takeLearnerUtteranceFor` are
  // injected into `deps` so `handleSpokenTurnTurn` reads the captured text without ever
  // trusting the client frame (the server-captured-only rule).
  const utteranceRegistry = rawDeps.learnerUtteranceRegistry ?? new LearnerUtteranceRegistry();
  const latestLearnerUtteranceFor =
    rawDeps.latestLearnerUtteranceFor ??
    ((sessionId: string) => utteranceRegistry.latestFor(sessionId));
  // The production handler reads via the CONSUMING getter (read-and-clear) so a
  // captured utterance answers exactly one spoken_turn (no replay). (MR !11 review.)
  const takeLearnerUtteranceFor =
    rawDeps.takeLearnerUtteranceFor ??
    ((sessionId: string) => utteranceRegistry.takeLatest(sessionId));

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
    // F-30: expose the utterance registry + the read getters so handleSpokenTurnTurn can
    // read the server-captured utterance (never the client frame). The registry is filled
    // by a VoiceBridge's onLearnerUtterance callback — DEFERRED to the cross-platform voice
    // smoke (see the ServerDeps doc + docs/voice-cross-platform-smoke.md), as for explain-back.
    learnerUtteranceRegistry: utteranceRegistry,
    latestLearnerUtteranceFor,
    takeLearnerUtteranceFor,
  };

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, {
        status: 'ok',
        agentProvider: deps.agentProviderName ?? rawDeps.agent.constructor.name,
      });
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

    // A side-effect-free availability probe: the client calls this on mount to decide
    // whether to offer the voice button at all (vs. an honest disabled state). It mints
    // nothing, takes no body, needs no session — it only reflects whether the LiveKit
    // env is configured (the same fail-closed check the mint route's 503 uses), so the
    // browser never prompts for the mic on a deployment where voice can't work.
    if (req.method === 'GET' && url.pathname === '/api/realtime/availability') {
      sendJson(res, 200, { available: voiceConfigured() });
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
        // F-30 (MR !8 binding rule): pass the WS-bound session id so
        // handleSpokenTurnTurn keys off it, not the per-frame sessionId.
        boundSessionId,
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

  return { httpServer, wss, explainBackCaptureRegistry: captureRegistry, learnerUtteranceRegistry: utteranceRegistry, close };
}

/** Session-id helper used by the REST layer's callers/tests. */
export function newSessionId(): string {
  return randomUUID();
}
