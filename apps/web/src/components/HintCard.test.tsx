import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ComponentSpec } from '@polymath/contract';
import { renderComponent } from './registry.js';

afterEach(cleanup);

describe('HintCard component', () => {
  it('renders a level-1 hint with light styling and correct label', () => {
    const spec: ComponentSpec = { kind: 'HintCard', level: 1, body: 'Look at the AND gate first.' };
    const { container, queryByRole } = render(renderComponent(spec));
    // Must no longer be a TBD stub
    expect(queryByRole('note')?.getAttribute('data-tbd')).toBeNull();
    const card = container.querySelector('.hint-card');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('data-level')).toBe('1');
    expect(card?.classList.contains('hint-card--level-1')).toBe(true);
    expect(card?.textContent).toContain('Look at the AND gate first.');
    expect(card?.textContent).toContain('Hint');
  });

  it('renders a level-2 hint with medium styling and "more detail" label', () => {
    const spec: ComponentSpec = {
      kind: 'HintCard',
      level: 2,
      body: 'Try setting A to true and B to false.',
    };
    const { container } = render(renderComponent(spec));
    const card = container.querySelector('.hint-card');
    expect(card?.getAttribute('data-level')).toBe('2');
    expect(card?.classList.contains('hint-card--level-2')).toBe(true);
    expect(card?.textContent).toContain('more detail');
    expect(card?.textContent).toContain('Try setting A to true');
  });

  it('renders a level-3 hint with prominent styling and "Deep hint" label', () => {
    const spec: ComponentSpec = {
      kind: 'HintCard',
      level: 3,
      body: 'The AND gate outputs true only when BOTH inputs are true.',
    };
    const { container } = render(renderComponent(spec));
    const card = container.querySelector('.hint-card');
    expect(card?.getAttribute('data-level')).toBe('3');
    expect(card?.classList.contains('hint-card--level-3')).toBe(true);
    expect(card?.textContent).toContain('Deep hint');
    expect(card?.textContent).toContain('BOTH inputs are true');
  });

  it('has role="note" for accessibility', () => {
    const spec: ComponentSpec = { kind: 'HintCard', level: 1, body: 'Hint body.' };
    const { getByRole } = render(renderComponent(spec));
    const note = getByRole('note');
    expect(note.classList.contains('hint-card')).toBe(true);
  });

  it('is no longer rendered as a TBD placeholder (registry wired up)', () => {
    const spec: ComponentSpec = { kind: 'HintCard', level: 1, body: 'any body' };
    const { queryByRole } = render(renderComponent(spec));
    // The TBD stub uses data-tbd attribute; real component must not have it
    const tbd = queryByRole('note')?.getAttribute('data-tbd');
    expect(tbd).toBeNull();
  });
});
