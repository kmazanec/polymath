import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
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
  /** Privacy posture (ADR-012): when a session ends (server-side WS-close detection),
   *  its data is scheduled for deletion at `endedAt + grace`. The boot/interval sweep
   *  hard-deletes the session's events + learner_state once `now >= deleteAfter`.
   *  Fail-closed: a session that ends is ALWAYS scheduled (default-delete), and a
   *  truncated/absent stamp is still swept once past grace. Nullable + additive (no
   *  backfill): rows with NULL are simply not yet scheduled. */
  deleteAfter: timestamp('delete_after', { withTimezone: true }),
  lessonProgress: jsonb('lesson_progress'),
  /** I3/I4 barrier (D3): which app owns this session. NULL = polymath (the default,
   *  back-compatible), 'baseline' = the F-16 chat-baseline experiment arm. Polymath's
   *  analytics/replay/counter-metric queries filter by sessionId only, so baseline
   *  rows would silently fold in without this discriminator — F-16/F-17/F-21 filter
   *  on it explicitly. Nullable + additive (no backfill). */
  app: text('app'),
  /** I3/I4 barrier (D3): the experiment subject this session belongs to (F-17
   *  linkage so the CSV joins sessions→subject automatically rather than via
   *  hand-pasted UUIDs). Nullable; a soft reference (F-17 owns the
   *  `experiment_subjects` table + may add the FK when it creates it). */
  subjectId: uuid('subject_id'),
  /** ADR-012 stretch: a random, unguessable token for the public tutor-handoff
   *  share URL (the `followup_token` precedent — a per-request-random token, NOT the
   *  session id, so the share route is exempt from operator auth and an id is never
   *  enumerable). Nullable + additive (minted only when a handoff is shared); a
   *  missing/invalid token fails closed at the route. UNIQUE. */
  shareToken: text('share_token').unique(),
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
  /** I3/I4 barrier (D3): the app this event belongs to. NULL = polymath, 'baseline'
   *  = F-16. Mirrors `sessions.app` so an event-level query can filter without a
   *  join. Nullable + additive. */
  app: text('app'),
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

/**
 * F-17 experiment scaffolding (ADR-011 within-subject counterbalanced study).
 *
 * Source of truth for the experiment is Postgres (the CSV export streams from
 * these tables — nothing persists to disk under the release-symlink deploy). The
 * four tables below + `subject_item_usage` are ADDITIVE (migration 0002, applied
 * on agent boot). The CSV column shape is FROZEN (F-21 reads it).
 */

/** One row per recruited subject. The condition order is computed from the
 *  subject's *ordinal* (count+1) at creation — odd→Polymath-first, even→
 *  baseline-first (T-17f). The follow-up URL token is a SEPARATE random column,
 *  never the subject id (a sequential/guessable id would be enumerable). */
export const experimentSubjects = pgTable('experiment_subjects', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 'polymath_first' | 'baseline_first' — stored explicitly (UUIDs have no
   *  odd/even; computed from the creation ordinal). */
  conditionOrder: text('condition_order').notNull(),
  /** AC#5: the qualitative reflection captured at session-end. */
  qualitativeNotes: text('qualitative_notes'),
  /** The Polymath-arm session (soft FK → sessions.id; linked via
   *  POST …/subjects/:id/session so the CSV joins automatically). */
  polymathSessionId: uuid('polymath_session_id').references(() => sessions.id),
  /** The baseline-arm (F-16) session. */
  baselineSessionId: uuid('baseline_session_id').references(() => sessions.id),
  /** AC#4: a random, unguessable token for the 24h follow-up URL (NOT the id). */
  followupToken: text('followup_token').notNull().unique(),
  /** AC#4: follow-up expiry — set to now+48h after the 2nd post-test. NULL until
   *  both post-tests are done (follow-up fails closed while NULL). */
  followupExpiresAt: timestamp('followup_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Schema-level half of AC#6: every item a subject is exposed to (pre/post/
 *  followup) is recorded here with a composite PK `(subject_id, item_id)`. The
 *  unique constraint BACKSTOPS the application-level exclusion filter — even a
 *  buggy/racing selector cannot serve the same item twice to a subject. */
export const subjectItemUsage = pgTable(
  'subject_item_usage',
  {
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => experimentSubjects.id),
    itemId: text('item_id').notNull(),
    /** Where the item was used: 'pretest' | 'posttest' | 'followup'. */
    phase: text('phase').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.subjectId, table.itemId] })],
);

/** AC#2: 4 pre-test responses per subject, scored against the bank canonical. */
export const preTestResults = pgTable(
  'pre_test_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => experimentSubjects.id),
    itemId: text('item_id').notNull(),
    submission: text('submission').notNull(),
    correct: boolean('correct').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // DB-level one-shot backstop (MR !7): the route-level already-submitted check is
  // not atomic under concurrency — two simultaneous submits can both see no rows and
  // both insert a full set, doubling the rows `fractionCorrect` averages over. A
  // unique(subject_id,item_id) makes the second insert raise 23505, handled as 409.
  (t) => [unique('pre_test_results_subject_item_uq').on(t.subjectId, t.itemId)],
);

/** AC#3: post-test responses. `condition` records which arm's post-test this is
 *  ('polymath' | 'baseline') — design (ii) shares ONE held-out 4-item bank across
 *  both arms, so the same item ids appear under each condition. */
export const postTestResults = pgTable(
  'post_test_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => experimentSubjects.id),
    condition: text('condition').notNull(),
    itemId: text('item_id').notNull(),
    submission: text('submission').notNull(),
    correct: boolean('correct').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One-shot backstop per CONDITION (MR !7): design (ii) shares the held-out item set
  // across both arms, so the same item id appears under each condition — the uniqueness
  // is (subject_id, condition, item_id). The 23505 on a concurrent re-submit → 409.
  (t) => [unique('post_test_results_subject_cond_item_uq').on(t.subjectId, t.condition, t.itemId)],
);

/** AC#4: 24h follow-up responses. Design (ii): the followup reuses pre/post items
 *  in a DIFFERENT surface form, recorded as `target_rep_override` (the only proxy
 *  for "different surface form" — the bank has no separate field). */
export const followupResults = pgTable(
  'followup_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => experimentSubjects.id),
    itemId: text('item_id').notNull(),
    targetRepOverride: text('target_rep_override').notNull(),
    submission: text('submission').notNull(),
    correct: boolean('correct').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One-shot backstop (MR !7): unique(subject_id,item_id); concurrent re-submit → 409.
  (t) => [unique('followup_results_subject_item_uq').on(t.subjectId, t.itemId)],
);
