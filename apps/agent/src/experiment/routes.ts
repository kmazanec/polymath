import type http from 'node:http';
import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { scoreEquivalence } from '@polymath/booleans';
import type { Db } from '../db/client.js';
import {
  experimentSubjects,
  followupResults,
  postTestResults,
  preTestResults,
  sessions,
  subjectItemUsage,
  transferBank,
} from '../db/schema.js';
import { conditionOrderForOrdinal } from './counterbalance.js';
import { buildCsv, fractionCorrect, type SubjectCsvRow } from './csv.js';
import {
  differentSurfaceRep,
  EXPERIMENT_LESSON_ID,
  FOLLOWUP_N,
  InsufficientItemsError,
  POSTTEST_N,
  PRETEST_N,
  sampleUnusedItems,
  type ExperimentBankItem,
} from './items.js';

/**
 * F-17 REST endpoints (the experiment runner backend). Mirrors
 * `handleRealtimeSession`'s body-read/validate/respond shape; the server registers
 * each handler as an `if (method && pathname)` block before the 404.
 *
 * Integrity / fairness notes baked in here:
 *  - Scoring is ALWAYS the shared `scoreEquivalence` (var cap + parse-error→false);
 *    a baseline-chat learner types free text, so the parse-error guard is mandatory.
 *  - Item exclusion is enforced twice: the application filter (`sampleUnusedItems`
 *    over the subject's recorded usage) AND the composite-PK on `subject_item_usage`
 *    (a DB-level backstop — the same item can't be inserted twice for a subject).
 *  - The follow-up token is the random `followup_token` column, never the subject
 *    id; expiry is read from Postgres so it survives redeploys, and a NULL/expired
 *    window fails CLOSED (410), never open.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A small response shape the server's `if`-blocks emit via `sendJson`. */
export interface RouteResult {
  status: number;
  body: unknown;
}

/** A CSV response (streamed by the server as text/csv). */
export interface CsvResult {
  status: number;
  csv: string;
}

/** The dependencies a route needs (just the DB; scoring is pure). */
export interface ExperimentRouteDeps {
  db: Db;
}

/** Map a thrown body-read reason to its 4xx status (shared with the realtime route
 *  semantics). */
function bodyErrorStatus(reason: string): number {
  return reason === 'body too large' ? 413 : reason === 'body timeout' ? 408 : 400;
}

/** Load the L1 experiment bank rows (the only fully-authored set). */
async function loadExperimentBank(db: Db): Promise<ExperimentBankItem[]> {
  const rows = await db
    .select({
      itemId: transferBank.itemId,
      targetExpression: transferBank.targetExpression,
      targetRep: transferBank.targetRep,
      hiddenReps: transferBank.hiddenReps,
    })
    .from(transferBank)
    .where(eq(transferBank.lessonId, EXPERIMENT_LESSON_ID));
  return rows.map((r) => ({
    itemId: r.itemId,
    targetExpression: r.targetExpression,
    targetRep: r.targetRep,
    hiddenReps: r.hiddenReps as string[],
  }));
}

/** Every item id the subject has already been exposed to (the exclusion set,
 *  sourced from the durable usage table — across phases). */
async function usedItemSet(db: Db, subjectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: subjectItemUsage.itemId })
    .from(subjectItemUsage)
    .where(eq(subjectItemUsage.subjectId, subjectId));
  return new Set(rows.map((r) => r.itemId));
}

/** The set of item ids that were actually SERVED to this subject in a given phase
 *  (recorded by the phase's `start` handler in `subject_item_usage`). A submit may
 *  only score items in this set — it is the server-derived served-item guard that
 *  stops a subject-reachable submit from scoring arbitrary/forged/padded itemIds
 *  into the FROZEN CSV (the integrity signal F-21 consumes). */
async function servedItemSet(db: Db, subjectId: string, phase: string): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: subjectItemUsage.itemId })
    .from(subjectItemUsage)
    .where(and(eq(subjectItemUsage.subjectId, subjectId), eq(subjectItemUsage.phase, phase)));
  return new Set(rows.map((r) => r.itemId));
}

/**
 * Validate a set of submitted responses against the server-recorded served set:
 *  - every submitted itemId must be one that was actually served (no forged ids),
 *  - the DISTINCT submitted ids must exactly equal the served set (no padding with
 *    duplicates, no short/partial submit) — i.e. count == |served| == phase N.
 *  Returns an error RouteResult to short-circuit on, or null when valid.
 *
 * This is the data-integrity boundary for AC#2/#3/#4: `fractionCorrect` is computed
 * over exactly the inserted rows, so WHICH items count must be server-constrained,
 * not request-body-determined. (`scoreEquivalence` guards correctness-vs-DoS but
 * does not constrain the item set.)
 */
