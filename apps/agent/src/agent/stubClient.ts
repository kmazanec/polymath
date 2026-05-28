import type { AgentInput, MoveProvider } from './client.js';
import type { ProposedItem, TacticalMove } from './menu.js';
import { FlowAgentClient } from './flowClient.js';

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
 *  - `request_hint`      → no_action here (F-06 owns the hint arm).
 *  - `learner_question`  → answer on-topic Boolean-logic questions, deflect others.
 *  - anything else       → no_action (wait for the learner).
 */
export class HeuristicMoveProvider implements MoveProvider {
  proposeMove(input: AgentInput): Promise<TacticalMove> {
    const ev = input.event;

    if (ev.kind === 'session_start') {
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

      if (input.learnerState.ruleGatePassed) {
        return Promise.resolve({
          move: 'propose_mastery_transition',
          rationale: 'rule-gate reports the learner is ready (heuristic provider)',
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

/** The lesson item the current submit concerns, as a `ProposedItem` (matched by
 *  itemId or canonical expression). Null if the submit names no known item. */
function currentItem(input: AgentInput): ProposedItem | null {
  const ev = input.event;
  if (ev.kind !== 'submit') return null;
  const item = input.lesson.content.items.find(
    (i) => i.itemId === ev.itemId || i.targetExpression === ev.submission,
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
 *  lesson's items. The submit names the current item by `itemId`; we also match on
 *  the canonical `submission` expression so a caller that only knows the expression
 *  (the rep ComponentSpecs don't carry an itemId) still advances correctly. */
function pickLessonItem(input: AgentInput): TacticalMove | null {
  const items = input.lesson.content.items;
  if (items.length === 0) return null;
  const ev = input.event;
  const currentId = ev.kind === 'submit' ? ev.itemId : undefined;
  const currentExpr = ev.kind === 'submit' ? ev.submission : undefined;
  const idx = items.findIndex((i) => i.itemId === currentId || i.targetExpression === currentExpr);
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
