import type { AgentInput, MoveProvider } from './client.js';
import type { TacticalMove } from './menu.js';
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
