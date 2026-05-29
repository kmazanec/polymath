import { eq } from 'drizzle-orm';
import { scoreEquivalence } from '@polymath/booleans';
import type { Db } from '../db/client.js';
import { events, sessions, transferBank } from '../db/schema.js';
import { loadLesson } from '../lessons/loader.js';
import type { BaselineChatProvider, BaselineContentItem } from './chatProvider.js';
import {
  BASELINE_APP,
  type BaselineEventPayload,
  type BaselineScore,
} from './log.js';

/**
 * F-16 baseline chat service — the fixed-length L1 chat arc, server-side.
 *
 * The fair comparator is ITEM EXPOSURE, not Polymath's mastery gate (there is no
 * gate here — no statechart, no explain-back). The session is a fixed structure:
 *
 *   3 L1 content items (from lessons/1/content.json)  →  2 held-out transfer
 *   items (from transfer_bank, L1)  →  end.
 *
 * Correctness on every scored turn goes through the SHARED `scoreEquivalence`
 * (var-capped + parse-error→false) — identical to Polymath's path (ADR-011
 * fairness; CLAUDE.md DoS invariant). The current item / progress is SERVER-DERIVED
 * by folding this session's logged baseline events, never trusted from the client
 * frame (CLAUDE.md "server never trusts the client").
 */

/** The number of held-out L1 transfer items presented at session end. */
export const BASELINE_TRANSFER_COUNT = 2;

interface BaselineTransferItem {
  itemId: string;
  targetExpression: string;
}

/** A baseline session's fixed plan, recorded at creation in `session_started`. */
export interface BaselineSessionPlan {
  sessionId: string;
  lessonId: number;
  contentItems: BaselineContentItem[];
  transferItems: BaselineTransferItem[];
}

/** Public view of the next thing the learner should do (drives the SPA). */
export type BaselineProgress =
  | { phase: 'chat'; item: BaselineContentItem; itemIndex: number; itemCount: number; score: BaselineScore }
  | { phase: 'transfer'; item: { itemId: string }; itemIndex: number; itemCount: number; score: BaselineScore }
  | { phase: 'ended'; score: BaselineScore };

/** Fold this session's logged baseline events into derived progress. SERVER-SIDE
 *  truth — the client never tells us which item it's on or its score. */
function loadPayloads(rows: { payload: unknown }[]): BaselineEventPayload[] {
  return rows.map((r) => r.payload as BaselineEventPayload);
}

/** How many distinct content items have been COMPLETED (a correct expression seen). */
function completedContentItemIds(payloads: BaselineEventPayload[]): Set<string> {
  const done = new Set<string>();
  for (const p of payloads) {
    if (p.kind === 'chat_turn' && p.itemComplete) done.add(p.itemId);
  }
  return done;
}

/** Which transfer items have already been submitted. */
function submittedTransferItemIds(payloads: BaselineEventPayload[]): Set<string> {
  const done = new Set<string>();
  for (const p of payloads) if (p.kind === 'transfer_submitted') done.add(p.itemId);
  return done;
}

/** The running tally folded from logged scored turns (server-derived).
 *
 *  Counts ONE point per DISTINCT completed content item and per DISTINCT submitted
 *  transfer item — NOT one per logged turn. The baseline write paths are
 *  read-modify-write with no per-session lock, so a race (two tabs, a retried
 *  request, any client ignoring `busy`) can log two `itemComplete:true` turns for
 *  the same item; counting per-turn would inflate `correct`/`total` past the 5
 *  scorable items and corrupt the per-session score F-17/F-21 consume. De-duping by
 *  item id here makes the tally idempotent under duplicate completing turns. */
function tallyScore(payloads: BaselineEventPayload[]): BaselineScore {
  let correct = 0;
  let total = 0;
  // Distinct completed content items (reuses the same Set semantics as
  // completedContentItemIds): one point each, regardless of duplicate turns.
  const completedContent = completedContentItemIds(payloads);
  correct += completedContent.size;
  total += completedContent.size;
  // Distinct submitted transfer items: first submission per item id decides its
  // point; a duplicate submission for the same item can't add a second.
  const scoredTransfer = new Set<string>();
  for (const p of payloads) {
    if (p.kind === 'transfer_submitted' && !scoredTransfer.has(p.itemId)) {
      scoredTransfer.add(p.itemId);
      total += 1;
      if (p.correct) correct += 1;
    }
  }
  return { correct, total };
}

