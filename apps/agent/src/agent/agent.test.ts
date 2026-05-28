import { describe, expect, it } from 'vitest';
import { Action } from '@polymath/contract';
import { StubAgentClient } from './stubClient.js';
import type { AgentInput } from './client.js';
import { loadLesson } from '../lessons/loader.js';
import { validateOutboundAction } from './validateAction.js';

const lesson = loadLesson(1);
const SID = '00000000-0000-0000-0000-000000000000';
function input(event: AgentInput['event'], ruleGatePassed = false): AgentInput {
  return {
    event,
    lesson,
    learnerState: { bktByKc: {}, hintsUsed: 0, consecutiveCorrect: 1, ruleGatePassed },
    recentHistory: [],
  };
}

describe('inner-agent flow (heuristic, key-free)', () => {
  it('on submit, the key-free StubAgentClient mounts the next practice item', async () => {
    const action = await new StubAgentClient().propose(
      input({ kind: 'submit', sessionId: SID, itemId: 'l1-and', submission: 'A AND B' }),
    );
    expect(action.type).toBe('mount');
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('on session_start, it mounts the first lesson item (loop kickoff)', async () => {
    const action = await new StubAgentClient().propose(
      input({ kind: 'session_start', sessionId: SID, lessonId: 1 }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.expression).toBe('A AND B'); // lesson 1, item 0
    }
  });

  it('advances when the submit names the item only by its canonical expression', async () => {
    // The web client knows the expression (the rep ComponentSpec carries no itemId),
    // so a submit may name the item by `submission` rather than a matching `itemId`.
    const action = await new StubAgentClient().propose(
      input({ kind: 'submit', sessionId: SID, itemId: 'A AND B', submission: 'A AND B' }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.expression).toBe('A OR B'); // advanced past A AND B
    }
  });

  it('a wrong submit re-presents the same item (rephrase), not the next one (criterion 3)', async () => {
    const action = await new StubAgentClient().propose(
      input({ kind: 'submit', sessionId: SID, itemId: 'l1-and', submission: 'A AND B', correct: false }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.expression).toBe('A AND B'); // same item, not advanced
    }
  });

  it('a second wrong submit on the same item drops to a simpler item (criterion 3)', async () => {
    const inp = input({ kind: 'submit', sessionId: SID, itemId: 'l1-or', submission: 'A OR B', correct: false });
    inp.recentHistory = [
      { eventKind: 'submit', actionType: 'mount', rationale: 'rephrase', correct: false, itemId: 'l1-or' },
    ];
    const action = await new StubAgentClient().propose(inp);
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      // The simpler item is the lowest-tier item that differs from A OR B.
      expect(action.component.expression).not.toBe('A OR B');
    }
  });

  it('on a ready learner, it proposes the mastery transition', async () => {
    const action = await new StubAgentClient().propose(
      input({ kind: 'submit', sessionId: SID, itemId: 'l1-not', submission: 'NOT A' }, true),
    );
    expect(action.type).toBe('transition');
    expect(action.type === 'transition' && action.to).toBe('mastered');
  });

  it('answers an on-topic question and deflects an off-topic one', async () => {
    const onTopic = await new StubAgentClient().propose(
      input({ kind: 'learner_question', sessionId: SID, question: 'what does the AND gate do?' }),
    );
    expect(onTopic.type === 'answer_question' && onTopic.topicClassification).toBe('on_topic');
    const offTopic = await new StubAgentClient().propose(
      input({ kind: 'learner_question', sessionId: SID, question: 'help me write my essay' }),
    );
    expect(offTopic.type === 'answer_question' && offTopic.topicClassification).toBe('off_topic');
  });

  it('emits a schema-valid no_action for a non-actionable event', async () => {
    const action = await new StubAgentClient().propose(
      input({ kind: 'session_end', sessionId: SID }),
    );
    expect(action.type).toBe('no_action');
    expect(() => Action.parse(action)).not.toThrow();
  });
});

describe('validateOutboundAction (acceptance criterion 5)', () => {
  it('passes a valid action through unchanged', () => {
    const valid = { type: 'no_action', reason: 'thinking', rationale: 'r' } as const;
    const { action, downgraded } = validateOutboundAction(valid);
    expect(downgraded).toBe(false);
    expect(action).toEqual(valid);
  });

  it('downgrades a malformed action to no_action', () => {
    const { action, downgraded } = validateOutboundAction({
      type: 'mount',
      component: { kind: 'NotAReal Component' },
      rationale: 'r',
    });
    expect(downgraded).toBe(true);
    expect(action.type).toBe('no_action');
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('downgrades a completely non-action object', () => {
    const { action, downgraded } = validateOutboundAction({ foo: 'bar' });
    expect(downgraded).toBe(true);
    expect(action.type).toBe('no_action');
  });
});
