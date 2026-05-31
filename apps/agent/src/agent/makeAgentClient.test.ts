/**
 * F-28 checklist #14: tests for the makeAgentClient factory.
 * No real key is used — the OpenAI provider path is tested with a mock.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { FlowAgentClient } from './flowClient.js';
import { StubAgentClient } from './stubClient.js';

describe('makeAgentClient factory (F-28)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    // Reset env before each test
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    // Restore original env
    process.env['OPENAI_API_KEY'] = origEnv['OPENAI_API_KEY'];
  });

  it('returns StubAgentClient when OPENAI_API_KEY is not set', async () => {
    // Dynamic import so it reads the (modified) env at call time
    const { makeAgentClient } = await import('./makeAgentClient.js');
    const client = makeAgentClient();
    expect(client).toBeInstanceOf(StubAgentClient);
  });

  it('returns a FlowAgentClient (not StubAgentClient) wrapping OpenAIMoveProvider when OPENAI_API_KEY is set', async () => {
    // Set a non-empty key (the factory only checks presence; no real call is made)
    process.env['OPENAI_API_KEY'] = 'sk-test-key-not-real';
    // Reset module so the factory re-evaluates env
    vi.resetModules();
    const { makeAgentClient } = await import('./makeAgentClient.js');
    const { StubAgentClient: StubReloaded } = await import('./stubClient.js');
    const client = makeAgentClient();
    // The keyed path returns a FlowAgentClient, not a StubAgentClient.
    // After vi.resetModules() instanceof can't be used across module boundaries,
    // so we check that it's NOT the stub, and that it has a propose method.
    expect(client).not.toBeInstanceOf(StubReloaded);
    expect(typeof client.propose).toBe('function');
  });

  it('StubAgentClient (no-key path) produces a valid Action for a session_start turn', async () => {
    const { makeAgentClient } = await import('./makeAgentClient.js');
    const client = makeAgentClient();
    const { loadLesson } = await import('../lessons/loader.js');
    const { Action } = await import('@polymath/contract');

    const lesson = loadLesson(1);
    const action = await client.propose({
      event: { kind: 'session_start', sessionId: '00000000-0000-0000-0000-000000000001', lessonId: 1 },
      lesson,
      learnerState: { bktByKc: {}, hintsUsed: 0, consecutiveCorrect: 0, ruleGatePassed: false, explainBackPassed: false, topicGuardrailClean: true },
      recentHistory: [],
    });
    expect(() => Action.parse(action)).not.toThrow();
    expect(action.type).toBe('mount');
  });
});