/** The fixed plan recorded in this session's `session_started` event. */
function planFromLog(sessionId: string, payloads: BaselineEventPayload[]): BaselineSessionPlan | null {
  const started = payloads.find((p) => p.kind === 'session_started');
  if (!started || started.kind !== 'session_started') return null;
  // The plan's item details are reconstructed by the caller from the lesson +
  // bank; here we only need the ordered id lists. The caller hydrates.
  return {
    sessionId,
    lessonId: started.lessonId,
    contentItems: started.contentItemIds.map((itemId) => ({ itemId, kc: '', targetExpression: '' })),
    transferItems: started.transferItemIds.map((itemId) => ({ itemId, targetExpression: '' })),
  };
}

export interface BaselineServiceDeps {
  db: Db;
  chat: BaselineChatProvider;
  /** Test seam: override the lesson loader (defaults to the real loadLesson). */
  loadLessonFn?: typeof loadLesson;
}

const LESSON_ID = 1;

/** Read this session's full baseline event log (chronological). */
async function readLog(db: Db, sessionId: string): Promise<BaselineEventPayload[]> {
  const rows = await db
    .select({ payload: events.payload })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(events.ts);
  return loadPayloads(rows);
}

/** Insert one baseline event row — `app:'baseline'` at the COLUMN level (the D3
 *  discriminator F-17/F-21 filter on) and the structured payload. */
async function logEvent(db: Db, sessionId: string, payload: BaselineEventPayload): Promise<void> {
  await db.insert(events).values({
    sessionId,
    kind: payload.kind,
    app: BASELINE_APP,
    payload,
  });
}

/** Create a baseline session: insert a `sessions` row tagged `app:'baseline'`,
 *  fix the item arc (3 content + 2 held-out transfer), log `session_started`. */
export async function createBaselineSession(
  deps: BaselineServiceDeps,
): Promise<{ sessionId: string; plan: BaselineSessionPlan }> {
  const load = deps.loadLessonFn ?? loadLesson;
  const lesson = load(LESSON_ID);
  const contentItems: BaselineContentItem[] = lesson.content.items.map((i) => ({
    itemId: i.itemId,
    kc: i.kc,
    targetExpression: i.targetExpression,
  }));

  // Held-out transfer items: L1 bank rows whose expression is NOT one of the
  // content targets (so the post-test is genuinely held out from the session).
  const contentTargets = new Set(contentItems.map((i) => i.targetExpression));
  const bankRows = await deps.db
    .select({ itemId: transferBank.itemId, targetExpression: transferBank.targetExpression, lessonId: transferBank.lessonId })
    .from(transferBank)
    .where(eq(transferBank.lessonId, LESSON_ID));
  const heldOut = bankRows
    .filter((r) => !contentTargets.has(r.targetExpression))
    .slice(0, BASELINE_TRANSFER_COUNT)
    .map((r) => ({ itemId: r.itemId, targetExpression: r.targetExpression }));

  const [row] = await deps.db
    .insert(sessions)
    .values({ app: BASELINE_APP })
    .returning({ id: sessions.id });
  const sessionId = row!.id;

  await logEvent(deps.db, sessionId, {
    kind: 'session_started',
    app: BASELINE_APP,
    lessonId: LESSON_ID,
    contentItemIds: contentItems.map((i) => i.itemId),
    transferItemIds: heldOut.map((i) => i.itemId),
  });

  return { sessionId, plan: { sessionId, lessonId: LESSON_ID, contentItems, transferItems: heldOut } };
}

/** Hydrate the fixed plan (ids from the log) with item details from the lesson +
 *  bank, so the service knows each item's canonical target expression. */
async function hydratePlan(
  deps: BaselineServiceDeps,
  sessionId: string,
  payloads: BaselineEventPayload[],
): Promise<BaselineSessionPlan | null> {
  const skeleton = planFromLog(sessionId, payloads);
  if (!skeleton) return null;
  const load = deps.loadLessonFn ?? loadLesson;
  const lesson = load(skeleton.lessonId);
  const byId = new Map(lesson.content.items.map((i) => [i.itemId, i] as const));
  const contentItems: BaselineContentItem[] = skeleton.contentItems.map((c) => {
    const item = byId.get(c.itemId);
    return item
      ? { itemId: item.itemId, kc: item.kc, targetExpression: item.targetExpression }
      : c;
  });
  const bankRows = await deps.db
    .select({ itemId: transferBank.itemId, targetExpression: transferBank.targetExpression })
    .from(transferBank)
    .where(eq(transferBank.lessonId, skeleton.lessonId));
  const bankById = new Map(bankRows.map((r) => [r.itemId, r] as const));
  const transferItems = skeleton.transferItems.map((t) => {
    const row = bankById.get(t.itemId);
    return row ? { itemId: row.itemId, targetExpression: row.targetExpression } : t;
  });
  return { sessionId, lessonId: skeleton.lessonId, contentItems, transferItems };
}

