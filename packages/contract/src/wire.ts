import { z } from 'zod';
import { Action } from './action.js';

/**
 * WebSocket message protocol (ADR-009). Carried over `wss://…/agent`.
 *
 * Change protocol (ROADMAP.md): inbound event kinds and outbound message kinds
 * are **append-only** — an existing kind's payload is never re-shaped. New event
 * kinds (e.g. `transfer_submitted` already reserved here) are added, not edited.
 * F-01 defines the full inbound event vocabulary so downstream features only add
 * payload-bearing handlers, never new envelope shapes.
 */

/** Session identifiers are server-minted UUIDs (ADR-009). Validating the shape
 *  here means a malformed `sessionId` is rejected at the contract boundary,
 *  before it can reach the `uuid`-typed `sessions.id` / `events.session_id`
 *  columns (where a bad value would otherwise raise a DB error). */
export const SessionId = z.string().uuid();
export type SessionId = z.infer<typeof SessionId>;

/**
 * The learner's raw, representation-specific submission, carried alongside the
 * canonical `submission` expression string on a `submit` event. Optional and
 * append-only: a `submit` frame without it is still valid (the canonical
 * `submission` string remains the contract's required channel). The server only
 * logs this for replay/agent context — the correctness verdict is computed
 * client-side via @polymath/booleans (ADR-008: high-frequency interaction never
 * touches the network), never re-derived from this payload.
 *
 * Each rep populates exactly one branch:
 *  - truth_table: the learner-filled output column, 0/1 ints, MSB-first (matches
 *    @polymath/booleans truth-table order). The item's target expression travels
 *    in the required `submission` field (truth-table has no learner-authored
 *    expression).
 *  - circuit / pseudocode: the learner *builds* an expression, so its canonical
 *    form is in `submission`; `expression` here echoes it for self-containment,
 *    plus the rep-native source (topology / pseudocode text) for replay.
 */
/**
 * Lesson-scale bounds on the rep-native payload. The truth-table enumeration is
 * capped at 10 distinct variables (2^10 = 1024 rows), so cells never legitimately
 * exceed that; circuits are hand-built and small. These `.max()` limits reject
 * megabyte-scale `submit` frames at the contract boundary before the agent
 * persists/logs them for replay (a malformed/abusive client otherwise gets an
 * unbounded write). Generous vs. real L1 use, well below an abuse threshold.
 */
const MAX_CELLS = 1024;
const MAX_NODES = 512;
const MAX_EDGES = 512;
const MAX_EXPRESSION_LEN = 2000;
const MAX_SOURCE_LEN = 4000;

export const RepSubmission = z.discriminatedUnion('rep', [
  z.object({
    rep: z.literal('truth_table'),
    cells: z.array(z.union([z.literal(0), z.literal(1)])).max(MAX_CELLS),
  }),
  z.object({
    rep: z.literal('circuit'),
    expression: z.string().max(MAX_EXPRESSION_LEN),
    nodes: z.array(z.record(z.string(), z.unknown())).max(MAX_NODES),
    edges: z.array(z.record(z.string(), z.unknown())).max(MAX_EDGES),
  }),
  z.object({
    rep: z.literal('pseudocode'),
    expression: z.string().max(MAX_EXPRESSION_LEN),
    source: z.string().max(MAX_SOURCE_LEN),
  }),
]);
export type RepSubmission = z.infer<typeof RepSubmission>;

