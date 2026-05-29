import { describe, expect, it } from 'vitest';
import { Action } from '@polymath/contract';
import { StubAgentClient } from './stubClient.js';
import type { AgentInput } from './client.js';
import { loadLesson } from '../lessons/loader.js';
import { validateOutboundAction } from './validateAction.js';

const lesson = loadLesson(1);
const SID = '00000000-0000-0000-0000-000000000000';
function input(event: AgentInput['event'], ruleGatePassed = false): AgentInput {
  // For tests, mirror the event's `correct` (when present) into the server-derived
  // `currentSubmitCorrect` the heuristic actually reads — in production the server
  // recomputes it from the submission; here the test states intent via `correct`.
  const currentSubmitCorrect = event.kind === 'submit' ? event.correct : undefined;
  return {
    event,
    lesson,
    learnerState: { bktByKc: {}, hintsUsed: 0, consecutiveCorrect: 1, ruleGatePassed },
    recentHistory: [],
    currentSubmitCorrect,
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

  it('does NOT declare mastery when the rule gate passed but no transfer item is available (fail closed)', async () => {
    const inp = input(
      { kind: 'submit', sessionId: SID, itemId: 'l1-and', submission: 'A AND B', correct: true },
      true,
    );
    inp.transferCandidates = [];
    const action = await new StubAgentClient().propose(inp);
    // A missing probe is a degraded state, not a pass — never jump to mastered.
    expect(action.type).toBe('no_action');
  });

  it('on a passed transfer, awaits explain-back rather than declaring mastery (config requires it)', async () => {
    const inp = input({ kind: 'transfer_submitted', sessionId: SID, itemId: PROBE.itemId, submission: 'A AND B' });
    inp.transferVerdict = { itemId: PROBE.itemId, correct: true };
    const action = await new StubAgentClient().propose(inp);
    // lesson 1 config requires explain-back (F-11/F-12) — mastery is not declared yet.
    expect(action.type).toBe('no_action');
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
    const inp = input({ kind: 'submit', sessionId: SID, itemId: 'l1-or', submission: 'wrong', correct: false });
    inp.priorMissesByItem = { 'l1-or': 1 }; // a prior miss on this item (server-derived)
    const action = await new StubAgentClient().propose(inp);
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      // The simpler item is the lowest-tier item that differs from A OR B.
      expect(action.component.expression).not.toBe('A OR B');
    }
  });

  it('on a ready learner with a held-out item, it fires a transfer probe (not mastery)', async () => {
    const inp = input({ kind: 'submit', sessionId: SID, itemId: 'l1-not', submission: 'NOT A' }, true);
    inp.transferCandidates = [PROBE];
    const action = await new StubAgentClient().propose(inp);
    expect(action.type).toBe('mount');
    expect(action.type === 'mount' && action.component.kind).toBe('TransferProbe');
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

describe('Lesson 3 — NAND-only circuit workspace', () => {
  const l3 = loadLesson(3);
  const SID3 = '00000000-0000-0000-0000-000000000003';
  function l3Input(event: AgentInput['event']): AgentInput {
    const currentSubmitCorrect = event.kind === 'submit' ? event.correct : undefined;
    return {
      event,
      lesson: l3,
      learnerState: { bktByKc: {}, hintsUsed: 0, consecutiveCorrect: 1, ruleGatePassed: false },
      recentHistory: [],
      currentSubmitCorrect,
    };
  }

  it('mounts the next circuit item with allowedGates restricted to NAND (AC#3)', async () => {
    const firstItem = l3.content.items[0]!;
    const action = await new StubAgentClient().propose(
      l3Input({
        kind: 'submit',
        sessionId: SID3,
        itemId: firstItem.itemId,
        submission: firstItem.targetExpression,
        correct: true,
        repSubmission: {
          rep: 'circuit',
          expression: firstItem.targetExpression,
          nodes: [],
          edges: [],
        },
      }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'CircuitBuilder') {
      expect(action.component.allowedGates).toEqual(['NAND']);
    } else {
      throw new Error(`expected a CircuitBuilder mount, got ${action.type}`);
    }
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('a truth-table submit on L3 is NOT given a NAND palette (allowedGates is circuit-only)', async () => {
    const firstItem = l3.content.items[0]!;
    const action = await new StubAgentClient().propose(
      l3Input({
        kind: 'submit',
        sessionId: SID3,
        itemId: firstItem.itemId,
        submission: firstItem.targetExpression,
        correct: true,
      }),
    );
    expect(action.type).toBe('mount');
    // A truth-table rep mount carries no allowedGates field at all.
    expect(action.type === 'mount' && action.component.kind).toBe('TruthTablePractice');
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
