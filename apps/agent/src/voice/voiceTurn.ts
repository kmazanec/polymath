/**
 * Persistence for a single completed voice turn.
 *
 * A voice turn (one learner utterance + the tutor's spoken reply) is recorded as
 * a row in the shared `events` table with `kind:'voice_turn'` — no new table, just
 * another value in the event log's `kind` text column, so the voice channel shows
 * up in the same replayable stream as every other interaction. The persisted row's
 * uuid *is* the turn's `transcriptLogId`: the OTel span and any later audit trail
 * key off the same id, so a span attribute points straight back at the stored
 * transcript.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { events } from '../db/schema.js';
import type { Db } from '../db/client.js';

/**
 * The structured payload persisted for one voice turn. `prosody` is intentionally
 * an open record: real prosody features (pitch, energy, pace) arrive with a later
 * feature, and leaving it open avoids reshaping the stored payload then. Everything
 * the observability span needs (`modelVersion`, `cacheHit`, `ttftMs`, `bargeIn`) is
 * captured here so the row is self-describing on replay.
 */
export const VoiceTurnPayload = z.object({
  /** Stable per-turn id assigned by the bridge (distinct from the row uuid). */
  turnId: z.string(),
  transcript: z.object({
    learner: z.string().optional(),
    tutor: z.string().optional(),
  }),
  /** Open by design — prosody features are added later without a payload reshape. */
  prosody: z.record(z.unknown()).optional(),
  modelVersion: z.string(),
  cacheHit: z.boolean(),
  /** Time-to-first-token: learner-utterance-final → first tutor output, in ms. */
  ttftMs: z.number(),
  /** True when the learner barged in and interrupted the tutor mid-response. */
  bargeIn: z.boolean(),
  /** The persisted row's uuid. `logVoiceTurn` assigns it before the insert, so
   *  the stored payload and the row's own `events.id` are the same value (callers
   *  pass any placeholder; it is overwritten). */
  transcriptLogId: z.string(),
});

export type VoiceTurnPayload = z.infer<typeof VoiceTurnPayload>;

/**
 * Validate and persist a voice turn in a single write. The row id is generated
 * here (rather than letting the DB default it) so the same uuid can be embedded
 * in the stored payload *before* the insert — the OTel span, the stored
 * `transcriptLogId`, and the row's own `events.id` are then one value with no
 * follow-up update to reconcile (and no window where a failed second write would
 * orphan the id).
 */
export async function logVoiceTurn(
  db: Db,
  sessionId: string,
  payload: VoiceTurnPayload,
): Promise<{ transcriptLogId: string }> {
  const transcriptLogId = randomUUID();
  // Validate the final shape (with the real id stamped in) so a malformed payload
  // never reaches the DB.
  const validated = VoiceTurnPayload.parse({ ...payload, transcriptLogId });

  await db
    .insert(events)
    .values({ id: transcriptLogId, sessionId, kind: 'voice_turn', payload: validated });

  return { transcriptLogId };
}
