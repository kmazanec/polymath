/**
 * C9 tests — AskTutorButton voice activity (data-voice-activity) prop.
 *
 * - When connected + activity prop is provided, data-voice-activity reflects it.
 * - When NOT connected, data-voice-activity is absent (never set regardless of prop).
 * - When connected but activity prop is absent, data-voice-activity is absent.
 * - Existing AskTutorButton behavior (start/stop/disabled states) is unchanged.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AskTutorButton } from './AskTutorButton.js';
import type { VoiceClient } from './client.js';
import type { VoiceActivity } from './AskTutorButton.js';

afterEach(cleanup);

type VoiceState = VoiceClient['state'];

function makeClientSpy(initialState: VoiceState = 'idle') {
  let _state: VoiceState = initialState;
  let _listener: (() => void) | undefined;

  const spy = {
    get state() {
      return _state;
    },
    get stream() {
      return null;
    },
    _setState(s: VoiceState) {
      _state = s;
      _listener?.();
    },
    start: vi.fn(),
    stop: vi.fn(),
    onStateChange(fn: () => void) {
      _listener = fn;
    },
  } as unknown as VoiceClient & {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    _setState: (s: VoiceState) => void;
    onStateChange: (fn: () => void) => void;
  };

  return spy;
}

function availabilityFetch(available: boolean): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ available }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

async function renderAvailable(client: ReturnType<typeof makeClientSpy>, activity?: VoiceActivity) {
  render(
    <AskTutorButton
      sessionId="sess-1"
      client={client as unknown as VoiceClient}
      fetchFn={availabilityFetch(true)}
      activity={activity}
    />,
  );
  await waitFor(() => {
    expect(screen.getByRole('button').textContent?.toLowerCase()).not.toMatch(/checking/);
  });
  return screen.getByRole('button') as HTMLButtonElement;
}

describe('AskTutorButton — data-voice-activity (C9)', () => {
  it('sets data-voice-activity="listening" when connected + activity="listening"', async () => {
    const client = makeClientSpy('connected');
    const btn = await renderAvailable(client, 'listening');
    expect(btn.getAttribute('data-voice-activity')).toBe('listening');
  });

  it('sets data-voice-activity="thinking" when connected + activity="thinking"', async () => {
    const client = makeClientSpy('connected');
    const btn = await renderAvailable(client, 'thinking');
    expect(btn.getAttribute('data-voice-activity')).toBe('thinking');
  });

  it('sets data-voice-activity="agent-speaking" when connected + activity="agent-speaking"', async () => {
    const client = makeClientSpy('connected');
    const btn = await renderAvailable(client, 'agent-speaking');
    expect(btn.getAttribute('data-voice-activity')).toBe('agent-speaking');
  });

  it('does NOT set data-voice-activity when NOT connected (even if activity prop is given)', async () => {
    // When idle, the button should never carry data-voice-activity.
    const client = makeClientSpy('idle');
    const btn = await renderAvailable(client, 'listening');
    expect(btn.getAttribute('data-voice-activity')).toBeNull();
  });

  it('does NOT set data-voice-activity when connected but activity prop is absent', async () => {
    const client = makeClientSpy('connected');
    const btn = await renderAvailable(client); // no activity prop
    expect(btn.getAttribute('data-voice-activity')).toBeNull();
  });

  it('updates data-voice-activity when client transitions from connecting to connected', async () => {
    const client = makeClientSpy('idle');
    render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={availabilityFetch(true)}
        activity="listening"
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('button').textContent?.toLowerCase()).not.toMatch(/checking/);
    });
    const btn = screen.getByRole('button') as HTMLButtonElement;

    // Initially idle — no activity attribute.
    expect(btn.getAttribute('data-voice-activity')).toBeNull();

    // Simulate connecting → connected.
    (client as unknown as { _setState: (s: VoiceState) => void })._setState('connected');
    await waitFor(() => {
      expect(btn.getAttribute('data-voice-activity')).toBe('listening');
    });
  });
});

describe('AskTutorButton — voice activity does not break existing behaviour', () => {
  it('existing tests still pass: calls start() once on click when idle', async () => {
    const client = makeClientSpy('idle');
    const btn = await renderAvailable(client, 'listening');
    fireEvent.click(btn);
    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it('existing: calls stop() when clicked while connected', async () => {
    const client = makeClientSpy('connected');
    const btn = await renderAvailable(client, 'agent-speaking');
    fireEvent.click(btn);
    expect(client.stop).toHaveBeenCalledTimes(1);
  });
});
