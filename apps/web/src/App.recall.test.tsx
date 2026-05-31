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
  // F-27 AC#7: prompt is required; without it the registry renders a PromptMissing
  // error element instead of the truth table.
  prompt: 'Fill in the truth table for A AND B.',
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
  it('mounts a recall in the transcript WITHOUT clobbering the practice workspace', async () => {
    const { container, findByRole } = render(<App />);
    // The socket opens synchronously in connect(); wait for the session fetch.
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    // Agent mounts a practice item (the main workspace).
    pushAction(TT_PRACTICE);
    await findByRole('table'); // the truth-table workspace is mounted

    // Agent then mounts a cross-lesson recall callout.
    pushAction(RECALL);

    // F-27: the recall is now in the TRANSCRIPT (append-only side turn), not a
    // separate `.recall-slot`.  The practice workspace SURVIVES.
    await waitFor(() => {
      const transcript = container.querySelector('[aria-label="Lesson log"]');
      expect(transcript?.textContent).toContain('NOT flips');
    });
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('[data-kc="NOT"]')).not.toBeNull();
  });

  it('recall appears in the transcript and workspace stays intact (AC#3)', async () => {
    // F-27 note: in the transcript model the recall is read-only history — there is
    // no "dismiss" button on the transcript turn.  The workspace keeps the in-progress
    // item alive; the recall is recorded for reference.  The old `.recall-slot` dismiss
    // flow is superseded by the append-only transcript model.
    const { container, findByRole } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    pushAction(TT_PRACTICE);
    await findByRole('table');
    pushAction(RECALL);

    // Transcript receives the recall.
    await waitFor(() => {
      const transcript = container.querySelector('[aria-label="Lesson log"]');
      expect(transcript?.textContent).toContain('NOT flips');
    });

    // Practice item is still in the workspace (AC#3: resumes at the same item).
    expect(container.querySelector('table')).not.toBeNull();
  });
});
