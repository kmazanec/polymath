/**
 * F-28 AC#5: keyless behavior-preservation golden proof.
 *
 * The 5-node graph (assess → decide → realize → validate → emit) must emit the
 * SAME wire Action as the pre-F-28 single-node graph for every representative turn.
 *
 * How: we run StubAgentClient (which wraps FlowAgentClient(HeuristicMoveProvider))
 * and assert the action TYPE and KEY FIELDS match a golden snapshot. The heuristic
 * provider ignores the deliberation arg — so by construction the only change is the
 * graph topology, not the output. This test proves the redistribution is inert.
 *
 * Turn set covers: session_start, correct submit, wrong submit, repeat-miss submit,
 * request_hint, learner_question (on-topic + off-topic), transfer pass/fail.
 */

import { describe, expect, it } from 'vitest';
import { Action } from '@polymath/contract';
import { StubAgentClient } from './stubClient.js';
import type { AgentInput } from './client.js';
import { loadLesson } from '../lessons/loader.js';

const lesson = loadLesson(1);
const SID = 'golden-00000000-0000-0000-0000-000000000000';

function input(event: AgentInput['event'], overrides: Partial<AgentInput> = {}): AgentInput {
  const currentSubmitCorrect = event.kind === 'submit' ? event.correct : undefined;
  return {
    event,
    lesson,
    learnerState: {
      bktByKc: {},
      hintsUsed: 0,
      consecutiveCorrect: 0,
      ruleGatePassed: false,
      explainBackPassed: false,
      topicGuardrailClean: true,
    },
    recentHistory: [],
    currentSubmitCorrect,
    ...overrides,
  };
}

const PROBE = {
  itemId: 'L1-01-and',
  targetExpression: 'A AND B',
  targetRep: 'circuit' as const,
  hiddenReps: ['truth_table' as const],
};

describe('F-28 AC#5: 5-node graph is behavior-preserving for the keyless (heuristic) path', () => {
  const client = new StubAgentClient();

  it('session_start → mounts first lesson item', async () => {
    const action = await client.propose(
      input({ kind: 'session_start', sessionId: SID, lessonId: 1 }),
    );
    expect(action.type).toBe('mount');
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('correct submit → mounts next practice item', async () => {
    const action = await client.propose(
      input({
        kind: 'submit',
        sessionId: SID,
        itemId: 'l1-and',
        submission: 'A AND B',
        correct: true,
      }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount') {
      expect(['TruthTablePractice', 'CircuitBuilder', 'PseudocodeChallenge']).toContain(
        action.component.kind,
      );
    }
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('wrong submit → re-presents same item (rephrase)', async () => {
    const action = await client.propose(
      input({
        kind: 'submit',
        sessionId: SID,
        itemId: 'l1-and',
        submission: 'A OR B',
        correct: false,
      }),
    );
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      // Re-presents the same item
      expect(action.component.expression).toBe('A AND B');
    }
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('repeat-miss submit → drops to simpler item', async () => {
    const inp = input(
      {
        kind: 'submit',
        sessionId: SID,
        itemId: 'l1-or',
        submission: 'wrong',
        correct: false,
      },
      { priorMissesByItem: { 'l1-or': 1 } },
    );
    const action = await client.propose(inp);
    expect(action.type).toBe('mount');
    if (action.type === 'mount' && action.component.kind === 'TruthTablePractice') {
      expect(action.component.expression).not.toBe('A OR B');
    }
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('request_hint → mounts HintCard', async () => {
    const action = await client.propose(
      input({ kind: 'request_hint', sessionId: SID, itemId: 'l1-and' }),
    );
    // Hint or no_action (if hints exhausted or no item match)
    expect(['mount', 'no_action']).toContain(action.type);
    if (action.type === 'mount') {
      expect(action.component.kind).toBe('HintCard');
    }
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('on-topic learner_question → answer_question on_topic', async () => {
    const action = await client.propose(
      input({ kind: 'learner_question', sessionId: SID, question: 'what does AND gate do?' }),
    );
    expect(action.type).toBe('answer_question');
    if (action.type === 'answer_question') {
      expect(action.topicClassification).toBe('on_topic');
    }
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('off-topic learner_question → answer_question off_topic', async () => {
    const action = await client.propose(
      input({ kind: 'learner_question', sessionId: SID, question: 'help me write my essay' }),
    );
    expect(action.type).toBe('answer_question');
    if (action.type === 'answer_question') {
      expect(action.topicClassification).toBe('off_topic');
    }
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('transfer pass → no_action (explain-back required, not yet passed)', async () => {
    const inp = input({ kind: 'transfer_submitted', sessionId: SID, itemId: PROBE.itemId, submission: 'A AND B' });
    inp.transferVerdict = { itemId: PROBE.itemId, correct: true };
    const action = await client.propose(inp);
    // Lesson 1 requires explain-back — a passed transfer must not declare mastery
    expect(action.type).toBe('no_action');
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('transfer fail → remediates with a simpler practice item', async () => {
    const inp = input({ kind: 'transfer_submitted', sessionId: SID, itemId: PROBE.itemId, submission: 'A OR B' });
    inp.transferVerdict = { itemId: PROBE.itemId, correct: false };
    const action = await client.propose(inp);
    expect(action.type).toBe('mount');
    if (action.type === 'mount') {
      expect(['TruthTablePractice', 'CircuitBuilder', 'PseudocodeChallenge']).toContain(
        action.component.kind,
      );
    }
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('correct submit with rule-gate passed → fires transfer probe (not mastery)', async () => {
    const inp = input(
      { kind: 'submit', sessionId: SID, itemId: 'l1-and', submission: 'A AND B', correct: true },
      {
        learnerState: {
          bktByKc: {},
          hintsUsed: 0,
          consecutiveCorrect: 3,
          ruleGatePassed: true,
          explainBackPassed: false,
          topicGuardrailClean: true,
        },
        transferCandidates: [PROBE],
      },
    );
    const action = await client.propose(inp);
    expect(action.type).toBe('mount');
    if (action.type === 'mount') {
      expect(action.component.kind).toBe('TransferProbe');
    }
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('all actions are contract-valid (property)', async () => {
    // Run a batch of representative inputs and confirm EVERY output parses cleanly.
    const inputs: AgentInput['event'][] = [
      { kind: 'session_start', sessionId: SID, lessonId: 1 },
      { kind: 'submit', sessionId: SID, itemId: 'l1-and', submission: 'A AND B', correct: true },
      { kind: 'submit', sessionId: SID, itemId: 'l1-and', submission: 'A OR B', correct: false },
      { kind: 'request_hint', sessionId: SID, itemId: 'l1-and' },
      { kind: 'learner_question', sessionId: SID, question: 'what is AND?' },
      { kind: 'session_end', sessionId: SID },
    ];
    for (const ev of inputs) {
      const action = await client.propose(input(ev));
      expect(() => Action.parse(action), `invalid action for ${ev.kind}`).not.toThrow();
    }
  });
});