function validateAgainstServed(
  responses: { itemId: string }[],
  served: ReadonlySet<string>,
): RouteResult | null {
  const submitted = new Set(responses.map((r) => r.itemId));
  for (const r of responses) {
    if (!served.has(r.itemId)) {
      return { status: 400, body: { error: 'itemId was not served for this phase' } };
    }
  }
  // Exact-cover the served set: no duplicates (distinct < total) and no missing
  // items (distinct < served). Equality on both sides pins the count to phase N.
  if (submitted.size !== responses.length || submitted.size !== served.size) {
    return { status: 400, body: { error: 'responses must cover exactly the served items once each' } };
  }
  return null;
}

/** Has this subject already submitted results for `phase`? Idempotency / one-shot
 *  backstop: a re-POST (double-click, dropped-response retry, re-opened followup
 *  URL) must NOT append a second set of rows — `fractionCorrect` would then average
 *  over the union and silently corrupt the frozen score. Counted from the result
 *  table directly (not the bounded event log) so it can only ever grow. */
async function preTestAlreadySubmitted(db: Db, subjectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: preTestResults.id })
    .from(preTestResults)
    .where(eq(preTestResults.subjectId, subjectId))
    .limit(1);
  return rows.length > 0;
}

async function postTestAlreadySubmitted(db: Db, subjectId: string, condition: string): Promise<boolean> {
  const rows = await db
    .select({ id: postTestResults.id })
    .from(postTestResults)
    .where(and(eq(postTestResults.subjectId, subjectId), eq(postTestResults.condition, condition)))
    .limit(1);
  return rows.length > 0;
}

async function followupAlreadySubmitted(db: Db, subjectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: followupResults.id })
    .from(followupResults)
    .where(eq(followupResults.subjectId, subjectId))
    .limit(1);
  return rows.length > 0;
}

/** Look up a subject row by id (or null). */
async function findSubject(db: Db, subjectId: string) {
  if (!UUID_RE.test(subjectId)) return null;
  const rows = await db
    .select()
    .from(experimentSubjects)
    .where(eq(experimentSubjects.id, subjectId))
    .limit(1);
  return rows[0] ?? null;
}

/** Score a learner submission against a bank item's canonical expression via the
 *  SHARED var-capped scorer (no parallel scoring path). */
function scoreItem(bank: ExperimentBankItem[], itemId: string, submission: string): boolean {
  const item = bank.find((b) => b.itemId === itemId);
  if (!item) return false;
  return scoreEquivalence(submission, item.targetExpression);
}

/** Postgres unique-violation SQLSTATE. The result-table one-shot uniqueness
 *  constraints (migration 0003) raise this when a concurrent re-submit races past
 *  the non-atomic application-level already-submitted check (MR !7). */
const PG_UNIQUE_VIOLATION = '23505';

/** True if an error is a Postgres unique-constraint violation (drizzle surfaces the
 *  driver error with a `.code`). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

/** POST /api/experiment/subjects — create a subject, assign counterbalanced order
 *  from the creation ordinal, mint a random follow-up token. */
export async function createSubject(deps: ExperimentRouteDeps): Promise<RouteResult> {
  // Counterbalance from the ordinal (count+1) — UUIDs have no odd/even.
  const countRows = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(experimentSubjects);
  const ordinal = (countRows[0]?.n ?? 0) + 1;
  const conditionOrder = conditionOrderForOrdinal(ordinal);
  // The follow-up token is a SEPARATE random secret, never the subject id (a
  // sequential/guessable id would let anyone enumerate other subjects' follow-ups).
  const followupToken = randomBytes(24).toString('hex');

  const rows = await deps.db
    .insert(experimentSubjects)
    .values({ conditionOrder, followupToken })
    .returning({
      id: experimentSubjects.id,
      conditionOrder: experimentSubjects.conditionOrder,
      followupToken: experimentSubjects.followupToken,
    });
  const row = rows[0]!;
  return {
    status: 201,
    body: {
      subjectId: row.id,
      conditionOrder: row.conditionOrder,
      followupToken: row.followupToken,
    },
  };
}

/** Shared start-a-test helper: pick `n` unused items, record them in usage (DB
 *  backstop), return the items to present (canonical expression withheld). */
