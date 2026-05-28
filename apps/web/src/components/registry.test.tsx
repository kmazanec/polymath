import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ComponentSpec } from '@polymath/contract';
import { renderComponent } from './registry.js';
import { LESSON_1_INTRO } from '../lessonIntroContent.js';

// react-flow (used by the CircuitBuilder case) needs ResizeObserver + matchMedia.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (q: string) => ({
        matches: false,
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(cleanup);

describe('renderComponent', () => {
  it('renders LessonIntro for real', () => {
    const { getByRole } = render(renderComponent(LESSON_1_INTRO));
    expect(getByRole('heading').textContent).toBe('Lesson 1 — Basic operators');
  });

  it('renders the TruthTable for real (no longer a TBD stub)', () => {
    const spec: ComponentSpec = {
      kind: 'TruthTablePractice',
      expression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      visibleReps: ['truth_table'],
    };
    const { container, queryByRole } = render(renderComponent(spec));
    expect(queryByRole('note')).toBeNull();
    expect(container.querySelector('.truth-table')).not.toBeNull();
  });

  it('renders the CircuitBuilder for real (no longer a TBD stub)', () => {
    const spec: ComponentSpec = {
      kind: 'CircuitBuilder',
      targetExpression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      allowedGates: ['AND', 'OR', 'NOT'],
      visibleReps: ['circuit'],
    };
    const { container, queryByRole } = render(renderComponent(spec));
    // The real component renders a palette, not the TBD note.
    expect(queryByRole('note')).toBeNull();
    expect(container.querySelector('.circuit-builder')).not.toBeNull();
  });

  it('renders the PseudocodeChallenge for real (no longer a TBD stub)', () => {
    const spec: ComponentSpec = {
      kind: 'PseudocodeChallenge',
      targetExpression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      visibleReps: ['pseudocode'],
    };
    const { container, queryByRole } = render(renderComponent(spec));
    expect(queryByRole('note')).toBeNull();
    expect(container.querySelector('[data-testid="source-input"]')).not.toBeNull();
  });

  it('hides a rep workspace when its rep is not in visibleReps (probe integrity)', () => {
    // A transfer probe mounts e.g. CircuitBuilder with visibleReps that exclude
    // circuit — the workspace must not render (would otherwise expose a hidden rep).
    const hiddenCircuit: ComponentSpec = {
      kind: 'CircuitBuilder',
      targetExpression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      allowedGates: ['AND', 'OR', 'NOT'],
      visibleReps: ['truth_table'], // circuit NOT visible
    };
    expect(render(renderComponent(hiddenCircuit)).container.querySelector('.circuit-builder')).toBeNull();

    const hiddenTruthTable: ComponentSpec = {
      kind: 'TruthTablePractice',
      expression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      visibleReps: ['circuit'], // truth_table NOT visible
    };
    expect(render(renderComponent(hiddenTruthTable)).container.querySelector('.truth-table')).toBeNull();

    const hiddenPseudo: ComponentSpec = {
      kind: 'PseudocodeChallenge',
      targetExpression: 'A AND B',
      claimedTruthTable: [0, 0, 0, 1],
      visibleReps: ['circuit'], // pseudocode NOT visible
    };
    expect(
      render(renderComponent(hiddenPseudo)).container.querySelector('[data-testid="source-input"]'),
    ).toBeNull();
  });

  it('renders a TBD placeholder for an unimplemented variant', () => {
    const spec: ComponentSpec = { kind: 'HintCard', level: 1, body: 'b' };
    const { getByRole } = render(renderComponent(spec));
    expect(getByRole('note').getAttribute('data-tbd')).toBe('HintCard');
  });
});
