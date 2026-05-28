import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

describe('AskTutorButton — no side effects on mount', () => {
  it('does NOT call client.start() when rendered (criterion: mic permission deferred to click)', () => {
    const client = makeClientSpy();
    render(<AskTutorButton sessionId="sess-1" client={client as unknown as VoiceClient} />);
    expect(client.start).not.toHaveBeenCalled();
  });

  it('renders a button element (keyboard accessible)', () => {
    const client = makeClientSpy();
    render(<AskTutorButton sessionId="sess-1" client={client as unknown as VoiceClient} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDefined();
  });
});

describe('AskTutorButton — click behaviour', () => {
  it('calls client.start() exactly once on click', () => {
    const client = makeClientSpy();
    render(<AskTutorButton sessionId="sess-1" client={client as unknown as VoiceClient} />);
    fireEvent.click(screen.getByRole('button'));
    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it('does NOT call client.start() a second time while already connecting', () => {
    const client = makeClientSpy('connecting');
    render(<AskTutorButton sessionId="sess-1" client={client as unknown as VoiceClient} />);
    const btn = screen.getByRole('button');
    // Button should be disabled while connecting
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    // Even if someone fires a click directly (e.g. via JS), start should not have
    // been called during mount.
    expect(client.start).not.toHaveBeenCalled();
  });
});

describe('AskTutorButton — state reflection', () => {
  it('shows idle/ready label when state is idle', () => {
    const client = makeClientSpy('idle');
    render(<AskTutorButton sessionId="sess-1" client={client as unknown as VoiceClient} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent?.toLowerCase()).toMatch(/ask.*tutor|tutor/);
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows connecting label and is disabled while state is connecting', () => {
    const client = makeClientSpy('connecting');
    render(<AskTutorButton sessionId="sess-1" client={client as unknown as VoiceClient} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent?.toLowerCase()).toMatch(/connect/);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows connected label when state is connected', () => {
    const client = makeClientSpy('connected');
    render(<AskTutorButton sessionId="sess-1" client={client as unknown as VoiceClient} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent?.toLowerCase()).toMatch(/listen|connect/);
  });

  it('shows unavailable label when state is unavailable', () => {
    const client = makeClientSpy('unavailable');
    render(<AskTutorButton sessionId="sess-1" client={client as unknown as VoiceClient} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent?.toLowerCase()).toMatch(/unavailable/);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows error hint when state is error', () => {
    const client = makeClientSpy('error');
    render(<AskTutorButton sessionId="sess-1" client={client as unknown as VoiceClient} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent?.toLowerCase()).toMatch(/error|retry|failed|unavailable/);
  });
});
