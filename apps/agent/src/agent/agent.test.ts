import { describe, expect, it } from 'vitest';
import { Action } from '@polymath/contract';
import { runAgentTurn } from './graph.js';
import { StubAgentClient } from './stubClient.js';
import { validateOutboundAction } from './validateAction.js';

describe('LangGraph stub', () => {
  it('emits a schema-valid no_action for any event', async () => {
    const action = await runAgentTurn({
      kind: 'submit',
      sessionId: 's',
      itemId: 'i',
      submission: 'A AND B',
    });
    expect(action.type).toBe('no_action');
    expect(() => Action.parse(action)).not.toThrow();
  });

  it('StubAgentClient.propose delegates to the graph', async () => {
    const action = await new StubAgentClient().propose({
      kind: 'session_start',
      sessionId: 's',
      lessonId: 1,
    });
    expect(action.type).toBe('no_action');
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
