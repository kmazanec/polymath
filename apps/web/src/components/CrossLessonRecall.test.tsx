import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentSpec } from '@polymath/contract';
import { CrossLessonRecall } from './CrossLessonRecall.js';
import { renderComponent } from './registry.js';

afterEach(cleanup);

type Spec = Extract<ComponentSpec, { kind: 'CrossLessonRecall' }>;

const spec: Spec = {
  kind: 'CrossLessonRecall',
  kc: 'NOT',
  currentItemId: 'L2-03',
  priorBktAtRegression: 0.72,
  reminderBody: 'Remember from Lesson 1: NOT flips its input.',
};

describe('CrossLessonRecall component', () => {
  it('renders as a note naming the KC and showing the reminder body (AC#2)', () => {
    const { container, getByRole } = render(<CrossLessonRecall spec={spec} />);
    const note = getByRole('note');
    expect(note.getAttribute('data-kc')).toBe('NOT');
    expect(note.textContent).toContain('NOT');
    expect(note.textContent).toContain('NOT flips its input');
    // No longer a TBD stub.
    expect(container.querySelector('[data-tbd]')).toBeNull();
  });

  it('renders a "got it, continue" dismiss button', () => {
    const { getByRole } = render(<CrossLessonRecall spec={spec} />);
    expect(getByRole('button', { name: /got it/i })).not.toBeNull();
  });

  it('calls onDismiss with the currentItemId when the button is clicked (AC#3)', () => {
    const onDismiss = vi.fn();
    const { getByRole } = render(<CrossLessonRecall spec={spec} onDismiss={onDismiss} />);
    fireEvent.click(getByRole('button', { name: /got it/i }));
    expect(onDismiss).toHaveBeenCalledWith('L2-03');
  });

  it('renders no interactive truth-table / circuit / pseudocode rep (text-only)', () => {
    // The probe-integrity boundary: a recall card is text-only — it must not mount
    // any rep workspace that could expose a held-out probe rep.
    const { container } = render(<CrossLessonRecall spec={spec} />);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
  });

  it('is reachable through the exhaustive registry switch with the dismiss wired', () => {
    const onCrossLessonRecallDismiss = vi.fn();
    const { getByRole } = render(
      renderComponent(spec, { onCrossLessonRecallDismiss }),
    );
    expect(getByRole('note').getAttribute('data-kc')).toBe('NOT');
    fireEvent.click(getByRole('button', { name: /got it/i }));
    expect(onCrossLessonRecallDismiss).toHaveBeenCalledWith('L2-03');
  });
});