async function startTest(
  deps: ExperimentRouteDeps,
  subjectId: string,
  n: number,
  phase: string,
): Promise<RouteResult> {
  const subject = await findSubject(deps.db, subjectId);
  if (!subject) return { status: 404, body: { error: 'unknown subject' } };

  const bank = await loadExperimentBank(deps.db);

  // IDEMPOTENT START (MR !7): a second start for the SAME phase must NOT sample +
  // insert another `n` usage rows. That would grow `servedItemSet` past `n`, so the
  // subsequent submit's "responses must cover exactly the served items once each"
  // guard could never be satisfied and the subject would be soft-locked out of the
  // phase. Instead, re-serve the items already recorded for this phase. (A double
  // click / retried request / re-opened tab is the common trigger.)
  const alreadyServed = await servedItemSet(deps.db, subjectId, phase);
  if (alreadyServed.size > 0) {
    const items = bank.filter((b) => alreadyServed.has(b.itemId));
    return {
      status: 200,
      body: {
        subjectId,
        items: items.map((i) => ({ itemId: i.itemId, targetRep: i.targetRep, hiddenReps: i.hiddenReps })),
      },
    };
  }

  const used = await usedItemSet(deps.db, subjectId);
  let items: ExperimentBankItem[];
  try {
    items = sampleUnusedItems(bank, used, n);
  } catch (err) {
    if (err instanceof InsufficientItemsError) {
      return { status: 409, body: { error: err.message } };
    }
    throw err;
  }

  // Record usage now (the composite PK backstops AC#6 — these items can never be
  // served to this subject again, even in a later phase).
  await deps.db
    .insert(subjectItemUsage)
    .values(items.map((i) => ({ subjectId, itemId: i.itemId, phase })))
    .onConflictDoNothing();

  return {
    status: 200,
    body: {
      subjectId,
      items: items.map((i) => ({ itemId: i.itemId, targetRep: i.targetRep, hiddenReps: i.hiddenReps })),
    },
  };
}

/** POST /api/experiment/subjects/:id/pretest/start */
export function startPretest(deps: ExperimentRouteDeps, subjectId: string): Promise<RouteResult> {
  return startTest(deps, subjectId, PRETEST_N, 'pretest');
}

/** Validate a submit body: { responses: [{ itemId, submission }] }. */
function parseResponses(body: unknown): { itemId: string; submission: string }[] | null {
  const responses = (body as { responses?: unknown } | null)?.responses;
  if (!Array.isArray(responses)) return null;
  const out: { itemId: string; submission: string }[] = [];
  for (const r of responses) {
    const itemId = (r as { itemId?: unknown })?.itemId;
    const submission = (r as { submission?: unknown })?.submission;
    if (typeof itemId !== 'string' || typeof submission !== 'string') return null;
    out.push({ itemId, submission });
  }
  return out;
}

/** POST /api/experiment/subjects/:id/pretest/submit */
export async function submitPretest(
  deps: ExperimentRouteDeps,
  subjectId: string,
  body: unknown,
): Promise<RouteResult> {
  const subject = await findSubject(deps.db, subjectId);
  if (!subject) return { status: 404, body: { error: 'unknown subject' } };
  const responses = parseResponses(body);
  if (!responses || responses.length === 0) {
    return { status: 400, body: { error: 'responses[] required' } };
  }
  // One-shot: a re-submit must not append a second set of rows.
  if (await preTestAlreadySubmitted(deps.db, subjectId)) {
    return { status: 409, body: { error: 'pretest already submitted for this subject' } };
  }
  // Served-set guard: only score items this subject was actually served, exactly once.
  const served = await servedItemSet(deps.db, subjectId, 'pretest');
  const invalid = validateAgainstServed(responses, served);
  if (invalid) return invalid;

  const bank = await loadExperimentBank(deps.db);
  const scored = responses.map((r) => ({
    subjectId,
    itemId: r.itemId,
    submission: r.submission,
    correct: scoreItem(bank, r.itemId, r.submission),
  }));
  try {
    await deps.db.insert(preTestResults).values(scored);
  } catch (err) {
    // Atomic backstop (MR !7): a concurrent submit raced past the check above and
    // inserted first; the unique(subject_id,item_id) rejects this one → 409.
    if (isUniqueViolation(err)) {
      return { status: 409, body: { error: 'pretest already submitted for this subject' } };
    }
    throw err;
  }
  return {
    status: 201,
    body: { subjectId, scored: scored.map((s) => ({ itemId: s.itemId, correct: s.correct })) },
  };
}

