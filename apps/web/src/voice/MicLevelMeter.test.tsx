/**
 * C9 — MicLevelMeter tests.
 *
 * jsdom does not provide Web Audio APIs, so these tests exercise the
 * AudioContext-absent guard path:
 *  - Mounts without throwing when AudioContext is unavailable.
 *  - Unmounts cleanly (effect cleanup runs without error).
 *  - Renders null when stream is null.
 *  - Renders the meter element when a stream is provided.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MicLevelMeter } from './MicLevelMeter.js';

afterEach(cleanup);

function makeFakeStream(): MediaStream {
  // Minimal stub — MicLevelMeter only needs a non-null stream reference.
  return {} as unknown as MediaStream;
}

describe('MicLevelMeter — jsdom (AudioContext absent path)', () => {
  it('renders null when stream is null (nothing in the DOM)', () => {
    const { container } = render(<MicLevelMeter stream={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('mounts without throwing when AudioContext is absent (jsdom)', () => {
    // AudioContext is not present in jsdom; the component must degrade to a no-op.
    expect(() => render(<MicLevelMeter stream={makeFakeStream()} />)).not.toThrow();
  });

  it('renders the .mic-level-meter element when a stream is provided', () => {
    const { container } = render(<MicLevelMeter stream={makeFakeStream()} />);
    const meter = container.querySelector('.mic-level-meter');
    expect(meter).not.toBeNull();
  });

  it('unmounts cleanly — effect cleanup runs without throwing', () => {
    const { unmount } = render(<MicLevelMeter stream={makeFakeStream()} />);
    expect(() => unmount()).not.toThrow();
  });

  it('renders with aria-hidden so the meter is not announced to screen readers', () => {
    const { container } = render(<MicLevelMeter stream={makeFakeStream()} />);
    const meter = container.querySelector('.mic-level-meter');
    expect(meter?.getAttribute('aria-hidden')).toBe('true');
  });
});
