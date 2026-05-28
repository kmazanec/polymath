import { describe, expect, it } from 'vitest';
import { Action } from '@polymath/contract';
import { proposeAction } from './graph.js';
import type { AgentInput, MoveProvider } from './client.js';
import type { TacticalMove } from './menu.js';
import { loadLesson } from '../lessons/loader.js';

const lesson = loadLesson(1);

function input(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    event: { kind: 'submit', sessionId: '00000000-0000-0000-0000-000000000000', itemId: 'l1-and', submission: 'A AND B' },
    lesson,
    learnerState: { bktByKc: {}, hintsUsed: 0, consecutiveCorrect: 1, ruleGatePassed: false, explainBackPassed: false, topicGuardrailClean: true },
    recentHistory: [],
    ...overrides,
  };
}

/** A provider that returns a fixed sequence of moves/throws across calls. */
class ScriptedProvider implements MoveProvider {
  calls = 0;
  constructor(private readonly script: (call: number, validationError?: string) => TacticalMove) {}
  proposeMove(_input: AgentInput, validationError?: string): Promise<TacticalMove> {
    return Promise.resolve(this.script(this.calls++, validationError));
  }
}

const goodItem: TacticalMove = {
  move: 'next_practice_item',
  tier: 1,
  rationale: 'ok',
  item: { rep: 'truth_table', targetExpression: 'A OR B', claimedTruthTable: [0, 1, 1, 1], visibleReps: ['truth_table'] },
};
const badItem: TacticalMove = {
  move: 'next_practice_item',
  tier: 1,
  rationale: 'wrong table',
  item: { rep: 'truth_table', targetExpression: 'A OR B', claimedTruthTable: [0, 0, 0, 0], visibleReps: ['truth_table'] },
};

describe('proposeAction (the retry/fallback contract)', () => {
  it('returns the first valid action with no retry', async () => {
    const p = new ScriptedProvider(() => goodItem);
    const a = await proposeAction(p, input());
    expect(a.type).toBe('mount');
    expect(p.calls).toBe(1);
    Action.parse(a);
  });

  it('retries exactly once on a Layer-2 mismatch, passing the validation error', async () => {
    let sawError: string | undefined;
    const p = new ScriptedProvider((call, validationError) => {
      if (call === 1) sawError = validationError;
      return call === 0 ? badItem : goodItem;
    });
    const a = await proposeAction(p, input());
    expect(p.calls).toBe(2);
    expect(sawError).toMatch(/disagrees/);
    expect(a.type).toBe('mount');
    if (a.type !== 'mount') throw new Error('unreachable');
    expect(a.component.kind === 'TruthTablePractice' && a.component.claimedTruthTable).toEqual([0, 1, 1, 1]);
  });

  it('persistent malformation → falls back to a hand-curated bank item (not no_action)', async () => {
    const p = new ScriptedProvider(() => badItem);
    const a = await proposeAction(p, input());
    expect(p.calls).toBe(2); // exactly one retry, then fallback
    expect(a.type).toBe('mount'); // fallback bank item
    const v = Action.parse(a);
    expect(v.type === 'mount' && v.rationale).toMatch(/fallback/);
  });

  it('persistent provider errors → one retry then a fallback bank item', async () => {
    const p = new ScriptedProvider(() => {
      throw new Error('model offline');
    });
    const a = await proposeAction(p, input());
    expect(p.calls).toBe(2);
    expect(a.type).toBe('mount');
  });

  it('falls back to no_action when the bank is unusable (lesson with no items)', async () => {
    const emptyLesson = { ...lesson, content: { ...lesson.content, lessonId: 999, items: [] } };
    const p = new ScriptedProvider(() => badItem);
    const a = await proposeAction(p, input({ lesson: emptyLesson }));
    expect(a.type).toBe('no_action');
    Action.parse(a);
  });

  it('PROPERTY: every outcome is a contract-valid Action regardless of provider behavior', async () => {
    const behaviors: ((call: number) => TacticalMove)[] = [
      () => goodItem,
      () => badItem,
      (c) => (c === 0 ? badItem : goodItem),
      () => ({ move: 'no_action', reason: 'thinking', rationale: 'r' }),
      () => ({ move: 'propose_mastery_transition', rationale: 'r' }),
      () => {
        throw new Error('boom');
      },
    ];
    for (const b of behaviors) {
      const a = await proposeAction(new ScriptedProvider(b), input());
      expect(() => Action.parse(a)).not.toThrow();
    }
  });
});
