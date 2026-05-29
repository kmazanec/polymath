import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntelligibilityCheck, shouldSampleIntelligibility } from './IntelligibilityCheck.js';

afterEach(cleanup);

describe('shouldSampleIntelligibility — 1-in-3 deterministic gate', () => {
  it('fires ~1 in 3 under a uniform RNG (deterministic, testable)', () => {
    // A simple deterministic sequence covering the [0,1) range in thirds.
    expect(shouldSampleIntelligibility(() => 0.0)).toBe(true); // < 1/3
    expect(shouldSampleIntelligibility(() => 0.32)).toBe(true); // < 1/3
    expect(shouldSampleIntelligibility(() => 0.34)).toBe(false); // ≥ 1/3
    expect(shouldSampleIntelligibility(() => 0.99)).toBe(false);
  });

  it('over a uniform spread, roughly a third sample', () => {
    let count = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      if (shouldSampleIntelligibility(() => i / N)) count++;
    }
    expect(count).toBeGreaterThan(N * 0.28);
    expect(count).toBeLessThan(N * 0.38);
  });
});

describe('IntelligibilityCheck component', () => {
  it('renders the prompt and emits the chosen answer', () => {
    const onAnswer = vi.fn();
    render(<IntelligibilityCheck mountedKind="TruthTablePractice" onAnswer={onAnswer} />);
    expect(screen.getByText(/did that .* make sense/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(onAnswer).toHaveBeenCalledWith('yes');
  });

  it('emits no / skip too', () => {
    const onAnswer = vi.fn();
    const { rerender } = render(<IntelligibilityCheck mountedKind="HintCard" onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: /^no$/i }));
    expect(onAnswer).toHaveBeenCalledWith('no');

    rerender(<IntelligibilityCheck mountedKind="HintCard" onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onAnswer).toHaveBeenCalledWith('skip');
  });

  it('is an aria-live region (a11y) so AT announces the prompt', () => {
    const { container } = render(<IntelligibilityCheck mountedKind="CircuitBuilder" onAnswer={() => {}} />);
    const region = container.querySelector('[aria-live]');
    expect(region).not.toBeNull();
  });
});
