import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { ComponentSpec } from '@polymath/contract';
import { renderComponent } from './registry.js';
import { LESSON_1_INTRO } from '../lessonIntroContent.js';

describe('renderComponent', () => {
  it('renders LessonIntro for real', () => {
    const { getByRole } = render(renderComponent(LESSON_1_INTRO));
    expect(getByRole('heading').textContent).toBe('Lesson 1 — Basic operators');
  });

  it('renders a TBD placeholder for an unimplemented variant', () => {
    const spec: ComponentSpec = { kind: 'HintCard', level: 1, body: 'b' };
    const { getByRole } = render(renderComponent(spec));
    expect(getByRole('note').getAttribute('data-tbd')).toBe('HintCard');
  });
});
