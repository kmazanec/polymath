import type { AgentInput, MoveProvider } from './client.js';
import type { ProposedItem, TacticalMove } from './menu.js';
import { FlowAgentClient } from './flowClient.js';
import { generateL1, generateL2, generateL3Canned } from '../hints/templates.js';

/**
 * A deterministic, key-free `MoveProvider` (no LLM). It implements a small
 * hand-coded policy over the same tactical menu the LLM would pick from, so the
 * inner loop is fully exercisable — in F-01's integration test, in the smoke
 * test, and locally — without an `OPENAI_API_KEY`. The OpenAI provider replaces
 * this when a key is present; the *flow* (retry/fallback/Layer-2) is identical.
 *
 * Policy:
 *  - `session_start`     → mount the lesson's first practice item (kick off the loop
 *                          so the learner reaches a workspace from the intro).
 *  - `submit`            → next practice item from the lesson (or propose the mastery
 *                          transition if the rule-gate says the learner is ready).
 *  - `request_hint`      → propose_hint at the appropriate level (0 prior→L1,
 *                          1→L2, 2→L3, 3+→no_action/disabled). During the
 *                          `transferring` phase → no_action.
 *  - `learner_question`  → answer on-topic Boolean-logic questions, deflect others.
 *  - anything else       → no_action (wait for the learner).
 */
export class HeuristicMoveProvider implements MoveProvider {
  proposeMove(input: AgentInput): Promise<TacticalMove> {
    const ev = input.event;

    if (ev.kind === 'session_start') {
      // Idempotent: only mount the first item on a FRESH session. A reconnect
      // re-sends session_start (the socket re-announces on open); if the learner
      // has already been practicing, remounting item 0 would reset their progress.
      const alreadyStarted = input.recentHistory.some(
        (t) => t.eventKind === 'submit' || t.eventKind === 'request_hint' || t.eventKind === 'transfer_submitted',
      );
      if (alreadyStarted) {
        return Promise.resolve({
          move: 'no_action',
          reason: 'wait_for_learner',
          rationale: 'session already in progress — not remounting the first item (heuristic provider)',
        });
      }
      const first = firstLessonItem(input);
      if (first) return Promise.resolve(first);
      return Promise.resolve({
        move: 'no_action',
        reason: 'wait_for_learner',
        rationale: 'lesson has no items to start (heuristic provider)',
      });
    }

    if (ev.kind === 'submit') {
      // A wrong submit must NOT advance: re-present the same item (rephrase), and
      // on a *repeated* wrong attempt at the same item, drop to a simpler item
      // (ADR-003 menu; F-05 criterion 3). Correctness is the client-computed
      // verdict on the submit; the server still treats `submission` as canonical.
      if (ev.correct === false) {
        const priorWrong = input.recentHistory.some(
          (t) => t.eventKind === 'submit' && t.correct === false && t.itemId === ev.itemId,
        );
        const same = currentItem(input);
        if (same) {
          return Promise.resolve(
            priorWrong
              ? { move: 'simpler_item', item: simplerVariant(same, input), rationale: 'repeated miss on this item — dropping to a simpler one (heuristic provider)' }
              : { move: 'rephrase', item: same, rationale: 're-presenting the item after a miss (heuristic provider)' },
          );
        }
      }

      // Rule gate ready → fire a transfer probe from the held-out bank (an unseen
      // item). Mastery is NOT proposed from practice — it requires a passed transfer
      // probe AND the remaining mastery conditions (ADR-005 refusal #3 / ADR-011).
      // If the bank is exhausted we still cannot declare mastery here (a missing
      // probe is a degraded state, not a pass) — fail closed.
      if (input.learnerState.ruleGatePassed) {
        const candidate = input.transferCandidates?.[0];
        if (candidate) {
          return Promise.resolve({
            move: 'propose_transfer_probe',
            expression: candidate.targetExpression,
            targetRep: candidate.targetRep,
            hiddenReps: candidate.hiddenReps,
            itemId: candidate.itemId,
            rationale: 'rule-gate passed — firing a held-out transfer probe (heuristic provider)',
          });
        }
        return Promise.resolve({
          move: 'no_action',
          reason: 'wait_for_learner',
          rationale: 'rule-gate passed but no unseen transfer item available — cannot declare mastery (heuristic provider)',
        });
      }
      const next = pickLessonItem(input);
      if (next) return Promise.resolve(next);
      return Promise.resolve({
        move: 'no_action',
        reason: 'wait_for_learner',
        rationale: 'no further lesson items (heuristic provider)',
      });
    }

    if (ev.kind === 'transfer_submitted') {
      // The transfer probe's verdict gates the next move. A pass clears the rule +
      // transfer conditions, but mastery ALSO requires explain-back when the lesson
      // config demands it (ADR-011) — and explain-back lands in F-11/F-12. So a
      // passed transfer in I1 does NOT declare mastery: it records the pass (the
      // server logs the verdict) and waits. Only when no further condition is
      // required does the agent propose mastery. A fail remediates with a simpler
      // item. Correctness is computed server-side and threaded via `transferVerdict`.
      const passed = input.transferVerdict?.correct ?? false;
      if (passed) {
        if (input.lesson.masteryConfig.requireExplainBackPass) {
          return Promise.resolve({
            move: 'no_action',
            reason: 'wait_for_learner',
            rationale: 'transfer passed; awaiting explain-back before mastery (F-11/F-12) (heuristic provider)',
          });
        }
        return Promise.resolve({
          move: 'propose_mastery_transition',
          rationale: 'transfer passed and no further mastery condition required (heuristic provider)',
        });
      }
      const items = [...input.lesson.content.items].sort((a, b) => a.difficultyTier - b.difficultyTier);
      const easiest = items[0];
      if (easiest) {
        return Promise.resolve({
          move: 'simpler_item',
          item: {
            rep: 'truth_table',
            targetExpression: easiest.targetExpression,
            claimedTruthTable: easiest.truthTable,
            visibleReps: ['truth_table'],
          },
          rationale: 'transfer probe failed — remediating with a simpler item (heuristic provider)',
        });
      }
      return Promise.resolve({ move: 'no_action', reason: 'wait_for_learner', rationale: 'transfer failed, no item to remediate' });
    }

    if (ev.kind === 'request_hint') {
      // ADR-005 refusal #2 extends to hints: no hint during a transfer probe, even
      // if the (normally-disabled) affordance is somehow triggered. Server-side
      // defense in depth, not just the disabled button.
      if (input.inTransferProbe) {
        return Promise.resolve({
          move: 'no_action',
          reason: 'wait_for_learner',
          rationale: 'hints are withheld during a transfer probe (heuristic provider)',
        });
      }
      return Promise.resolve(proposeHint(ev.itemId, input));
    }

    if (ev.kind === 'learner_question') {
      const onTopic = isBooleanTopic(ev.question);
      return Promise.resolve({
        move: 'answer_question',
        question: ev.question,
        answer: onTopic
          ? 'In Boolean logic, an expression is true or false depending on its inputs. Try working it through on the truth table.'
          : "I can help with Boolean logic and this lesson. For anything else, Nerdy has other tutors who can help.",
        topicClassification: onTopic ? 'on_topic' : 'off_topic',
        rationale: 'heuristic topic classification',
      });
    }

    return Promise.resolve({
      move: 'no_action',
      reason: 'wait_for_learner',
      rationale: `heuristic provider: nothing to do for "${ev.kind}"`,
    });
  }
}

