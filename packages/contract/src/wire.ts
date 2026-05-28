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
export const RepSubmission = z.discriminatedUnion('rep', [
  z.object({
    rep: z.literal('truth_table'),
    cells: z.array(z.union([z.literal(0), z.literal(1)])),
  }),
  z.object({
    rep: z.literal('circuit'),
    expression: z.string(),
    nodes: z.array(z.record(z.string(), z.unknown())),
    edges: z.array(z.record(z.string(), z.unknown())),
  }),
  z.object({
    rep: z.literal('pseudocode'),
    expression: z.string(),
    source: z.string(),
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
    submission: z.string(),
    /** Optional rep-native submission for replay/agent context (append-only
     *  extension; absent for callers that don't supply it). */
    repSubmission: RepSubmission.optional(),
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
    submission: z.string(),
  }),
  z.object({
    kind: z.literal('explain_back_recording_ended'),
    sessionId: SessionId,
    targetItemId: z.string(),
    transcript: z.string(),
    durationMs: z.number(),
  }),
  z.object({
    kind: z.literal('learner_question'),
    sessionId: SessionId,
    question: z.string(),
  }),
  z.object({
    kind: z.literal('session_end'),
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