/** POST /api/experiment/subjects/:id/posttest/start */
export function startPosttest(deps: ExperimentRouteDeps, subjectId: string): Promise<RouteResult> {
  return startTest(deps, subjectId, POSTTEST_N, 'posttest');
}

/** POST /api/experiment/subjects/:id/posttest/submit — body adds a `condition`
 *  ('polymath' | 'baseline'); after the 2nd condition's post-test the follow-up
 *  window opens (expires_at = now + 48h). */
export async function submitPosttest(
  deps: ExperimentRouteDeps,
  subjectId: string,
  body: unknown,
): Promise<RouteResult> {
  const subject = await findSubject(deps.db, subjectId);
  if (!subject) return { status: 404, body: { error: 'unknown subject' } };
  const condition = (body as { condition?: unknown } | null)?.condition;
  if (condition !== 'polymath' && condition !== 'baseline') {
    return { status: 400, body: { error: "condition must be 'polymath' or 'baseline'" } };
  }
  const responses = parseResponses(body);
  if (!responses || responses.length === 0) {
    return { status: 400, body: { error: 'responses[] required' } };
  }
  // One-shot PER condition: design (ii) shares one held-out item set across both
  // arms, so each arm's post-test may be submitted exactly once.
  if (await postTestAlreadySubmitted(deps.db, subjectId, condition)) {
    return { status: 409, body: { error: `posttest already submitted for condition '${condition}'` } };
  }
  // Served-set guard: the post-test items were recorded under phase 'posttest';
  // both arms score against that same shared set.
  const served = await servedItemSet(deps.db, subjectId, 'posttest');
  const invalid = validateAgainstServed(responses, served);
  if (invalid) return invalid;

  const bank = await loadExperimentBank(deps.db);
  const scored = responses.map((r) => ({
    subjectId,
    condition,
    itemId: r.itemId,
    submission: r.submission,
    correct: scoreItem(bank, r.itemId, r.submission),
  }));
  try {
    await deps.db.insert(postTestResults).values(scored);
  } catch (err) {
    // Atomic backstop (MR !7): unique(subject_id,condition,item_id) — a concurrent
    // same-condition re-submit that raced the check above → 409.
    if (isUniqueViolation(err)) {
      return { status: 409, body: { error: `posttest already submitted for condition '${condition}'` } };
    }
    throw err;
  }

  // Open the follow-up window once BOTH conditions' post-tests are recorded.
  const conditionsDone = await deps.db
    .select({ condition: postTestResults.condition })
    .from(postTestResults)
    .where(eq(postTestResults.subjectId, subjectId))
    .groupBy(postTestResults.condition);
  if (conditionsDone.length >= 2 && subject.followupExpiresAt === null) {
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await deps.db
      .update(experimentSubjects)
      .set({ followupExpiresAt: expiresAt })
      .where(eq(experimentSubjects.id, subjectId));
  }

  return {
    status: 201,
    body: { subjectId, condition, scored: scored.map((s) => ({ itemId: s.itemId, correct: s.correct })) },
  };
}

/** Resolve a follow-up token to its subject IF the window is open; else null +
 *  a reason. Reads expiry from Postgres so it survives redeploys; a NULL window
 *  (post-tests not done) or a past expiry fails CLOSED. */
async function resolveFollowupToken(
  db: Db,
  token: string,
): Promise<{ subjectId: string } | { error: string; status: number }> {
  const rows = await db
    .select()
    .from(experimentSubjects)
    .where(eq(experimentSubjects.followupToken, token))
    .limit(1);
  const subject = rows[0];
  if (!subject) return { error: 'unknown follow-up token', status: 404 };
  // Fail CLOSED: a follow-up before both post-tests have opened the window, or
  // after the 48h expiry, is gone (410) — never served open.
  if (subject.followupExpiresAt === null) return { error: 'follow-up not yet available', status: 410 };
  if (subject.followupExpiresAt.getTime() < Date.now()) {
    return { error: 'follow-up expired', status: 410 };
  }
  return { subjectId: subject.id };
}

/** Derive — SERVER-SIDE and deterministically — the follow-up item ids for a
 *  subject. The follow-up REUSES items the subject already saw (design (ii)): the
 *  bank can't supply new items, so it's a same-item / different-rep transfer. The
 *  served set is the first `FOLLOWUP_N` seen ids in id order. This is the single
 *  source of truth shared by `startFollowup` (what to present) and `submitFollowup`
 *  (what may be scored) — a subject must not be able to score any other itemId. */
