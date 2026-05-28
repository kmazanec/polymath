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
