import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AboutSessionData } from './AboutSessionData.js';
import {
  ABOUT_SESSION_DATA_TITLE,
  ACCESSIBILITY_POSTURE_POINTS,
  PRIVACY_POSTURE_POINTS,
} from '../copy/privacy.js';

/**
 * The route-independent "About this session's data" affordance: a visible trigger
 * that opens a focus-trapped, screen-reader-labelled modal rendering the canonical
 * privacy/accessibility copy. Verifies the trigger, the dialog semantics, focus
 * management (trap + restore), Esc-to-close, and that the copy comes from the
 * privacy module (no inlined strings).
 */

afterEach(cleanup);

describe('AboutSessionData', () => {
  it('renders a visible trigger and no dialog until opened', () => {
    render(<AboutSessionData />);
    expect(screen.getByRole('button', { name: /about this session/i })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a labelled modal dialog from the trigger', () => {
    render(<AboutSessionData />);
    fireEvent.click(screen.getByRole('button', { name: /about this session/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // aria-labelledby points at the visible heading carrying the title.
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const heading = document.getElementById(labelledBy!);
    expect(heading?.textContent).toContain(ABOUT_SESSION_DATA_TITLE);
  });

  it('renders the canonical privacy + accessibility copy (not inlined strings)', () => {
    render(<AboutSessionData />);
    fireEvent.click(screen.getByRole('button', { name: /about this session/i }));
    const dialog = screen.getByRole('dialog');
    for (const point of [...PRIVACY_POSTURE_POINTS, ...ACCESSIBILITY_POSTURE_POINTS]) {
      expect(within(dialog).getByText(point)).toBeTruthy();
    }
  });

  it('moves focus into the dialog on open', () => {
    render(<AboutSessionData />);
    fireEvent.click(screen.getByRole('button', { name: /about this session/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('traps Tab within the dialog (focus cycles, never escapes)', () => {
    render(<AboutSessionData />);
    fireEvent.click(screen.getByRole('button', { name: /about this session/i }));
    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>('button, [href], a'),
    );
    expect(focusables.length).toBeGreaterThan(0);
    const last = focusables[focusables.length - 1]!;
    const first = focusables[0]!;
    // Tab off the last element wraps to the first.
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    // Shift+Tab off the first wraps to the last.
    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape and restores focus to the trigger', () => {
    render(<AboutSessionData />);
    const trigger = screen.getByRole('button', { name: /about this session/i });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes via the explicit close button', () => {
    render(<AboutSessionData />);
    fireEvent.click(screen.getByRole('button', { name: /about this session/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
