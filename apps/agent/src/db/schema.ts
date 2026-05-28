import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Persistence schema (ADR-009 / ADR-010 / ADR-011). F-01 creates the tables;
 * later features populate them. `transfer_bank` is created empty (seeded in F-08)
 * and is never written to at runtime.
 */

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  lessonProgress: jsonb('lesson_progress'),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  kind: text('kind').notNull(),
  /** The full structured record (inbound event + agent decision + validation). */
  payload: jsonb('payload').notNull(),
});

export const learnerState = pgTable(
  'learner_state',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    kc: text('kc').notNull(),
    bktProbability: real('bkt_probability'),
    masteryState: text('mastery_state'),
    signals: jsonb('signals'),
  },
  // Per-session BKT state per knowledge component (ADR-009): one row per (session, kc).
  (table) => [primaryKey({ columns: [table.sessionId, table.kc] })],
);

/** Hand-curated transfer items (ADR-010 Layer 5). Created empty in F-01; seeded
 *  in F-08; never written at runtime. */
export const transferBank = pgTable('transfer_bank', {
  itemId: text('item_id').primaryKey(),
  lessonId: integer('lesson_id').notNull(),
  targetExpression: text('target_expression').notNull(),
  /** Canonical truth table, 0/1 ints, MSB-first (matches @polymath/booleans). */
  truthTable: jsonb('truth_table').notNull(),
  targetRep: text('target_rep').notNull(),
  hiddenReps: jsonb('hidden_reps').notNull(),
});

/** Validated distractors re-used to reduce LLM calls (ADR-010 distractor case). */
export const validatedDistractors = pgTable('validated_distractors', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetExpression: text('target_expression').notNull(),
  distractorExpression: text('distractor_expression').notNull(),
  truthTable: jsonb('truth_table').notNull(),
  isNearMiss: boolean('is_near_miss').notNull(),
});
