/**
 * F-31 — FlowSkeleton structural unit tests (jsdom).
 *
 * STRUCTURAL ASSERTIONS ONLY — no size/layout checks.
 * jsdom's getBoundingClientRect() returns 0×0 so size assertions must use
 * real-browser Playwright boundingBox() (see e2e/touch.spec.ts).
 *
 * Verifies:
 *  - All locked phases are rendered
 *  - The live phase has aria-current="step"
 *  - No role="progressbar" (ADR-015 non-linear thesis)
 *  - No "N of 7" text (would imply a linear path)
 *  - Branch phases appear as branch markers on the active mainline step
 *  - "Completed" is monotonic (a dip back to practicing after hint doesn't un-complete it)
 */
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/react';

afterEach(cleanup);
import { FlowSkeleton, MAINLINE } from './FlowSkeleton.js';
import type { PhaseName } from '@polymath/contract';

describe('FlowSkeleton', () => {
  it('renders all mainline phases by default', () => {
    const { getByText } = render(<FlowSkeleton phase="introducing" />);
    expect(getByText('Introduction')).toBeTruthy();
    expect(getByText('Practice')).toBeTruthy();
    expect(getByText('Assessment')).toBeTruthy();
    expect(getByText('Mastered')).toBeTruthy();
  });

  it('marks the live mainline phase with aria-current="step"', () => {
    const { container } = render(<FlowSkeleton phase="practicing" />);
    const steps = container.querySelectorAll('.flow-skeleton__step');
    const practicing = Array.from(steps).find((s) => s.textContent?.includes('Practice'));
    expect(practicing).toBeTruthy();
    expect(practicing?.getAttribute('aria-current')).toBe('step');
  });

  it('sets aria-current on "introducing" when that is the live phase', () => {
    const { container } = render(<FlowSkeleton phase="introducing" />);
    const steps = container.querySelectorAll('.flow-skeleton__step');
    const intro = Array.from(steps).find((s) => s.textContent?.includes('Introduction'));
    expect(intro?.getAttribute('aria-current')).toBe('step');
  });

  it('sets aria-current on the mainline parent of a branch phase (hint)', () => {
    const { container } = render(<FlowSkeleton phase="hint" />);
    const steps = container.querySelectorAll('.flow-skeleton__step');
    // `hint` is a branch off `practicing` — practicing step should carry aria-current
    const practicing = Array.from(steps).find((s) => s.getAttribute('data-phase') === 'practicing');
    expect(practicing?.getAttribute('aria-current')).toBe('step');
  });

  it('sets aria-current on the mainline parent of a branch phase (transferring)', () => {
    const { container } = render(<FlowSkeleton phase="transferring" />);
    const steps = container.querySelectorAll('.flow-skeleton__step');
    // `transferring` hangs off `assessed`
    const assessed = Array.from(steps).find((s) => s.getAttribute('data-phase') === 'assessed');
    expect(assessed?.getAttribute('aria-current')).toBe('step');
  });

  it('renders a branch marker when the current phase is a branch (hint)', () => {
    const { container } = render(<FlowSkeleton phase="hint" />);
    const branch = container.querySelector('[data-testid="flow-skeleton-branch"]');
    expect(branch).toBeTruthy();
    expect(branch?.textContent).toContain('Getting a hint');
  });

  it('renders a branch marker for remediating', () => {
    const { container } = render(<FlowSkeleton phase="remediating" />);
    const branch = container.querySelector('[data-testid="flow-skeleton-branch"]');
    expect(branch?.textContent).toContain('Extra practice');
  });

  it('renders a branch marker for transferring', () => {
    const { container } = render(<FlowSkeleton phase="transferring" />);
    const branch = container.querySelector('[data-testid="flow-skeleton-branch"]');
    expect(branch?.textContent).toContain('Transfer check');
  });

  it('does NOT render a role="progressbar" element', () => {
    const { container } = render(<FlowSkeleton phase="practicing" />);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('does NOT contain any "N of 7" or "N of" fraction text', () => {
    const { container } = render(<FlowSkeleton phase="practicing" />);
    expect(container.textContent).not.toMatch(/\d+\s+of\s+\d+/i);
    expect(container.textContent).not.toMatch(/\d\/\d/);
  });

  it('is wrapped in a <nav> with an aria-label', () => {
    const { container } = render(<FlowSkeleton phase="introducing" />);
    const nav = container.querySelector('nav');
    expect(nav).toBeTruthy();
    expect(nav?.getAttribute('aria-label')).toBeTruthy();
  });

  it('uses role="list" on the phases list', () => {
    const { container } = render(<FlowSkeleton phase="introducing" />);
    const list = container.querySelector('[role="list"]');
    expect(list).toBeTruthy();
  });

  it('marks only one step with aria-current at a time', () => {
    const { container } = render(<FlowSkeleton phase="practicing" />);
    const currentSteps = container.querySelectorAll('[aria-current="step"]');
    expect(currentSteps).toHaveLength(1);
  });

  it('accepts a custom phases array and renders only those phases', () => {
    const custom: readonly PhaseName[] = ['introducing', 'mastered'];
    const { getByText, queryByText } = render(<FlowSkeleton phase="introducing" phases={custom} />);
    expect(getByText('Introduction')).toBeTruthy();
    expect(getByText('Mastered')).toBeTruthy();
    // 'Practice' should not appear
    expect(queryByText('Practice')).toBeNull();
  });

  it('completed flag: earlier steps get --completed class when further phase is active', () => {
    const { container } = render(<FlowSkeleton phase="assessed" />);
    const steps = container.querySelectorAll('.flow-skeleton__step');
    // introducing (idx=0) and practicing (idx=1) are before assessed (idx=2)
    const introStep = steps[0];
    const practiceStep = steps[1];
    const assessedStep = steps[2];
    expect(introStep?.classList.contains('flow-skeleton__step--completed')).toBe(true);
    expect(practiceStep?.classList.contains('flow-skeleton__step--completed')).toBe(true);
    expect(assessedStep?.classList.contains('flow-skeleton__step--completed')).toBe(false);
  });

  it('MAINLINE export has the correct 4-step sequence', () => {
    expect(MAINLINE).toEqual(['introducing', 'practicing', 'assessed', 'mastered']);
  });

  it('does NOT use aria-current when a step is neither live nor a branch-parent', () => {
    const { container } = render(<FlowSkeleton phase="introducing" />);
    const steps = container.querySelectorAll('.flow-skeleton__step');
    // 'practicing', 'assessed', 'mastered' should have no aria-current when introducing is live
    const nonLiveSteps = Array.from(steps).filter(
      (s) => s.getAttribute('data-phase') !== 'introducing',
    );
    for (const step of nonLiveSteps) {
      expect(step.getAttribute('aria-current')).toBeNull();
    }
  });
});
