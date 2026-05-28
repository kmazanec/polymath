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

const PROBE = {
  itemId: 'L1-01-and',
  targetExpression: 'A AND B',
  targetRep: 'circuit' as const,
  hiddenReps: ['truth_table' as const],
};

describe('inner-agent flow — transfer probe (F-07)', () => {
  it('on a correct submit with the rule gate passed, fires a transfer probe from an unseen bank item', async () => {
    const inp = input(
      { kind: 'submit', sessionId: SID, itemId: 'l1-and', submission: 'A AND B', correct: true },
      true,
    );
    inp.transferCandidates = [PROBE];
    const action = await new StubAgentClient().propose(inp);
    expect(action.type).toBe('mount');
    if (action.type === 'mount') {
      expect(action.component.kind).toBe('TransferProbe');
      if (action.component.kind === 'TransferProbe') {
        expect(action.component.targetRep).toBe('circuit');
        expect(action.component.hiddenReps).toEqual(['truth_table']);
      }
    }
  });

  it('proposes mastery when the rule gate passed but the transfer bank is exhausted', async () => {
    const inp = input(
      { kind: 'submit', sessionId: SID, itemId: 'l1-and', submission: 'A AND B', correct: true },
      true,
    );
    inp.transferCandidates = [];
    const action = await new StubAgentClient().propose(inp);
    expect(action.type).toBe('transition');
    expect(action.type === 'transition' && action.to).toBe('mastered');
  });

  it('on a passed transfer (server verdict correct), proposes the mastery transition', async () => {
    const inp = input({ kind: 'transfer_submitted', sessionId: SID, itemId: PROBE.itemId, submission: 'A AND B' });
    inp.transferVerdict = { itemId: PROBE.itemId, correct: true };
    const action = await new StubAgentClient().propose(inp);
    expect(action.type).toBe('transition');
    expect(action.type === 'transition' && action.to).toBe('mastered');
  });

  it('on a failed transfer, remediates with a simpler item rather than advancing', async () => {
    const inp = input({ kind: 'transfer_submitted', sessionId: SID, itemId: PROBE.itemId, submission: 'A OR B' });
    inp.transferVerdict = { itemId: PROBE.itemId, correct: false };
    const action = await new StubAgentClient().propose(inp);
    expect(action.type).toBe('mount');
    expect(action.type === 'mount' && ['TruthTablePractice', 'CircuitBuilder', 'PseudocodeChallenge'].includes(action.component.kind)).toBe(true);
  });
});

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

  it('a wrong submit does not advance even when the web names the item by EXPRESSION, not itemId (criterion 3 regression)', async () => {
    // The web sets `itemId` to the mounted item's expression (the ComponentSpec
    // carries no itemId) and `submission` to the learner's (wrong) answer. The item
    // must be identified by itemId, never by the wrong submission, or it advances.
    const action = await new StubAgentClient().propose(
      input({ kind: 'submit', sessionId: SID, itemId: 'A AND B', submission: 'A OR B', correct: false }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.expression).toBe('A AND B'); // re-presents the item, not the answer's item
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
