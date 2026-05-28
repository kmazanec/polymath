import { describe, expect, it } from 'vitest';
import { Action } from '@polymath/contract';
import { StubAgentClient } from '../agent/stubClient.js';
import type { AgentInput } from '../agent/client.js';
import { loadLesson } from '../lessons/loader.js';

const lesson = loadLesson(1);
const SID = '00000000-0000-0000-0000-000000000000';

function input(
  event: AgentInput['event'],
  recentHistory: AgentInput['recentHistory'] = [],
): AgentInput {
  return {
    event,
    lesson,
    learnerState: { bktByKc: {}, hintsUsed: 0, consecutiveCorrect: 0, ruleGatePassed: false, explainBackPassed: false, topicGuardrailClean: true },
    recentHistory,
  };
}

describe('hint flow — end-to-end (heuristic, key-free)', () => {
  it('first request_hint → mounts HintCard at level 1 (criterion 2)', async () => {
    const action = await new StubAgentClient().propose(
      input({ kind: 'request_hint', sessionId: SID, itemId: 'l1-and' }),
    );
    expect(action.type).toBe('mount');
    expect(() => Action.parse(action)).not.toThrow();
    if (action.type !== 'mount') throw new Error('unreachable');
    expect(action.component.kind).toBe('HintCard');
    if (action.component.kind !== 'HintCard') throw new Error('unreachable');
    expect(action.component.level).toBe(1);
    expect(action.component.body.length).toBeGreaterThan(5);
  });

  it('second request_hint on same item → HintCard level 2 (criterion 3)', async () => {
    const history: AgentInput['recentHistory'] = [
      { eventKind: 'request_hint', actionType: 'mount', rationale: 'L1 hint', itemId: 'l1-and' },
    ];
    const action = await new StubAgentClient().propose(
      input({ kind: 'request_hint', sessionId: SID, itemId: 'l1-and' }, history),
    );
    expect(action.type).toBe('mount');
    if (action.type !== 'mount') throw new Error('unreachable');
    expect(action.component.kind).toBe('HintCard');
    if (action.component.kind !== 'HintCard') throw new Error('unreachable');
    expect(action.component.level).toBe(2);
  });

  it('third request_hint on same item → HintCard level 3 (criterion 4)', async () => {
    const history: AgentInput['recentHistory'] = [
      { eventKind: 'request_hint', actionType: 'mount', rationale: 'L1 hint', itemId: 'l1-and' },
      { eventKind: 'request_hint', actionType: 'mount', rationale: 'L2 hint', itemId: 'l1-and' },
    ];
    const action = await new StubAgentClient().propose(
      input({ kind: 'request_hint', sessionId: SID, itemId: 'l1-and' }, history),
    );
    expect(action.type).toBe('mount');
    if (action.type !== 'mount') throw new Error('unreachable');
    expect(action.component.kind).toBe('HintCard');
    if (action.component.kind !== 'HintCard') throw new Error('unreachable');
    expect(action.component.level).toBe(3);
  });

  it('fourth request_hint → no_action (all levels exhausted, criterion 5)', async () => {
    const history: AgentInput['recentHistory'] = [
      { eventKind: 'request_hint', actionType: 'mount', rationale: 'L1 hint', itemId: 'l1-and' },
      { eventKind: 'request_hint', actionType: 'mount', rationale: 'L2 hint', itemId: 'l1-and' },
      { eventKind: 'request_hint', actionType: 'mount', rationale: 'L3 hint', itemId: 'l1-and' },
    ];
    const action = await new StubAgentClient().propose(
      input({ kind: 'request_hint', sessionId: SID, itemId: 'l1-and' }, history),
    );
    expect(action.type).toBe('no_action');
  });

  it('HintCard body references the item\'s actual expression content (criterion 6)', async () => {
    const action = await new StubAgentClient().propose(
      input({ kind: 'request_hint', sessionId: SID, itemId: 'l1-and' }),
    );
    if (action.type !== 'mount' || action.component.kind !== 'HintCard') {
      throw new Error('Expected HintCard mount');
    }
    // L1 hint for "A AND B" must mention AND, A, or B
    expect(/\b(AND|A|B)\b/.test(action.component.body)).toBe(true);
  });

  it('hint request for an item identified by targetExpression also works', async () => {
    // The web client may send the expression as the itemId (like submit events)
    const action = await new StubAgentClient().propose(
      input({ kind: 'request_hint', sessionId: SID, itemId: 'A AND B' }),
    );
    expect(action.type).toBe('mount');
    if (action.type !== 'mount') throw new Error('unreachable');
    expect(action.component.kind).toBe('HintCard');
    if (action.component.kind !== 'HintCard') throw new Error('unreachable');
    expect(action.component.level).toBe(1);
  });

  it('prior hints on DIFFERENT item are not counted (level resets per item)', async () => {
    // Has 2 hints on l1-or, but 0 on l1-and → should give L1 for l1-and
    const history: AgentInput['recentHistory'] = [
      { eventKind: 'request_hint', actionType: 'mount', rationale: 'L1 hint', itemId: 'l1-or' },
      { eventKind: 'request_hint', actionType: 'mount', rationale: 'L2 hint', itemId: 'l1-or' },
    ];
    const action = await new StubAgentClient().propose(
      input({ kind: 'request_hint', sessionId: SID, itemId: 'l1-and' }, history),
    );
    if (action.type !== 'mount' || action.component.kind !== 'HintCard') {
      throw new Error('Expected HintCard mount');
    }
    expect(action.component.level).toBe(1);
  });

  it('L3 hint body is logged with validatorStatus unverified_prose (criterion 7) — body is present and non-empty', async () => {
    // The L3 logging in server.ts is tested in the server unit test; here we
    // just confirm L3 body is non-empty prose (the server can flag it).
    const history: AgentInput['recentHistory'] = [
      { eventKind: 'request_hint', actionType: 'mount', rationale: 'L1 hint', itemId: 'l1-and' },
      { eventKind: 'request_hint', actionType: 'mount', rationale: 'L2 hint', itemId: 'l1-and' },
    ];
    const action = await new StubAgentClient().propose(
      input({ kind: 'request_hint', sessionId: SID, itemId: 'l1-and' }, history),
    );
    if (action.type !== 'mount' || action.component.kind !== 'HintCard') {
      throw new Error('Expected L3 HintCard');
    }
    expect(action.component.level).toBe(3);
    expect(action.component.body.length).toBeGreaterThan(20);
  });
});
