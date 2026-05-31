import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HandoffButton } from './HandoffButton.js';

afterEach(cleanup);

describe('HandoffButton', () => {
  it('renders an actionable control when a session exists (AC#1, any phase)', () => {
    render(<HandoffButton sessionId="11111111-1111-1111-1111-111111111111" />);
    expect(screen.getByRole('link', { name: /hand off|tutor/i })).toBeTruthy();
  });

  it('links to /handoff/:sessionId (pure client navigation, no wire event)', () => {
    render(<HandoffButton sessionId="11111111-1111-1111-1111-111111111111" />);
    const el = screen.getByRole('link', { name: /hand off|tutor/i });
    // A plain anchor: the target is the learner's own handoff route. There is no
    // socket/wire surface on this component at all — it never imports the WS client.
    expect(el.getAttribute('href')).toBe('/handoff/11111111-1111-1111-1111-111111111111');
  });

  it('renders nothing before a session id exists (no broken link)', () => {
    const { container } = render(<HandoffButton sessionId={null} />);
    expect(container.querySelector('a,button')).toBeNull();
  });
});
