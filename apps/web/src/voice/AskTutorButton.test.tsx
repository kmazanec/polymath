import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AskTutorButton } from './AskTutorButton.js';
import type { VoiceClient } from './client.js';

afterEach(cleanup);

// A lightweight stand-in for VoiceClient — enough surface to drive the button.
type VoiceState = VoiceClient['state'];

function makeClientSpy(initialState: VoiceState = 'idle') {
  let _state: VoiceState = initialState;
  let _listener: (() => void) | undefined;

  const spy = {
    get state() {
      return _state;
    },
    // Test helper: advance the fake state and notify the component.
    _setState(s: VoiceState) {
      _state = s;
      _listener?.();
    },
    start: vi.fn(),
    stop: vi.fn(),
    // The component can optionally subscribe to state changes; the spy supports it.
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

/** A fetch stub for the on-mount availability probe (`GET /api/realtime/availability`).
 *  Default = voice IS configured, so the button behaves as the live control. */
function availabilityFetch(available: boolean): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ available }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

/** Render the button with voice available + the probe resolved, then return the
 *  resolved control. The probe is async, so callers await the resolved button. */
async function renderAvailable(client: ReturnType<typeof makeClientSpy>) {
  render(
    <AskTutorButton
      sessionId="sess-1"
      client={client as unknown as VoiceClient}
      fetchFn={availabilityFetch(true)}
    />,
  );
  // Wait for the probe to resolve out of the "Checking voice…" placeholder.
  await waitFor(() => {
    expect(screen.getByRole('button').textContent?.toLowerCase()).not.toMatch(/checking/);
  });
  return screen.getByRole('button') as HTMLButtonElement;
}

describe('AskTutorButton — no side effects on mount', () => {
  it('does NOT call client.start() when rendered (criterion: mic permission deferred to click)', async () => {
    const client = makeClientSpy();
    await renderAvailable(client);
    expect(client.start).not.toHaveBeenCalled();
  });

  it('renders a button element (keyboard accessible)', async () => {
    const client = makeClientSpy();
    const btn = await renderAvailable(client);
    expect(btn).toBeDefined();
  });
});

describe('AskTutorButton — click behaviour', () => {
  it('calls client.start() exactly once on click', async () => {
    const client = makeClientSpy();
    const btn = await renderAvailable(client);
    fireEvent.click(btn);
    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it('is disabled (and does not start) while already connecting', async () => {
    const client = makeClientSpy('connecting');
    const btn = await renderAvailable(client);
    expect(btn.disabled).toBe(true);
    expect(client.start).not.toHaveBeenCalled();
  });
});

describe('AskTutorButton — unmount stops the client', () => {
  it('calls client.stop() when the component is unmounted', async () => {
    const client = makeClientSpy('idle');
    const { unmount } = render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={availabilityFetch(true)}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('button').textContent?.toLowerCase()).not.toMatch(/checking/);
    });
    expect(client.stop).not.toHaveBeenCalled();
    unmount();
    expect(client.stop).toHaveBeenCalledTimes(1);
  });
});

describe('AskTutorButton — state reflection (voice available)', () => {
  it('shows idle/ready label when state is idle', async () => {
    const client = makeClientSpy('idle');
    const btn = await renderAvailable(client);
    expect(btn.textContent?.toLowerCase()).toMatch(/ask.*tutor|tutor/);
    expect(btn.disabled).toBe(false);
  });

  it('shows connecting label and is disabled while state is connecting', async () => {
    const client = makeClientSpy('connecting');
    const btn = await renderAvailable(client);
    expect(btn.textContent?.toLowerCase()).toMatch(/connect/);
    expect(btn.disabled).toBe(true);
  });

  it('shows an end-session label and stays enabled when connected (toggle)', async () => {
    const client = makeClientSpy('connected');
    const btn = await renderAvailable(client);
    // Connected offers ending the session, and the button must remain clickable so
    // the learner can stop without navigating away.
    expect(btn.textContent?.toLowerCase()).toMatch(/end/);
    expect(btn.disabled).toBe(false);
  });

  it('calls client.stop() (not start) when clicked while connected', async () => {
    const client = makeClientSpy('connected');
    const btn = await renderAvailable(client);
    fireEvent.click(btn);
    expect(client.stop).toHaveBeenCalledTimes(1);
    expect(client.start).not.toHaveBeenCalled();
  });
});

describe('AskTutorButton — voice not configured (degraded state)', () => {
  it('renders an explicitly-disabled "unavailable" affordance when the probe says voice is off', async () => {
    const client = makeClientSpy('idle');
    render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={availabilityFetch(false)}
      />,
    );
    const btn = await screen.findByRole('button');
    await waitFor(() => {
      expect(btn.textContent?.toLowerCase()).toMatch(/unavailable/);
    });
    expect(btn.disabled).toBe(true);
    // It explains why, and it must NEVER have prompted the mic / started the client.
    expect(screen.getByText(/isn.t set up|use the text box/i)).toBeDefined();
    expect(client.start).not.toHaveBeenCalled();
  });

  it('fails closed to unavailable when the probe request throws', async () => {
    const client = makeClientSpy('idle');
    const throwingFetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    render(
      <AskTutorButton
        sessionId="sess-1"
        client={client as unknown as VoiceClient}
        fetchFn={throwingFetch}
      />,
    );
    const btn = await screen.findByRole('button');
    await waitFor(() => {
      expect(btn.textContent?.toLowerCase()).toMatch(/unavailable/);
    });
    expect(btn.disabled).toBe(true);
    expect(client.start).not.toHaveBeenCalled();
  });
});
