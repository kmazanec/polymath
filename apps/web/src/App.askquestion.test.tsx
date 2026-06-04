/**
 * Typed-question echo test.
 *
 * When the learner types a question and hits Send, the question must appear in
 * the durable transcript IMMEDIATELY as a learner spoken-turn bubble — the same
 * "You: …" bubble the voice path produces — so the conversation reads as
 * you → tutor → you, not disembodied agent replies. (UX fix: previously the
 * typed question was sent to the server and discarded from the view.)
 *
 * It also guards the double-echo seam: a TYPED answer_question reply (spoken
 * absent) must NOT prepend a second learner bubble — that prepend is reserved
 * for the voice path, where the question wasn't echoed on send.
 *
 * Driven via the same AgentSocket double used by App.voicestream.test.tsx, but
 * the double here CAPTURES sent ClientEvents so the test can assert the wire
 * send still fires.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ClientEvent, ServerMessage } from '@polymath/contract';
import type { AgentSocketHandlers } from './ws/client.js';

// ── AgentSocket double (captures sent events) ────────────────────────────────

let capturedHandlers: AgentSocketHandlers | null = null;
let sentEvents: ClientEvent[] = [];

vi.mock('./ws/client.js', () => ({
  AgentSocket: class {
    constructor(_url: string, handlers: AgentSocketHandlers) {
      capturedHandlers = handlers;
    }
    connect(): void {
      capturedHandlers?.onOpen?.();
    }
    send(event: ClientEvent): void {
      sentEvents.push(event);
    }
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

const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function pushMessage(msg: ServerMessage): void {
  act(() => {
    capturedHandlers?.onMessage(msg);
  });
}

beforeEach(() => {
  capturedHandlers = null;
  sentEvents = [];
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

/** Type `q` into the composer and submit, returning the rendered container. */
function askQuestion(container: HTMLElement, q: string): void {
  const input = container.querySelector('#ask-agent-input') as HTMLInputElement;
  const form = container.querySelector('.composer__bar') as HTMLFormElement;
  act(() => {
    fireEvent.change(input, { target: { value: q } });
  });
  act(() => {
    fireEvent.submit(form);
  });
}

describe('typed question echo', () => {
  it('appends the learner question to the durable transcript IMMEDIATELY on send', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    askQuestion(container, 'why is A AND B false when A is true?');

    // A durable learner spoken-turn bubble appears in the transcript log — before
    // any server reply arrives.
    await waitFor(() => {
      const region = container.querySelector('[aria-label="Lesson log"]');
      const learnerBubble = region?.querySelector('.transcript-spoken--learner');
      expect(learnerBubble).not.toBeNull();
      expect(learnerBubble?.textContent).toContain('why is A AND B false when A is true?');
    });

    // The question still goes over the wire as a learner_question event.
    const sent = sentEvents.find((e) => e.kind === 'learner_question');
    expect(sent).toBeDefined();
    expect(sent).toMatchObject({ question: 'why is A AND B false when A is true?' });

    // The input is cleared.
    const input = container.querySelector('#ask-agent-input') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('a TYPED answer_question reply does NOT add a second learner bubble (no double-echo)', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    askQuestion(container, 'what is OR?');
    await waitFor(() => {
      const region = container.querySelector('[aria-label="Lesson log"]');
      expect(region?.querySelectorAll('.transcript-spoken--learner').length).toBe(1);
    });

    // Server replies with a TYPED answer (spoken absent) — the answer-path
    // learner-bubble prepend is gated on `spoken`, so it must NOT fire here.
    pushMessage({
      kind: 'action',
      sessionId: SESSION_ID,
      action: {
        type: 'answer_question',
        question: 'what is OR?',
        answer: 'OR outputs 1 if at least one input is 1.',
        topicClassification: 'on_topic',
        rationale: 'r',
      },
    } as ServerMessage);

    await waitFor(() => {
      const region = container.querySelector('[aria-label="Lesson log"]');
      // Still exactly ONE learner bubble — the agent answer card joined the log,
      // but no duplicate "You: what is OR?" was added.
      expect(region?.querySelectorAll('.transcript-spoken--learner').length).toBe(1);
      expect(region?.textContent).toContain('OR outputs 1 if at least one input is 1.');
    });
  });

  it('does not send or echo an empty/whitespace question', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    askQuestion(container, '   ');

    const region = container.querySelector('[aria-label="Lesson log"]');
    expect(region?.querySelector('.transcript-spoken--learner')).toBeNull();
    expect(sentEvents.find((e) => e.kind === 'learner_question')).toBeUndefined();
  });
});
