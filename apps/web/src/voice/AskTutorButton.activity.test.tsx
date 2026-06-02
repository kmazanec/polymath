/**
 * AskTutorButton voice activity (data-voice-activity) prop tests.
 *
 * Covers:
 * - data-voice-activity attribute reflects the activity prop when connected.
 * - Absent when not connected or when activity prop is absent.
 * - Per-state SVG glyph is rendered (distinct shape per state, WCAG 1.4.1 / ADR-004).
 * - aria-live region announces the activity state text for screen readers (WCAG 4.1.3).
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

describe('AskTutorButton — per-state SVG glyph (WCAG 1.4.1 / ADR-004)', () => {
  it('renders an SVG when connected + activity="listening" (mic shape)', async () => {
    const client = makeClientSpy('connected');
    const { container } = render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={availabilityFetch(true)}
        activity="listening"
      />,
    );
    await waitFor(() => {
      const btn = container.querySelector('.ask-tutor__button');
      expect(btn?.querySelector('svg')).not.toBeNull();
    });
  });

  it('renders an SVG when connected + activity="thinking" (three-dots shape)', async () => {
    const client = makeClientSpy('connected');
    const { container } = render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={availabilityFetch(true)}
        activity="thinking"
      />,
    );
    await waitFor(() => {
      const btn = container.querySelector('.ask-tutor__button');
      expect(btn?.querySelector('svg')).not.toBeNull();
    });
  });

  it('renders an SVG when connected + activity="agent-speaking" (speaker shape)', async () => {
    const client = makeClientSpy('connected');
    const { container } = render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={availabilityFetch(true)}
        activity="agent-speaking"
      />,
    );
    await waitFor(() => {
      const btn = container.querySelector('.ask-tutor__button');
      expect(btn?.querySelector('svg')).not.toBeNull();
    });
  });

  it('renders the mic emoji (not SVG) when idle — idle state is NOT a voice-activity state', async () => {
    const client = makeClientSpy('idle');
    const { container } = render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={availabilityFetch(true)}
        activity="listening"
      />,
    );
    await waitFor(() => {
      const btn = container.querySelector('.ask-tutor__button');
      // Idle: no activity attribute → the emoji span, not an SVG glyph
      expect(btn?.querySelector('svg')).toBeNull();
      expect(btn?.querySelector('span[aria-hidden]')).not.toBeNull();
    });
  });

  it('each activity state produces a distinct SVG structure (different shapes)', async () => {
    async function getButtonSvgContent(activity: VoiceActivity): Promise<string> {
      const client = makeClientSpy('connected');
      const { container, unmount } = render(
        <AskTutorButton
          sessionId="sess-1"
          client={client as unknown as VoiceClient}
          fetchFn={availabilityFetch(true)}
          activity={activity}
        />,
      );
      await waitFor(() => {
        expect(container.querySelector('.ask-tutor__button svg')).not.toBeNull();
      });
      const svg = container.querySelector('.ask-tutor__button svg')?.innerHTML ?? '';
      unmount();
      cleanup();
      return svg;
    }

    const listeningContent = await getButtonSvgContent('listening');
    const thinkingContent = await getButtonSvgContent('thinking');
    const speakingContent = await getButtonSvgContent('agent-speaking');

    // All three glyphs must be structurally different (different child elements / paths)
    expect(listeningContent).not.toBe(thinkingContent);
    expect(thinkingContent).not.toBe(speakingContent);
    expect(listeningContent).not.toBe(speakingContent);
  });
});

describe('AskTutorButton — aria-live activity announcements (WCAG 4.1.3)', () => {
  it('renders a visually-hidden aria-live region when connected + activity is set', async () => {
    const client = makeClientSpy('connected');
    const { container } = render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={availabilityFetch(true)}
        activity="listening"
      />,
    );
    await waitFor(() => {
      const liveRegion = container.querySelector('[aria-live="polite"].visually-hidden');
      expect(liveRegion).not.toBeNull();
    });
  });

  it('announces "Listening" when activity="listening"', async () => {
    const client = makeClientSpy('connected');
    const { container } = render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={availabilityFetch(true)}
        activity="listening"
      />,
    );
    await waitFor(() => {
      const liveRegion = container.querySelector('[aria-live="polite"].visually-hidden');
      expect(liveRegion?.textContent).toBe('Listening');
    });
  });

  it('announces "Tutor is thinking" when activity="thinking"', async () => {
    const client = makeClientSpy('connected');
    const { container } = render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={availabilityFetch(true)}
        activity="thinking"
      />,
    );
    await waitFor(() => {
      const liveRegion = container.querySelector('[aria-live="polite"].visually-hidden');
      expect(liveRegion?.textContent).toBe('Tutor is thinking');
    });
  });

  it('announces "Tutor is speaking" when activity="agent-speaking"', async () => {
    const client = makeClientSpy('connected');
    const { container } = render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={availabilityFetch(true)}
        activity="agent-speaking"
      />,
    );
    await waitFor(() => {
      const liveRegion = container.querySelector('[aria-live="polite"].visually-hidden');
      expect(liveRegion?.textContent).toBe('Tutor is speaking');
    });
  });

  it('does NOT render an aria-live region when not connected', async () => {
    const client = makeClientSpy('idle');
    const { container } = render(
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
    // Idle: no aria-live region (only present when connected + active)
    expect(container.querySelector('[aria-live="polite"].visually-hidden')).toBeNull();
  });

  it('does NOT render an aria-live region when connected but no activity prop', async () => {
    const client = makeClientSpy('connected');
    const { container } = render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={availabilityFetch(true)}
        // no activity prop
      />,
    );
    await waitFor(() => {
      expect(container.querySelector('.ask-tutor')).not.toBeNull();
    });
    expect(container.querySelector('[aria-live="polite"].visually-hidden')).toBeNull();
  });
});
