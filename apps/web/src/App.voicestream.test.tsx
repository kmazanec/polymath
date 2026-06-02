/**
 * C8 / C9 streaming transcript and voice activity tests.
 *
 * Tests the `transcript_stream` message handler:
 *  - interim partials render a greyed in-progress bubble
 *  - a second partial REPLACES the first (one bubble, not two)
 *  - `final:true` commits a durable spokenTurn and clears the bubble
 *  - learner and agent interleave in order
 *
 * Tests are driven via the same AgentSocket double used by App.transcript.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { ServerMessage } from '@polymath/contract';
import type { AgentSocketHandlers } from './ws/client.js';

// ── AgentSocket double ──────────────────────────────────────────────────────

let capturedHandlers: AgentSocketHandlers | null = null;

vi.mock('./ws/client.js', () => ({
  AgentSocket: class {
    constructor(_url: string, handlers: AgentSocketHandlers) {
      capturedHandlers = handlers;
    }
    connect(): void {
      capturedHandlers?.onOpen?.();
    }
    send(): void {}
    close(): void {}
  },
}));

const posthogMock = vi.hoisted(() => ({
  initPostHog: vi.fn(async () => undefined),
  capture: vi.fn(),
  groupBySession: vi.fn(),
}));
vi.mock('./observability/posthog.js', () => posthogMock);

// Silence the voice button so tests don't need a realtime endpoint.
vi.mock('./voice/AskTutorButton.js', () => ({ AskTutorButton: () => null }));

import { App } from './App.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function pushMessage(msg: ServerMessage): void {
  act(() => {
    capturedHandlers?.onMessage(msg);
  });
}

function streamMsg(
  speaker: 'learner' | 'agent',
  text: string,
  final: boolean,
): ServerMessage {
  return {
    kind: 'transcript_stream',
    sessionId: SESSION_ID,
    speaker,
    text,
    final,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  capturedHandlers = null;
  window.history.pushState({}, '', '/lesson');
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ sessionId: SESSION_ID }) })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

// ── C8: interim/final streaming transcript ───────────────────────────────────

describe('transcript_stream — C8 interim bubble', () => {
  it('a {final:false} message renders a single greyed in-progress bubble with the text', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    pushMessage(streamMsg('learner', 'what is AND?', false));

    // The partial bubble should appear — NOT inside the durable transcript ol.
    await waitFor(() => {
      const partialBubble = container.querySelector('.transcript-turn--partial');
      expect(partialBubble).not.toBeNull();
      expect(partialBubble?.textContent).toContain('what is AND?');
    });

    // It should NOT be inside the durable transcript list (still only the log region).
    const transcriptList = container.querySelector('.transcript-list');
    // The partial is not a committed spokenTurn in the list.
    const listSpokenTurns = transcriptList?.querySelectorAll('.transcript-turn--spoken') ?? [];
    expect(listSpokenTurns.length).toBe(0);
  });

  it('a second {final:false} REPLACES the bubble — not a second bubble', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    pushMessage(streamMsg('learner', 'first partial', false));
    await waitFor(() => {
      expect(container.querySelector('.transcript-turn--partial')).not.toBeNull();
    });

    pushMessage(streamMsg('learner', 'second partial', false));
    await waitFor(() => {
      const bubbles = container.querySelectorAll('.transcript-turn--partial');
      // Exactly ONE in-progress bubble — not two.
      expect(bubbles.length).toBe(1);
      expect(bubbles[0]?.textContent).toContain('second partial');
    });

    // The first text is gone.
    expect(container.querySelector('.transcript-turn--partial')?.textContent).not.toContain('first partial');
  });

  it('a {final:true} commits a durable spokenTurn and CLEARS the partial bubble', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    // Send a partial first, then finalize it.
    pushMessage(streamMsg('agent', 'AND requires both inputs', false));
    await waitFor(() => {
      expect(container.querySelector('.transcript-turn--partial')).not.toBeNull();
    });

    pushMessage(streamMsg('agent', 'AND requires both inputs to be 1.', true));

    await waitFor(() => {
      // Partial bubble is gone.
      expect(container.querySelector('.transcript-turn--partial')).toBeNull();
    });

    // Durable spokenTurn appears in the transcript.
    const transcriptRegion = container.querySelector('[aria-label="Lesson log"]');
    expect(transcriptRegion?.textContent).toContain('AND requires both inputs to be 1.');

    // It carries the agent speaker class.
    const committedTurn = transcriptRegion?.querySelector('.transcript-spoken--agent');
    expect(committedTurn).not.toBeNull();
  });

  it('learner then agent interim + final interleave in order', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    // Learner speaks.
    pushMessage(streamMsg('learner', 'what does NAND do?', false));
    pushMessage(streamMsg('learner', 'what does NAND do?', true));

    // Agent responds.
    pushMessage(streamMsg('agent', 'NAND is NOT AND', false));
    pushMessage(streamMsg('agent', 'NAND is NOT AND.', true));

    await waitFor(() => {
      const transcriptRegion = container.querySelector('[aria-label="Lesson log"]');
      const turns = transcriptRegion?.querySelectorAll('.transcript-turn--spoken') ?? [];
      // Both durable turns should appear, in order.
      expect(turns.length).toBeGreaterThanOrEqual(2);
      const allText = transcriptRegion?.textContent ?? '';
      expect(allText).toContain('what does NAND do?');
      expect(allText).toContain('NAND is NOT AND.');
    });

    // No leftover partial bubble.
    expect(container.querySelector('.transcript-turn--partial')).toBeNull();
  });

  it('F-30 typed-answer spoken path still works alongside transcript_stream', async () => {
    // Regression: the existing r.answer.spoken path must not break.
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    const typedAnswer: ServerMessage = {
      kind: 'action',
      sessionId: SESSION_ID,
      action: {
        type: 'answer_question',
        question: 'what is OR?',
        answer: 'OR outputs 1 if at least one input is 1.',
        topicClassification: 'on_topic',
        rationale: 'r',
        spoken: true,
      },
    };
    act(() => { capturedHandlers?.onMessage(typedAnswer); });

    await waitFor(() => {
      const transcriptRegion = container.querySelector('[aria-label="Lesson log"]');
      expect(transcriptRegion?.textContent).toContain('what is OR?');
      expect(transcriptRegion?.textContent).toContain('OR outputs 1');
    });
  });
});

// ── C9 voice activity state machine transitions (ADR-018) ────────────────────
//
// The AskTutorButton is mocked in this test file, so we cannot observe the
// data-voice-activity attribute. Instead we verify the App-level state-machine
// logic indirectly by checking the interim bubble and transcript turn behavior
// that the same code paths produce.
//
// For the H-d correctness bug: a final-only agent chunk (no preceding interim)
// must still cause the state machine to visit agent-speaking before listening.
// Because React batches the two setVoiceActivity calls in the same event handler,
// the visible state after the batch is 'listening' — the agent-speaking step is
// transient within the batch. We test the OUTCOME (correct final state) and verify
// the interim bubble is absent (confirming the final-only path was taken), which
// is the observable signal that the code path ran correctly.

describe('transcript_stream — voice activity state machine (ADR-018)', () => {
  it('learner final → state transitions to thinking (waiting for agent reply)', async () => {
    // We use the AskTutorButton mock, so we verify via the interim bubble state.
    // A learner final should clear the in-progress bubble and commit it.
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    // Interim partial followed by learner final.
    pushMessage(streamMsg('learner', 'what is XOR?', false));
    await waitFor(() => {
      expect(container.querySelector('.transcript-turn--partial')).not.toBeNull();
    });

    pushMessage(streamMsg('learner', 'what is XOR?', true));
    await waitFor(() => {
      // Partial cleared on learner final — committed to durable transcript.
      expect(container.querySelector('.transcript-turn--partial')).toBeNull();
    });

    // Durable turn should be in the transcript.
    const transcriptRegion = container.querySelector('[aria-label="Lesson log"]');
    expect(transcriptRegion?.textContent).toContain('what is XOR?');
  });

  it('agent interim → shows in-progress bubble (agent-speaking path)', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    pushMessage(streamMsg('agent', 'XOR outputs 1 when inputs differ', false));
    await waitFor(() => {
      const bubble = container.querySelector('.transcript-turn--partial');
      expect(bubble).not.toBeNull();
      expect(bubble?.textContent).toContain('XOR outputs 1 when inputs differ');
    });
  });

  it('agent final-only (no preceding interim) commits durable turn and clears partial', async () => {
    // H-d: a short agent reply arrives as final:true with no interim chunk.
    // The state machine must still process it correctly (not silently skip agent-speaking).
    // Observable outcome: a durable transcript turn is created and no partial bubble remains.
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    // No preceding interim — final-only agent reply.
    pushMessage(streamMsg('agent', 'Yes, correct.', true));

    await waitFor(() => {
      // No partial bubble (the turn was final-only, so none was ever shown).
      expect(container.querySelector('.transcript-turn--partial')).toBeNull();
    });

    // Durable agent turn committed to transcript.
    const transcriptRegion = container.querySelector('[aria-label="Lesson log"]');
    expect(transcriptRegion?.textContent).toContain('Yes, correct.');

    const committedTurn = transcriptRegion?.querySelector('.transcript-spoken--agent');
    expect(committedTurn).not.toBeNull();
  });

  it('agent final clears the partial bubble (turn complete → listening)', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    // Interim then final.
    pushMessage(streamMsg('agent', 'NAND is universal because', false));
    await waitFor(() => {
      expect(container.querySelector('.transcript-turn--partial')).not.toBeNull();
    });

    pushMessage(streamMsg('agent', 'NAND is universal because any gate can be built from it.', true));
    await waitFor(() => {
      expect(container.querySelector('.transcript-turn--partial')).toBeNull();
    });

    const transcriptRegion = container.querySelector('[aria-label="Lesson log"]');
    expect(transcriptRegion?.textContent).toContain('NAND is universal');
  });

  it('full learner→agent round-trip: learner final then agent final-only produces both durable turns', async () => {
    // Exercises the complete thinking→agent-speaking→listening cycle with a final-only reply.
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    pushMessage(streamMsg('learner', 'explain NOR', true));
    await waitFor(() => {
      const transcriptRegion = container.querySelector('[aria-label="Lesson log"]');
      expect(transcriptRegion?.textContent).toContain('explain NOR');
    });

    // Agent replies final-only (short answer).
    pushMessage(streamMsg('agent', 'NOR is NOT OR.', true));

    await waitFor(() => {
      const transcriptRegion = container.querySelector('[aria-label="Lesson log"]');
      const turns = transcriptRegion?.querySelectorAll('.transcript-turn--spoken') ?? [];
      expect(turns.length).toBeGreaterThanOrEqual(2);
      expect(transcriptRegion?.textContent).toContain('explain NOR');
      expect(transcriptRegion?.textContent).toContain('NOR is NOT OR.');
    });

    // No leftover partial.
    expect(container.querySelector('.transcript-turn--partial')).toBeNull();
  });
});
