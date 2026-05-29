import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ComponentSpec, ServerMessage } from '@polymath/contract';
import type { AgentSocketHandlers } from './ws/client.js';

/**
 * F-14 App-wiring tests for the cross-lesson recall callout. The component test
 * (`CrossLessonRecall.test.tsx`) injects `onCrossLessonRecallDismiss` directly, so
 * it can't catch the real-app wiring. These tests drive a CrossLessonRecall through
 * the REAL `App` (mounted from a faked agent socket) and assert:
 *  - the recall lands in its OWN side slot, leaving the in-progress practice item
 *    in the main workspace intact (it is NOT clobbered — findings #1/#2);
 *  - clicking "got it, continue" dismisses the recall (the dismiss is WIRED, not a
 *    no-op) and the practice item is still there to resume (AC#3).
 */

// A controllable AgentSocket double: capture the handlers so the test can push
// server messages, and record sent frames.
let capturedHandlers: AgentSocketHandlers | null = null;
const sentFrames: unknown[] = [];

vi.mock('./ws/client.js', () => ({
  AgentSocket: class {
    constructor(_url: string, handlers: AgentSocketHandlers) {
      capturedHandlers = handlers;
    }
    connect(): void {
      capturedHandlers?.onOpen?.();
    }
    send(event: unknown): void {
      sentFrames.push(event);
    }
    close(): void {}
  },
}));

import { App } from './App.js';

const SESSION_ID = '11111111-1111-1111-1111-111111111111';

const TT_PRACTICE: ComponentSpec = {
  kind: 'TruthTablePractice',
  expression: 'A AND B',
  claimedTruthTable: [0, 0, 0, 1],
  visibleReps: ['truth_table'],
};

const RECALL: ComponentSpec = {
  kind: 'CrossLessonRecall',
  kc: 'NOT',
  currentItemId: 'A AND B',
  priorBktAtRegression: 0.72,
  reminderBody: 'Remember from Lesson 1: NOT flips its input.',
};

function pushAction(action: ComponentSpec): void {
  const msg: ServerMessage = {
    kind: 'action',
    sessionId: SESSION_ID,
    action: { type: 'mount', component: action, rationale: 'test' },
  };
  act(() => {
    capturedHandlers?.onMessage(msg);
  });
}

beforeEach(() => {
  capturedHandlers = null;
  sentFrames.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ sessionId: SESSION_ID }) })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App cross-lesson recall wiring (F-14 AC#3, findings #1/#2)', () => {
  it('mounts a recall in its own slot WITHOUT clobbering the practice workspace', async () => {
    const { container, findByRole } = render(<App />);
    // The socket opens synchronously in connect(); wait for the session fetch.
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    // Agent mounts a practice item (the main workspace).
    pushAction(TT_PRACTICE);
    await findByRole('table'); // the truth-table workspace is mounted

    // Agent then mounts a cross-lesson recall callout.
    pushAction(RECALL);
    await findByRole('note');

    // The recall is in its OWN side slot — the practice workspace SURVIVES.
    expect(container.querySelector('.recall-slot')).not.toBeNull();
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('[data-kc="NOT"]')).not.toBeNull();
  });

  it('dismisses the recall on "got it, continue" and resumes the practice flow (AC#3)', async () => {
    const { container, findByRole, getByRole } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    pushAction(TT_PRACTICE);
    await findByRole('table');
    pushAction(RECALL);
    await findByRole('note');

    // The dismiss is WIRED (not a no-op): clicking it removes the callout.
    fireEvent.click(getByRole('button', { name: /got it/i }));

    await waitFor(() => expect(container.querySelector('.recall-slot')).toBeNull());
    // The practice item is still mounted — the flow resumes where it was.
    expect(container.querySelector('table')).not.toBeNull();
  });
});