async function followupServedIds(db: Db, subjectId: string): Promise<string[]> {
  const usedRows = await db
    .select({ itemId: subjectItemUsage.itemId })
    .from(subjectItemUsage)
    .where(eq(subjectItemUsage.subjectId, subjectId));
  const seenIds = usedRows.map((r) => r.itemId).sort((a, b) => a.localeCompare(b));
  return seenIds.slice(0, FOLLOWUP_N);
}

/** GET /api/experiment/followup/:token — present 2 of the subject's already-seen
 *  items in a DIFFERENT surface form (design (ii): the bank can't supply new
 *  items, so the follow-up is a same-item / different-rep transfer). */
export async function startFollowup(deps: ExperimentRouteDeps, token: string): Promise<RouteResult> {
  const resolved = await resolveFollowupToken(deps.db, token);
  if ('error' in resolved) return { status: resolved.status, body: { error: resolved.error } };
  const subjectId = resolved.subjectId;

  const bank = await loadExperimentBank(deps.db);
  const chosen = await followupServedIds(deps.db, subjectId);
  const items = chosen
    .map((id) => bank.find((b) => b.itemId === id))
    .filter((b): b is ExperimentBankItem => b !== undefined)
    .map((b) => ({ itemId: b.itemId, targetRep: differentSurfaceRep(b) }));
  return { status: 200, body: { subjectId, items } };
}

/** POST /api/experiment/followup/:token — score the 2 follow-up responses. The
 *  request body carries the responses + each item's `targetRepOverride`. */
export async function submitFollowup(
  deps: ExperimentRouteDeps,
  token: string,
  body: unknown,
): Promise<RouteResult> {
  const resolved = await resolveFollowupToken(deps.db, token);
  if ('error' in resolved) return { status: resolved.status, body: { error: resolved.error } };
  const subjectId = resolved.subjectId;

  const responses = (body as { responses?: unknown } | null)?.responses;
  if (!Array.isArray(responses) || responses.length === 0) {
    return { status: 400, body: { error: 'responses[] required' } };
  }
  // One-shot: the follow-up URL is held by the SUBJECT (an untrusted actor) and
  // can be re-opened any number of times in the window — a re-submit must not
  // append rows and inflate followup_score (the metric F-21's dashboard reads).
  if (await followupAlreadySubmitted(deps.db, subjectId)) {
    return { status: 409, body: { error: 'follow-up already submitted for this subject' } };
  }
  // Parse responses first (so the served-set check sees well-typed itemIds).
  const parsed = parseResponses(body);
  if (!parsed) {
    return { status: 400, body: { error: 'each response needs itemId + submission' } };
  }
  // Served-set guard: restrict scored items to the 2 items derived server-side as
  // `startFollowup` does (NOT any itemId in the bank), exactly once each. Without
  // this, a subject could POST extra correct itemIds to forge an inflated score.
  const served = new Set(await followupServedIds(deps.db, subjectId));
  const invalid = validateAgainstServed(parsed, served);
  if (invalid) return invalid;

  const bank = await loadExperimentBank(deps.db);
  const scored: {
    subjectId: string;
    itemId: string;
    targetRepOverride: string;
    submission: string;
    correct: boolean;
  }[] = [];
  for (const r of responses) {
    const itemId = (r as { itemId?: unknown }).itemId;
    const submission = (r as { submission?: unknown }).submission;
    const targetRepOverride = (r as { targetRepOverride?: unknown }).targetRepOverride;
    if (typeof itemId !== 'string' || typeof submission !== 'string') {
      return { status: 400, body: { error: 'each response needs itemId + submission' } };
    }
    const item = bank.find((b) => b.itemId === itemId);
    scored.push({
      subjectId,
      itemId,
      targetRepOverride:
        typeof targetRepOverride === 'string'
          ? targetRepOverride
          : item
            ? differentSurfaceRep(item)
            : 'unknown',
      submission,
      correct: scoreItem(bank, itemId, submission),
    });
  }
  try {
    await deps.db.insert(followupResults).values(scored);
  } catch (err) {
    // Atomic backstop (MR !7): unique(subject_id,item_id) — a concurrent re-submit
    // (e.g. the 24h follow-up URL opened twice) that raced the check above → 409.
    if (isUniqueViolation(err)) {
      return { status: 409, body: { error: 'follow-up already submitted for this subject' } };
    }
    throw err;
  }
  return {
    status: 201,
    body: { subjectId, scored: scored.map((s) => ({ itemId: s.itemId, correct: s.correct })) },
  };
}

