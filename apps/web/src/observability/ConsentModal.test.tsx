/**
 * The analytics consent modal. AC#2/#7: PostHog must stay uninitialized until the
 * learner EXPLICITLY acknowledges, default OFF, and declining leaves it off.
 *
 * The modal itself is a pure presentational gate — it renders the canonical privacy
 * copy and calls `onAccept`/`onDecline`. We assert it shows the copy (sourced from the
 * shared constants, never inlined) and that each button fires exactly its callback, so
 * a consumer wires accept → consented `initPostHog` and decline → nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ConsentModal } from './ConsentModal.js';
import {
  ANALYTICS_CONSENT_TITLE,
  ANALYTICS_CONSENT_ACCEPT,
  ANALYTICS_CONSENT_DECLINE,
} from '../copy/privacy.js';

afterEach(cleanup);

describe('ConsentModal', () => {
  it('renders the canonical privacy copy (sourced from the shared constants)', () => {
    const { getByText } = render(<ConsentModal onAccept={() => {}} onDecline={() => {}} />);
    expect(getByText(ANALYTICS_CONSENT_TITLE)).toBeTruthy();
    expect(getByText(ANALYTICS_CONSENT_ACCEPT)).toBeTruthy();
    expect(getByText(ANALYTICS_CONSENT_DECLINE)).toBeTruthy();
  });

  it('calls onAccept (and ONLY onAccept) when the accept button is clicked', () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const { getByText } = render(<ConsentModal onAccept={onAccept} onDecline={onDecline} />);
    fireEvent.click(getByText(ANALYTICS_CONSENT_ACCEPT));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('calls onDecline (and ONLY onDecline) when the decline button is clicked', () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const { getByText } = render(<ConsentModal onAccept={onAccept} onDecline={onDecline} />);
    fireEvent.click(getByText(ANALYTICS_CONSENT_DECLINE));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('fires NO callback on mere render (default OFF — analytics stay off until a click)', () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(<ConsentModal onAccept={onAccept} onDecline={onDecline} />);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('is a labelled dialog (a11y: role=dialog, aria-modal)', () => {
    const { getByRole } = render(<ConsentModal onAccept={() => {}} onDecline={() => {}} />);
    const dialog = getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});
