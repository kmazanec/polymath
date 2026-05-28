import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ComponentSpec } from '@polymath/contract';
import { renderComponent } from './registry.js';

afterEach(cleanup);

describe('MasteryCelebration component (F-12)', () => {
  it('renders the mastered concepts (not a TBD stub) from spec.conceptsMastered', () => {
    const spec: ComponentSpec = { kind: 'MasteryCelebration', conceptsMastered: ['AND', 'OR'] };
    const { container, queryByRole, getByText } = render(renderComponent(spec));
    // No longer the walking-skeleton TBD placeholder (the Tbd stub renders a
    // `role="note"` with a `data-tbd` marker; the real component renders neither).
    expect(queryByRole('note')).toBeNull();
    const section = container.querySelector('.mastery-celebration');
    expect(section).not.toBeNull();
    expect(getByText('AND')).toBeTruthy();
    expect(getByText('OR')).toBeTruthy();
  });

  it('disables the "Continue to Lesson 2" affordance when no nextLessonId is present (F-15 wires it)', () => {
    const spec: ComponentSpec = { kind: 'MasteryCelebration', conceptsMastered: ['AND'] };
    const { container } = render(renderComponent(spec));
    const button = container.querySelector('.continue-to-next-lesson') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
    expect(button!.getAttribute('aria-disabled')).toBe('true');
  });

  it('enables the continue affordance once a nextLessonId is offered', () => {
    const spec: ComponentSpec = { kind: 'MasteryCelebration', conceptsMastered: ['AND'], nextLessonId: 2 };
    const { container } = render(renderComponent(spec));
    const button = container.querySelector('.continue-to-next-lesson') as HTMLButtonElement | null;
    expect(button!.disabled).toBe(false);
  });

  it('renders a graceful message when no concepts are listed', () => {
    const spec: ComponentSpec = { kind: 'MasteryCelebration', conceptsMastered: [] };
    const { container } = render(renderComponent(spec));
    expect(container.querySelector('.mastery-celebration')).not.toBeNull();
    expect(container.querySelector('ul[aria-label="concepts mastered"]')).toBeNull();
  });
});
