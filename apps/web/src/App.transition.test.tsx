import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ClientEvent, ServerMessage } from '@polymath/contract';

/**
 * F-15 client AC#2 evidence: the missing React-level test. The statechart
 * `lesson_2 re-instantiation parity` block proves a fresh `lessonId:2` actor
 * behaves — but App.tsx must actually CREATE that actor on advance. This drives
 * the real App: connect → mount L1 practice → reach mastery → click "continue to
 * Lesson 2" → feed the server's L2 mount → assert the derived phase reaches
 * `practicing` for L2 (and the Hint button renders). Before the fix the App
 * mounts the machine once with `lessonId:1`, reaches the `mastered` FINAL state,
 * and ignores every later event, so L2 never leaves `introducing` — this test
 * fails. After the fix (session-level re-instantiation keyed on lessonId) it
 * passes.
 */

// A fake AgentSocket captured by the test so it can drive inbound messages and
// inspect outbound sends, standing in for a live agent stream.
let lastSocket: FakeSocket | null = null;
const sent: ClientEvent[] = [];

class FakeSocket {
  handlers: {
    onMessage: (msg: ServerMessage) => void;
    onOpen?: () => void;
    onClose?: () => void;
  };
  constructor(_url: string, handlers: FakeSocket['handlers']) {
    this.handlers = handlers;
    lastSocket = this;
  }
  connect(): void {
    // Open synchronously-ish; the test triggers via act() below.
    this.handlers.onOpen?.();
  }
  send(event: ClientEvent): void {
    sent.push(event);
  }
  close(): void {}
  receive(msg: ServerMessage): void {
    this.handlers.onMessage(msg);
  }
}

vi.mock('./ws/client.js', () => ({
  AgentSocket: FakeSocket,
}));

// The voice button hits a session-scoped token endpoint on mount; stub it so the
// component tree mounts cleanly under jsdom.
vi.mock('./voice/AskTutorButton.js', () => ({
  AskTutorButton: () => null,
}));

let App: (typeof import('./App.js'))['App'];

beforeEach(async () => {
  lastSocket = null;
  sent.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => ({ sessionId: 'sess-1' }),
    }),
  );
  ({ App } = await import('./App.js'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const l1Practice: ServerMessage = {
  kind: 'action',
  action: {
    type: 'mount',
    component: {
      kind: 'TruthTablePractice',
      // F-27 AC#7: prompt required so the renderer does not hit PromptMissing.
      // Expression uses booleans grammar keywords (AND/OR), not symbols (&/|).
      expression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      visibleReps: ['truth_table'],
      prompt: 'Complete the truth table for: A AND B',
    },
  },
};

const l2Practice: ServerMessage = {
  kind: 'action',
  action: {
    type: 'mount',
    component: {
      kind: 'TruthTablePractice',
      // F-27 AC#7: prompt required so the renderer does not hit PromptMissing.
      // Before the server.ts fix the advance reflex built the ComponentSpec
      // without a `prompt` field, causing PromptMissing to render instead of
      // the L2 workspace (finding F27-1).
      // Expression uses booleans grammar keywords (AND/OR), not symbols (&/|).
      expression: 'A OR B',
      claimedTruthTable: [0, 1, 1, 1],
      visibleReps: ['truth_table'],
      prompt: 'Complete the truth table for: A OR B',
    },
  },
};

describe('App L1 → L2 macro transition (F-15 client AC#2)', () => {
  it('re-instantiates the spine on advance so L2 reaches the practicing phase', async () => {
    const { container } = render(<App />);

    // Wait for the session POST to resolve and the socket to open.
    await waitFor(() => expect(lastSocket).not.toBeNull());
    const socket = lastSocket!;

    // L1: a practice item lands → spine introducing → practicing.
    act(() => socket.receive(l1Practice));
    await waitFor(() =>
      expect(container.querySelector('[data-phase="practicing"]')).not.toBeNull(),
    );
    expect(container.querySelector('.hint-button')).not.toBeNull();

    // Drive L1 to mastery: the agent mounts the celebration with a nextLessonId
    // (the server only sets it when L1 mastery is server-derived).
    const masteryMsg: ServerMessage = {
      kind: 'action',
      action: {
        type: 'mount',
        component: { kind: 'MasteryCelebration', conceptsMastered: ['AND'], nextLessonId: 2 },
      },
    };
    act(() => socket.receive(masteryMsg));

    const continueBtn = await waitFor(() => {
      const btn = container.querySelector('.continue-to-next-lesson') as HTMLButtonElement | null;
      expect(btn).not.toBeNull();
      expect(btn!.disabled).toBe(false);
      return btn!;
    });

    // Click "continue to Lesson 2": sends advance_lesson on the SAME session.
    act(() => fireEvent.click(continueBtn));
    expect(sent.some((e) => e.kind === 'advance_lesson' && e.toLessonId === 2)).toBe(true);

    // AC#2 (the re-instantiation): advancing tears down the L1 spine (which carries
    // L1's `practicing` progress + `lessonId:1` in context) and re-mounts a FRESH
    // spine for L2 in `introducing`. Before the fix App mounts the machine once with
    // `lessonId:1` and never re-instantiates, so the phase stays at whatever L1 left
    // it (`practicing`) instead of resetting to `introducing` — this fails today.
    const phaseEl = () => container.querySelector('main > p[aria-live="polite"]');
    await waitFor(() => {
      expect(phaseEl()?.getAttribute('data-phase')).toBe('introducing');
    });

    // The server's deterministic L2 mount then arrives over the same socket and
    // drives the FRESH L2 spine introducing → practicing.
    act(() => socket.receive(l2Practice));
    await waitFor(() => {
      expect(phaseEl()?.getAttribute('data-phase')).toBe('practicing');
      // F27-1: The L2 workspace must render the actual truth table, NOT a
      // PromptMissing alert.  Before the server fix the advance reflex built the
      // ComponentSpec without a `prompt` field, which (per F-27 AC#7) causes
      // registry.tsx to return the `role="alert"` PromptMissing placeholder.
      // Both assertions land inside waitFor so they wait for the same React flush
      // that delivers the mounted spec and the phase update.
      expect(container.querySelector('[role="alert"][data-prompt-missing]')).toBeNull();
      expect(container.querySelector('table[role="table"]')).not.toBeNull();
    });
    // The Hint button renders again for the L2 item (only shown in practicing).
    expect(container.querySelector('.hint-button')).not.toBeNull();
  });
});