/** POST /api/experiment/subjects/:id/session — link a created session (Polymath
 *  or baseline arm) to the subject so the CSV joins automatically. Body:
 *  { sessionId, arm: 'polymath' | 'baseline' }. Also stamps `sessions.subject_id`
 *  (the barrier column) so an event-level query can attribute the session. */
export async function linkSession(
  deps: ExperimentRouteDeps,
  subjectId: string,
  body: unknown,
): Promise<RouteResult> {
  const subject = await findSubject(deps.db, subjectId);
  if (!subject) return { status: 404, body: { error: 'unknown subject' } };
  const sessionId = (body as { sessionId?: unknown } | null)?.sessionId;
  const arm = (body as { arm?: unknown } | null)?.arm;
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
    return { status: 400, body: { error: 'sessionId must be a UUID' } };
  }
  if (arm !== 'polymath' && arm !== 'baseline') {
    return { status: 400, body: { error: "arm must be 'polymath' or 'baseline'" } };
  }
  // The session must exist (a forged/unknown id can't be linked).
  const sess = await deps.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (sess.length === 0) return { status: 404, body: { error: 'unknown session' } };

  await deps.db
    .update(experimentSubjects)
    .set(
      arm === 'polymath'
        ? { polymathSessionId: sessionId }
        : { baselineSessionId: sessionId },
    )
    .where(eq(experimentSubjects.id, subjectId));
  // Stamp the barrier linkage column on the session too.
  await deps.db.update(sessions).set({ subjectId }).where(eq(sessions.id, sessionId));
  return { status: 200, body: { subjectId, sessionId, arm } };
}

/** PATCH/POST a subject's qualitative reflection (AC#5 notes column). */
export async function setNotes(
  deps: ExperimentRouteDeps,
  subjectId: string,
  body: unknown,
): Promise<RouteResult> {
  const subject = await findSubject(deps.db, subjectId);
  if (!subject) return { status: 404, body: { error: 'unknown subject' } };
  const notes = (body as { notes?: unknown } | null)?.notes;
  if (typeof notes !== 'string') return { status: 400, body: { error: 'notes (string) required' } };
  await deps.db
    .update(experimentSubjects)
    .set({ qualitativeNotes: notes })
    .where(eq(experimentSubjects.id, subjectId));
  return { status: 200, body: { subjectId } };
}

/** Build the per-subject CSV row by joining the result tables (in-memory; no
 *  on-disk CSV). The post-test fraction is split by condition. */
async function buildSubjectRow(db: Db, subjectId: string): Promise<SubjectCsvRow | null> {
  const subject = await findSubject(db, subjectId);
  if (!subject) return null;
  const [pre, post, followup] = await Promise.all([
    db.select({ correct: preTestResults.correct }).from(preTestResults).where(eq(preTestResults.subjectId, subjectId)),
    db
      .select({ correct: postTestResults.correct, condition: postTestResults.condition })
      .from(postTestResults)
      .where(eq(postTestResults.subjectId, subjectId)),
    db
      .select({ correct: followupResults.correct })
      .from(followupResults)
      .where(eq(followupResults.subjectId, subjectId)),
  ]);
  const polymathPost = post.filter((p) => p.condition === 'polymath');
  const baselinePost = post.filter((p) => p.condition === 'baseline');
  return {
    subjectId: subject.id,
    conditionOrder: subject.conditionOrder,
    preTestScore: fractionCorrect(pre),
    polymathSessionId: subject.polymathSessionId,
    polymathPostScore: fractionCorrect(polymathPost),
    baselineSessionId: subject.baselineSessionId,
    baselinePostScore: fractionCorrect(baselinePost),
    followupScore: fractionCorrect(followup),
    qualitativeNotes: subject.qualitativeNotes,
  };
}

/** GET /api/experiment/subjects/:id/export.csv — stream the FROZEN 9-column CSV
 *  for one subject, built in-memory from Postgres (no on-disk file). */
export async function exportSubjectCsv(deps: ExperimentRouteDeps, subjectId: string): Promise<CsvResult> {
  const row = await buildSubjectRow(deps.db, subjectId);
  if (!row) return { status: 404, csv: '' };
  return { status: 200, csv: buildCsv([row]) };
}

export { bodyErrorStatus, UUID_RE as EXPERIMENT_UUID_RE };