/**
 * Propose the appropriate hint level for the given item, based on how many hints
 * have ALREADY been served on THIS item this session.
 *
 * Level selection (ADR-010 Layer 3):
 *   0 prior served hints for item → L1
 *   1 prior                       → L2
 *   2 prior                       → L3
 *   3+                            → no_action (affordance is disabled)
 *
 * The count comes from the server-derived `hintsByItem` (the full session), not the
 * capped `recentHistory` window — a window-based count could reset the ladder when
 * other events push earlier hints out of view.
 */
function proposeHint(itemId: string, input: AgentInput): TacticalMove {
  const priorHints =
    input.hintsByItem?.[itemId] ??
    // Fallback only if the server didn't supply the derived map.
    input.recentHistory.filter((t) => t.eventKind === 'request_hint' && t.itemId === itemId).length;

  if (priorHints >= 3) {
    return {
      move: 'no_action',
      reason: 'wait_for_learner',
      rationale: 'all hint levels exhausted for this item (heuristic provider)',
    };
  }

  // Find the item in the lesson to get its targetExpression
  const lessonItem = input.lesson.content.items.find(
    (i) => i.itemId === itemId || i.targetExpression === itemId,
  );
  const targetExpression = lessonItem?.targetExpression ?? itemId;

  const level = (priorHints + 1) as 1 | 2 | 3;

  let body: string | null = null;
  if (level === 1) {
    body = generateL1(targetExpression);
  } else if (level === 2) {
    body = generateL2(targetExpression);
  } else {
    body = generateL3Canned(targetExpression);
  }

  if (!body) {
    return {
      move: 'no_action',
      reason: 'agent_unsure',
      rationale: `could not generate L${level.toString()} hint for expression "${targetExpression}" (heuristic provider)`,
    };
  }

  return {
    move: 'propose_hint',
    level,
    body,
    rationale: `L${level.toString()} hint for item "${itemId}" (${priorHints.toString()} prior hints; heuristic provider)`,
  };
}

