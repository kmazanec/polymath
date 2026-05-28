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
import { eq } from 'drizzle-orm';
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
  /** The persisted row's uuid; reconciled to this row's events.id on insert. */
  transcriptLogId: z.string(),
});

export type VoiceTurnPayload = z.infer<typeof VoiceTurnPayload>;

/**
 * Validate and persist a voice turn. The `events.id` generated for the row is the
 * canonical `transcriptLogId` and is returned so the caller can stamp it onto the
 * OTel span. The caller cannot know that id before the insert, so it passes a
 * placeholder; we reconcile the stored payload to the real row id whenever they
 * differ, keeping the stored value and the returned value identical.
 */
export async function logVoiceTurn(
  db: Db,
  sessionId: string,
  payload: VoiceTurnPayload,
): Promise<{ transcriptLogId: string }> {
  // Validate up front so a malformed payload never reaches the DB.
  const validated = VoiceTurnPayload.parse(payload);

  const inserted = await db
    .insert(events)
    .values({ sessionId, kind: 'voice_turn', payload: validated })
    .returning({ id: events.id });

  const row = inserted[0];
  if (!row) {
    // Drizzle returns the inserted rows; an empty result means the insert silently
    // failed, which would otherwise hand back an undefined id.
    throw new Error('logVoiceTurn: insert returned no row');
  }
  const transcriptLogId = row.id;

  // The row's own id is the source of truth for the log id. Reconcile the stored
  // payload so a reader of the row sees the same id we hand back to the caller.
  if (validated.transcriptLogId !== transcriptLogId) {
    await db
      .update(events)
      .set({ payload: { ...validated, transcriptLogId } })
      .where(eq(events.id, transcriptLogId));
  }

  return { transcriptLogId };
}
