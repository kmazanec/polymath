import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
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

  it('F-15: clicking the enabled affordance fires onContinue with the nextLessonId', () => {
    const onContinue = vi.fn();
    const spec: ComponentSpec = { kind: 'MasteryCelebration', conceptsMastered: ['AND'], nextLessonId: 2 };
    const { container } = render(renderComponent(spec, { onContinue }));
    const button = container.querySelector('.continue-to-next-lesson') as HTMLButtonElement;
    fireEvent.click(button);
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith(2);
  });

  it('F-15: a disabled affordance (no nextLessonId) cannot fire onContinue', () => {
    const onContinue = vi.fn();
    const spec: ComponentSpec = { kind: 'MasteryCelebration', conceptsMastered: ['AND'] };
    const { container } = render(renderComponent(spec, { onContinue }));
    const button = container.querySelector('.continue-to-next-lesson') as HTMLButtonElement;
    fireEvent.click(button);
    expect(onContinue).not.toHaveBeenCalled();
  });

  // ADR-013 stretch: the "Try the Playground" affordance is rendered ONLY when the
  // App supplies onTryPlayground (the final-lesson capstone door). AC#1.
  it('does NOT render the "Try the Playground" button when onTryPlayground is absent', () => {
    const spec: ComponentSpec = { kind: 'MasteryCelebration', conceptsMastered: ['AND'] };
    const { container } = render(renderComponent(spec));
    expect(container.querySelector('.try-the-playground')).toBeNull();
  });

  it('renders + wires "Try the Playground" when onTryPlayground is supplied (AC#1)', () => {
    const onTryPlayground = vi.fn();
    const spec: ComponentSpec = { kind: 'MasteryCelebration', conceptsMastered: ['De Morgan'] };
    const { container } = render(renderComponent(spec, { onTryPlayground }));
    const button = container.querySelector('.try-the-playground') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    fireEvent.click(button!);
    expect(onTryPlayground).toHaveBeenCalledTimes(1);
  });

  it('renders a graceful message when no concepts are listed', () => {
    const spec: ComponentSpec = { kind: 'MasteryCelebration', conceptsMastered: [] };
    const { container } = render(renderComponent(spec));
    expect(container.querySelector('.mastery-celebration')).not.toBeNull();
    expect(container.querySelector('ul[aria-label="concepts mastered"]')).toBeNull();
  });
});
