import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ComponentSpec } from '@polymath/contract';
import { renderComponent } from './registry.js';
import { ExplainBackPrompt } from './ExplainBackPrompt.js';

afterEach(cleanup);

const spec: Extract<ComponentSpec, { kind: 'ExplainBackPrompt' }> = {
  kind: 'ExplainBackPrompt',
  targetItemId: 'L1-01-and',
  promptBody: 'Walk me through how you solved that one.',
  maxDurationSec: 15,
};

describe('ExplainBackPrompt component', () => {
  it('is wired into the registry (not a TBD placeholder)', () => {
    const { container, getByLabelText } = render(renderComponent(spec));
    // No TBD stub anywhere, and the real explain-back group is present.
    expect(container.querySelector('[data-tbd]')).toBeNull();
    expect(getByLabelText('Explain-back check')).toBeTruthy();
  });

  it('TTSes the prompt body once on mount (the ~3s read)', () => {
    const speak = vi.fn();
    render(<ExplainBackPrompt spec={spec} deps={{ speak, startRecording: () => () => 'x' }} />);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith(spec.promptBody);
  });

  it('shows a visible countdown initialized to maxDurationSec', () => {
    const { getByLabelText } = render(
      <ExplainBackPrompt spec={spec} deps={{ speak: () => undefined, startRecording: () => () => '' }} />,
    );
    expect(getByLabelText(/seconds remaining/i).textContent).toContain('15');
  });

  it('on window close dispatches explain_back_recording_ended with the captured transcript + durationMs', async () => {
    const onEnd = vi.fn();
    // A recorder that, when stopped, yields a fixed transcript.
    const startRecording = () => () => 'I used the AND gate on A and B';
    render(
      <ExplainBackPrompt
        spec={spec}
        deps={{ speak: () => undefined, startRecording, now: makeClock() }}
        onExplainBackEnd={onEnd}
      />,
    );
    // The learner stops early via the Done button (or the window elapses).
    fireEvent.click(document.querySelector('button.explain-back__done')!);
    await waitFor(() => expect(onEnd).toHaveBeenCalledTimes(1));
    const payload = onEnd.mock.calls[0]![0] as {
      targetItemId: string;
      transcript: string;
      durationMs: number;
    };
    expect(payload.targetItemId).toBe('L1-01-and');
    expect(payload.transcript).toBe('I used the AND gate on A and B');
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('auto-closes when the countdown reaches zero and dispatches once', async () => {
    vi.useFakeTimers();
    const onEnd = vi.fn();
    try {
      render(
        <ExplainBackPrompt
          spec={{ ...spec, maxDurationSec: 2 }}
          deps={{ speak: () => undefined, startRecording: () => () => 'something said here over time' }}
          onExplainBackEnd={onEnd}
        />,
      );
      await act(async () => {
        vi.advanceTimersByTime(2_500);
      });
      expect(onEnd).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('signals an empty transcript (no audio captured) gracefully — never throws in render', () => {
    const onEnd = vi.fn();
    // A recorder whose stop yields '' (mic blocked / no audio). The server treats an
    // empty transcript as a fail-closed precondition miss.
    expect(() =>
      render(
        <ExplainBackPrompt
          spec={spec}
          deps={{ speak: () => undefined, startRecording: () => () => '' }}
          onExplainBackEnd={onEnd}
        />,
      ),
    ).not.toThrow();
    fireEvent.click(document.querySelector('button.explain-back__done')!);
    const payload = onEnd.mock.calls[0]?.[0] as { transcript: string } | undefined;
    expect(payload?.transcript).toBe('');
  });

  it('does not throw when speak (TTS) throws — iOS Safari quirk degraded gracefully', () => {
    const speak = () => {
      throw new Error('TTS not available');
    };
    expect(() =>
      render(<ExplainBackPrompt spec={spec} deps={{ speak, startRecording: () => () => '' }} />),
    ).not.toThrow();
  });
});

/** A monotonic millisecond clock for deterministic durationMs. */
function makeClock(): () => number {
  let t = 1_000;
  return () => (t += 100);
}