/** Inbound: client → agent. */
export const ClientEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session_start'),
    sessionId: SessionId,
    lessonId: z.number(),
  }),
  z.object({
    kind: z.literal('submit'),
    sessionId: SessionId,
    itemId: z.string(),
    /** The learner's submission as a canonical Boolean expression string. */
    submission: z.string().max(MAX_EXPRESSION_LEN),
    /** Optional rep-native submission for replay/agent context (append-only
     *  extension; absent for callers that don't supply it). */
    repSubmission: RepSubmission.optional(),
    /** The client-computed correctness verdict (ADR-008: the truth-table compare
     *  runs client-side in <5ms and the learner sees it before the agent decides
     *  what to mount). Optional + append-only: the server still treats the
     *  canonical `submission` as authoritative and never trusts this flag for
     *  correctness, but the agent reads it to choose its next move (e.g. a second
     *  wrong attempt on an item → `simpler_item`, not `next_practice_item`). */
    correct: z.boolean().optional(),
    /** Milliseconds the learner spent on the item before submitting (client clock,
     *  append-only optional). The rule gate's response-time band (2–60s, ADR-011)
     *  reads this; an absent value is simply not counted toward the band. Bounded
     *  to a sane day so a bad client clock can't poison the median. */
    responseTimeMs: z.number().int().nonnegative().max(86_400_000).optional(),
  }),
  z.object({
    kind: z.literal('request_hint'),
    sessionId: SessionId,
    itemId: z.string(),
  }),
  z.object({
    kind: z.literal('transfer_submitted'),
    sessionId: SessionId,
    itemId: z.string(),
    submission: z.string().max(MAX_EXPRESSION_LEN),
    /** Milliseconds the learner spent on the transfer item before submitting (client
     *  clock, append-only optional — mirrors `submit.responseTimeMs`). Counter-metric 4
     *  (dependency check, F-21) folds transfer time-to-correct against practice
     *  time-to-correct; without this the transfer arm is structurally unmeasurable. An
     *  absent value is simply not counted (older clients / replays). Bounded to a sane
     *  day so a bad client clock can't poison the median. */
    responseTimeMs: z.number().int().nonnegative().max(86_400_000).optional(),
  }),
  z.object({
    kind: z.literal('explain_back_recording_ended'),
    sessionId: SessionId,
    targetItemId: z.string(),
    /** The learner's spoken explanation, transcribed. Capped to MAX_SOURCE_LEN like
     *  every other learner-controlled string in this contract (the server also feeds
     *  it into the LLM judge prompt). Narrowing an existing optional-shaped field is
     *  append-compatible: a real ~15s utterance is a few hundred chars, far under the
     *  cap, and the 64KB WS frame cap already bounded it — this removes the reliance
     *  on the frame cap as the only bound and matches the "cap every learner string"
     *  convention. */
    transcript: z.string().max(MAX_SOURCE_LEN),
    durationMs: z.number(),
  }),
  z.object({
    kind: z.literal('learner_question'),
    sessionId: SessionId,
    question: z.string().max(MAX_SOURCE_LEN),
  }),
  z.object({
    kind: z.literal('session_end'),
    sessionId: SessionId,
  }),
  // Observability beacons (append-only NEW event kinds). Pure telemetry — the
  // server ACKs them and never runs the inner agent / `proposeMove` on them.
  // Persistence + aggregation are owned by the observability/metrics workstreams;
  // this contract only fixes the wire shape so a beacon validates at the boundary.
  //
  // `ui_mount` — fired by the client each time it mounts a `ComponentSpec`, used to
  // measure UI churn (mounts per minute, by phase). `componentKind` is a free string
  // (not the locked `ComponentSpec` `kind` enum) so a future component the server
  // doesn't yet know about still produces a valid beacon; bounded like every
  // learner-controlled string in this contract.
  z.object({
    kind: z.literal('ui_mount'),
    sessionId: SessionId,
    componentKind: z.string().max(120),
    phase: z.string().max(60),
  }),
  // `intelligibility_response` — the learner's yes/no/skip answer to an
  // "was this clear?" intelligibility probe on a just-mounted component. Folds into
  // the intelligibility metric. `mountedKind` echoes the component being rated.
  z.object({
    kind: z.literal('intelligibility_response'),
    sessionId: SessionId,
    mountedKind: z.string().max(120),
    answer: z.enum(['yes', 'no', 'skip']),
  }),
  // I3 barrier (F-15): the L1→L2 lesson advance. Append-only NEW event kind (the
  // advance is NOT `transition.to`, which is a `PhaseName`/intra-lesson enum, and
  // NOT a new `Action` variant). Handled as a server reflex that re-derives L1
  // mastery server-side (the earned-it guard) before writing
  // `sessions.lessonProgress` and deterministically mounting L2's first item on the
  // SAME sessionId (so prior-lesson `learner_state` survives for F-14's recall).
  z.object({
    kind: z.literal('advance_lesson'),
    sessionId: SessionId,
    toLessonId: z.number(),
  }),
  // ADR-012 stretch — the free-build playground. Four APPEND-ONLY new event kinds
  // (no existing kind's payload is reshaped). The playground has no authored answer
  // key: the learner supplies a `targetExpression` and rep-native submissions, scored
  // server-side via `playgroundEquivalence` (caps BOTH sides).
  z.object({
    kind: z.literal('enter_playground'),
    sessionId: SessionId,
  }),
  z.object({
    kind: z.literal('playground_submit'),
    sessionId: SessionId,
    /** The learner's chosen target expression. Capped like every learner string. */
    targetExpression: z.string().max(MAX_EXPRESSION_LEN),
    /** The rep-native submissions the learner built; each rep is optional (the
     *  learner may work in a subset of the visible reps). Reuses the existing
     *  `RepSubmission` shapes (bounded cells / nodes / source). */
    submissions: z.object({
      truth_table: RepSubmission.optional(),
      circuit: RepSubmission.optional(),
      pseudocode: RepSubmission.optional(),
    }),
  }),
  z.object({
    kind: z.literal('playground_request_scaffold'),
    sessionId: SessionId,
    targetExpression: z.string().max(MAX_EXPRESSION_LEN),
    /** An optional free-text question the learner asks while building. */
    learnerQuestion: z.string().max(MAX_SOURCE_LEN).optional(),
  }),
  z.object({
    kind: z.literal('exit_playground'),
    sessionId: SessionId,
  }),
  // I7/F-27 (ADR-015, D1): the learner's "Got it — continue" advance of the opening
  // intro sequence. APPEND-ONLY new event kind (NOT a re-emitted `session_start` and
  // NOT an `Action` variant): the server's `openingMove` derives the next intro stage
  // from the session's mount history, so the advance is a distinct, deterministic
  // signal. Both the heuristic and OpenAI providers branch on it (menu-lockstep).
  z.object({
    kind: z.literal('intro_advance'),
    sessionId: SessionId,
  }),
  // I7/F-30 (ADR-016, D10): a spoken-turn TRIGGER only — it carries NO transcript /
  // question field. The answered text is the SERVER-captured utterance
  // (`latestLearnerUtteranceFor(boundSessionId)`), never a client-sent string —
  // reusing `learner_question` is unsafe precisely because its required `question`
  // string would be the client-trusted path. Empty server capture → honest no-op
  // (`ack`), never an answer to a client string.
  z.object({
    kind: z.literal('spoken_turn'),
    sessionId: SessionId,
  }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

/** Outbound: agent → client. */
export const ServerMessage = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('action'),
    sessionId: SessionId,
    action: Action,
  }),
  z.object({
    kind: z.literal('ack'),
    sessionId: SessionId,
    /** Echoes the inbound event kind this acknowledges. */
    event: z.string(),
  }),
  z.object({
    kind: z.literal('error'),
    sessionId: SessionId.optional(),
    message: z.string(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
