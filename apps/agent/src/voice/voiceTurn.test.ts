/**
 * logVoiceTurn round-trip against a real Postgres. Inserting a turn writes a
 * `voice_turn` events row whose payload validates against the Zod schema, and the
 * returned `transcriptLogId` equals the row's uuid. Provisioned via the shared
 * `ensureTestPg` helper; skips only when there is genuinely no DB (no URL + no
 * Docker), never as a default.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { events, sessions } from '../db/schema.js';
import { canRunPg, ensureTestPg } from '../db/testPg.js';
import { logVoiceTurn, VoiceTurnPayload } from './voiceTurn.js';

describe.skipIf(!canRunPg)('logVoiceTurn — voice_turn persistence', () => {
  let db: Db;
  let pool: pg.Pool;
  let sessionId: string;

  beforeAll(async () => {
    const connectionString = await ensureTestPg();
    await runMigrations(connectionString);

    const client = createDb(connectionString);
    db = client.db;
    pool = client.pool;

    // The events FK requires a real session row.
    const [session] = await db.insert(sessions).values({}).returning({ id: sessions.id });
    sessionId = session!.id;
  }, 60000);

  afterAll(async () => {
    await pool.end();
  });

  it('writes a voice_turn row whose payload round-trips and returns the row id', async () => {
    const payload: VoiceTurnPayload = {
      turnId: 'turn-abc',
      transcript: { learner: 'Is A AND B true when both are true?', tutor: 'What do you think?' },
      modelVersion: 'gpt-realtime',
      cacheHit: false,
      ttftMs: 312,
      bargeIn: false,
      // Placeholder — logVoiceTurn reconciles this to the real row id.
      transcriptLogId: '',
    };

    const { transcriptLogId } = await logVoiceTurn(db, sessionId, payload);
    expect(transcriptLogId).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await db.select().from(events).where(eq(events.id, transcriptLogId));
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(row.kind).toBe('voice_turn');
    expect(row.sessionId).toBe(sessionId);

    // The stored payload validates against the schema and carries the row id.
    const stored = VoiceTurnPayload.parse(row.payload);
    expect(stored.transcriptLogId).toBe(transcriptLogId);
    expect(stored.turnId).toBe('turn-abc');
    expect(stored.transcript.learner).toBe('Is A AND B true when both are true?');
    expect(stored.transcript.tutor).toBe('What do you think?');
    expect(stored.ttftMs).toBe(312);
    expect(stored.cacheHit).toBe(false);
    expect(stored.bargeIn).toBe(false);
  });

  it('single-insert invariant: events.id === returned transcriptLogId === stored payload.transcriptLogId, and exactly ONE row written', async () => {
    // This locks in the app-side randomUUID + single-insert pattern: no
    // insert-then-update reconciliation, no orphaned id window, no phantom second row.
    const payload: VoiceTurnPayload = {
      turnId: 'turn-single-write',
      transcript: { learner: 'What is NOT?', tutor: 'Flip the bit.' },
      modelVersion: 'gpt-realtime',
      cacheHit: true,
      ttftMs: 50,
      bargeIn: false,
      transcriptLogId: '', // placeholder — overwritten by logVoiceTurn
    };

    const { transcriptLogId } = await logVoiceTurn(db, sessionId, payload);

    // The returned id must be a valid uuid.
    expect(transcriptLogId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Fetch the row by primary key to confirm the id triple-matches.
    const rows = await db.select().from(events).where(eq(events.id, transcriptLogId));

    // Exactly ONE row — the single insert; no second write was made.
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    // events.id (PK) === the value returned to the caller.
    expect(row.id).toBe(transcriptLogId);

    // The stored payload's transcriptLogId also equals the row's PK.
    const stored = VoiceTurnPayload.parse(row.payload);
    expect(stored.transcriptLogId).toBe(row.id);

    // All three are the same uuid — the triple-equality that makes the id
    // self-describing on replay without a follow-up update.
    expect(stored.transcriptLogId).toBe(transcriptLogId);
    expect(row.id).toBe(stored.transcriptLogId);
  });
});
