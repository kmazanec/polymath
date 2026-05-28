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

/** Inbound: client → agent. */
export const ClientEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session_start'),
    sessionId: z.string(),
    lessonId: z.number(),
  }),
  z.object({
    kind: z.literal('submit'),
    sessionId: z.string(),
    itemId: z.string(),
    /** The learner's submission as a canonical Boolean expression string. */
    submission: z.string(),
  }),
  z.object({
    kind: z.literal('request_hint'),
    sessionId: z.string(),
    itemId: z.string(),
  }),
  z.object({
    kind: z.literal('transfer_submitted'),
    sessionId: z.string(),
    itemId: z.string(),
    submission: z.string(),
  }),
  z.object({
    kind: z.literal('explain_back_recording_ended'),
    sessionId: z.string(),
    targetItemId: z.string(),
    transcript: z.string(),
    durationMs: z.number(),
  }),
  z.object({
    kind: z.literal('learner_question'),
    sessionId: z.string(),
    question: z.string(),
  }),
  z.object({
    kind: z.literal('session_end'),
    sessionId: z.string(),
  }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

/** Outbound: agent → client. */
export const ServerMessage = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('action'),
    sessionId: z.string(),
    action: Action,
  }),
  z.object({
    kind: z.literal('ack'),
    sessionId: z.string(),
    /** Echoes the inbound event kind this acknowledges. */
    event: z.string(),
  }),
  z.object({
    kind: z.literal('error'),
    sessionId: z.string().optional(),
    message: z.string(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