/** Derive what the learner should do next, purely from the server-side log. */
export function deriveProgress(
  plan: BaselineSessionPlan,
  payloads: BaselineEventPayload[],
): BaselineProgress {
  const score = tallyScore(payloads);
  const completed = completedContentItemIds(payloads);
  const nextContentIndex = plan.contentItems.findIndex((i) => !completed.has(i.itemId));
  if (nextContentIndex >= 0) {
    return {
      phase: 'chat',
      item: plan.contentItems[nextContentIndex]!,
      itemIndex: nextContentIndex,
      itemCount: plan.contentItems.length,
      score,
    };
  }
  const submitted = submittedTransferItemIds(payloads);
  const nextTransferIndex = plan.transferItems.findIndex((i) => !submitted.has(i.itemId));
  if (nextTransferIndex >= 0) {
    return {
      phase: 'transfer',
      item: { itemId: plan.transferItems[nextTransferIndex]!.itemId },
      itemIndex: nextTransferIndex,
      itemCount: plan.transferItems.length,
      score,
    };
  }
  return { phase: 'ended', score };
}

export interface BaselineSessionView {
  sessionId: string;
  progress: BaselineProgress;
}

/** Load a session's current server-derived progress (drives the SPA on reconnect). */
export async function getBaselineSession(
  deps: BaselineServiceDeps,
  sessionId: string,
): Promise<BaselineSessionView | null> {
  const payloads = await readLog(deps.db, sessionId);
  const plan = await hydratePlan(deps, sessionId, payloads);
  if (!plan) return null;
  return { sessionId, progress: deriveProgress(plan, payloads) };
}

export interface BaselineChatResult {
  reply: string;
  correct: boolean | null;
  itemComplete: boolean;
  progress: BaselineProgress;
}

/** Handle one learner chat message for the current content item.
 *
 *  Scoring: if the message parses (and is within the var cap) and is equivalent to
 *  the current item's canonical target, it's `correct:true` and the item completes;
 *  if it parses but isn't equivalent (or is over-cap), `correct:false`; if it does
 *  not parse as a Boolean expression at all (prose / a question), `correct:null`
 *  (a re-prompt, NOT a wrong answer). ALL via the shared `scoreEquivalence`.
 */
export async function handleBaselineChat(
  deps: BaselineServiceDeps,
  sessionId: string,
  message: string,
): Promise<BaselineChatResult | { error: 'not_in_chat' } | null> {
  const payloads = await readLog(deps.db, sessionId);
  const plan = await hydratePlan(deps, sessionId, payloads);
  if (!plan) return null;
  const progress = deriveProgress(plan, payloads);
  if (progress.phase !== 'chat') return { error: 'not_in_chat' };

  const item = progress.item;
  // Defensive: phase==='chat' already implies this item isn't complete, but a race
  // (two concurrent posts for the same in-progress item) can have both observe it
  // incomplete. The distinct-id tally makes the score idempotent regardless; this
  // guard additionally avoids logging a second completing turn against a settled item.
  if (completedContentItemIds(payloads).has(item.itemId)) return { error: 'not_in_chat' };

  const verdict = scoreVerdict(message, item.targetExpression);
  const itemComplete = verdict === true;

  const history = chatHistoryFor(payloads, item.itemId);
  const reply = await deps.chat.reply({ item, history, message, verdict });

  // Score is computed AFTER folding this turn (tallyScore counts completed items).
  const score = tallyScore([
    ...payloads,
    chatTurnPayload(item.itemId, message, reply, verdict, itemComplete, { correct: 0, total: 0 }),
  ]);

  const turn = chatTurnPayload(item.itemId, message, reply, verdict, itemComplete, score);
  await logEvent(deps.db, sessionId, turn);

  const after = [...payloads, turn];
  return { reply, correct: verdict, itemComplete, progress: deriveProgress(plan, after) };
}

export interface BaselineTransferResult {
  correct: boolean;
  progress: BaselineProgress;
}

