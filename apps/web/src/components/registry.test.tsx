import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ComponentSpec } from '@polymath/contract';
import { renderComponent } from './registry.js';
import { LESSON_1_INTRO } from '../lessonIntroContent.js';

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

  it('renders a TBD placeholder for an unimplemented variant', () => {
    const spec: ComponentSpec = { kind: 'HintCard', level: 1, body: 'b' };
    const { getByRole } = render(renderComponent(spec));
    expect(getByRole('note').getAttribute('data-tbd')).toBe('HintCard');
  });
});