/** Mount the lesson's first item to start the loop from the intro. */
function firstLessonItem(input: AgentInput): TacticalMove | null {
  const first = input.lesson.content.items[0];
  if (!first) return null;
  return {
    move: 'next_practice_item',
    tier: first.difficultyTier,
    rationale: `starting the lesson at "${first.itemId}" (heuristic provider)`,
    item: {
      rep: 'truth_table',
      targetExpression: first.targetExpression,
      claimedTruthTable: first.truthTable,
      visibleReps: ['truth_table'],
    },
  };
}

/** The lesson item the current submit concerns, as a `ProposedItem`. Identified by
 *  the submit's `itemId` only — matched against both the lesson `itemId` (e.g.
 *  "l1-and") and the item's `targetExpression` (e.g. "A AND B"), since the web
 *  client names the mounted item by its expression (the rep ComponentSpec carries
 *  no itemId). Crucially we do NOT identify by `ev.submission` — that's the
 *  learner's *answer*, which is wrong on a wrong submit and would misidentify the
 *  item. Null if the submit names no known item. */
function currentItem(input: AgentInput): ProposedItem | null {
  const ev = input.event;
  if (ev.kind !== 'submit') return null;
  const item = input.lesson.content.items.find(
    (i) => i.itemId === ev.itemId || i.targetExpression === ev.itemId,
  );
  if (!item) return null;
  const rep = ev.repSubmission ? ev.repSubmission.rep : 'truth_table';
  return {
    rep,
    targetExpression: item.targetExpression,
    claimedTruthTable: item.truthTable,
    visibleReps: [rep],
  };
}

/** A simpler item than the given one: the lesson's lowest-tier item that differs
 *  from it; falls back to the same item if none is strictly simpler. */
function simplerVariant(current: ProposedItem, input: AgentInput): ProposedItem {
  const items = [...input.lesson.content.items].sort((a, b) => a.difficultyTier - b.difficultyTier);
  const simpler = items.find((i) => i.targetExpression !== current.targetExpression);
  if (!simpler) return current;
  return {
    rep: current.rep,
    targetExpression: simpler.targetExpression,
    claimedTruthTable: simpler.truthTable,
    visibleReps: current.visibleReps,
  };
}

/** Pick the next lesson item as a `next_practice_item` move, cycling through the
 *  lesson's items. The current item is identified by the submit's `itemId`,
 *  matched against both the lesson `itemId` and the `targetExpression` (the web
 *  names the item by its expression). Identifying by `itemId` (not the learner's
 *  answer `submission`) keeps advancing correct even on a near-miss answer. An
 *  unrecognised item starts the lesson from item 0. */
function pickLessonItem(input: AgentInput): TacticalMove | null {
  const items = input.lesson.content.items;
  if (items.length === 0) return null;
  const ev = input.event;
  const currentId = ev.kind === 'submit' ? ev.itemId : undefined;
  const idx = items.findIndex((i) => i.itemId === currentId || i.targetExpression === currentId);
  const next = items[(idx + 1 + items.length) % items.length]!;
  const rep = ev.kind === 'submit' && ev.repSubmission ? ev.repSubmission.rep : 'truth_table';
  return {
    move: 'next_practice_item',
    tier: next.difficultyTier,
    rationale: `advancing to "${next.itemId}" (heuristic provider)`,
    item: {
      rep,
      targetExpression: next.targetExpression,
      claimedTruthTable: next.truthTable,
      visibleReps: [rep],
    },
  };
}

const BOOLEAN_TERMS = /\b(and|or|not|true|false|gate|circuit|truth\s*table|boolean|input|output|expression|xor|nand)\b/i;
function isBooleanTopic(q: string): boolean {
  return BOOLEAN_TERMS.test(q);
}

/** The F-01-era export name, preserved for the integration test + boot wiring.
 *  Now the heuristic (key-free) client driving the real flow. */
export class StubAgentClient extends FlowAgentClient {
  constructor() {
    super(new HeuristicMoveProvider());
  }
}