/** Handle one held-out transfer-item submission at session end. Scored via the
 *  SAME shared `scoreEquivalence` against the bank's canonical expression. Logs the
 *  `transfer_submitted` row, and `session_ended` once the last transfer is done. */
export async function handleBaselineTransfer(
  deps: BaselineServiceDeps,
  sessionId: string,
  itemId: string,
  submission: string,
): Promise<BaselineTransferResult | { error: 'not_in_transfer' | 'wrong_item' } | null> {
  const payloads = await readLog(deps.db, sessionId);
  const plan = await hydratePlan(deps, sessionId, payloads);
  if (!plan) return null;
  const progress = deriveProgress(plan, payloads);
  if (progress.phase !== 'transfer') return { error: 'not_in_transfer' };
  // The client must answer the item the SERVER says is next — it can't skip ahead
  // or replay an answered item to inflate the tally.
  if (progress.item.itemId !== itemId) return { error: 'wrong_item' };

  const planned = plan.transferItems.find((t) => t.itemId === itemId);
  if (!planned) return { error: 'wrong_item' };
  const correct = scoreEquivalence(submission, planned.targetExpression);

  const score = tallyScore([
    ...payloads,
    { kind: 'transfer_submitted', app: BASELINE_APP, itemId, submission, correct, score: { correct: 0, total: 0 } },
  ]);
  const transferPayload: BaselineEventPayload = {
    kind: 'transfer_submitted',
    app: BASELINE_APP,
    itemId,
    submission,
    correct,
    score,
  };
  await logEvent(deps.db, sessionId, transferPayload);

  const after = [...payloads, transferPayload];
  const next = deriveProgress(plan, after);
  if (next.phase === 'ended') {
    await logEvent(deps.db, sessionId, { kind: 'session_ended', app: BASELINE_APP, score: next.score });
  }
  return { correct, progress: next };
}

/** Score a learner message for a content item. `null` when it isn't a Boolean
 *  expression at all (so the tutor re-prompts rather than marking it wrong). The
 *  truth-maker is the shared `scoreEquivalence`. */
export function scoreVerdict(message: string, target: string): boolean | null {
  // A message that doesn't even parse as a Boolean expression is a question/prose,
  // not a wrong answer → null (re-prompt). `scoreEquivalence` swallows parse errors
  // into `false`, so we detect "not an expression" separately, then defer the
  // actual correctness to the shared scorer (var cap + equivalence).
  if (!looksLikeBooleanExpression(message)) return null;
  return scoreEquivalence(message, target);
}

/** Cheap pre-classifier: does this message contain a Boolean-expression attempt?
 *  Conservative — a message with a variable letter and either an operator or a
 *  single bare variable counts; pure prose ("what does AND mean?") does not, so
 *  it's treated as a question (null), never auto-marked wrong. This ONLY decides
 *  null-vs-scored; the SCORING is always the shared `scoreEquivalence`. */
function looksLikeBooleanExpression(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) return false;
  // Strip the operator keywords, then see whether what remains is just variable
  // letters, parens and whitespace (an expression) rather than English words.
  const withoutOps = trimmed.replace(/\b(AND|OR|NOT)\b/gi, ' ');
  // If, after removing operators, only single-letter tokens / parens / spaces
  // remain, it's an expression attempt. Multi-letter words ⇒ prose ⇒ a question.
  const tokens = withoutOps.split(/[\s()]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    // Only operators/parens — treat as an (incomplete) expression attempt, scored false.
    return /[A-Za-z]/.test(trimmed);
  }
  return tokens.every((t) => /^[A-Za-z]$/.test(t));
}

function chatTurnPayload(
  itemId: string,
  message: string,
  reply: string,
  correct: boolean | null,
  itemComplete: boolean,
  score: BaselineScore,
): BaselineEventPayload {
  return { kind: 'chat_turn', app: BASELINE_APP, itemId, message, reply, correct, itemComplete, score };
}

/** Reconstruct the dialogue for the current item from the log (newest last). */
function chatHistoryFor(payloads: BaselineEventPayload[], itemId: string) {
  const history: { role: 'tutor' | 'learner'; text: string }[] = [];
  for (const p of payloads) {
    if (p.kind === 'chat_turn' && p.itemId === itemId) {
      history.push({ role: 'learner', text: p.message });
      history.push({ role: 'tutor', text: p.reply });
    }
  }
  return history;
}
