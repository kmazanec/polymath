import { type ReactElement, useCallback, useEffect, useRef } from 'react';
import {
  ANALYTICS_CONSENT_TITLE,
  ANALYTICS_CONSENT_BODY,
  ANALYTICS_CONSENT_ACCEPT,
  ANALYTICS_CONSENT_DECLINE,
} from '../copy/privacy.js';

/**
 * The analytics opt-in modal shown once at session start.
 *
 * It is a pure presentational gate: it renders the canonical privacy copy (sourced from
 * `../copy/privacy.js` — NEVER inlined, so the reviewed wording lives in one place) and
 * calls back on the learner's choice. It does NOT touch PostHog itself — the consumer
 * wires `onAccept` → a consented `initPostHog` and `onDecline` → nothing. This keeps the
 * default OFF: until the learner clicks Accept, analytics are never initialized and
 * session replay never starts (AC#2/#7).
 *
 * Accessibility: focus moves into the dialog on mount (onto the Decline button as the
 * safe default), Tab/Shift+Tab are trapped within the panel, Escape = Decline, and
 * role/aria-modal/aria-labelledby satisfy the WCAG modal contract. Inline styles
 * replaced by .consent-modal-backdrop / .consent-modal (global.css).
 *
 * NOTE (copy): the strings are the shared placeholder constants today; the polish
 * workstream owns the final reviewed wording — a one-line swap behind those constants
 * with no change here.
 */
export function ConsentModal({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);

  // On mount, move focus to the Decline button (safe default — declining is always the
  // lower-stakes path). Tab/Shift+Tab wrap within the panel; Escape = Decline.
  useEffect(() => {
    declineRef.current?.focus();
  }, []);

  const focusables = (): HTMLElement[] => {
    const root = dialogRef.current;
    if (!root) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [href], a, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled'));
  };

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDecline();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      // Wrap focus at the ends so Tab never moves to the page behind the modal.
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onDecline],
  );

  return (
    <div className="consent-modal-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-modal-title"
        aria-describedby="consent-modal-body"
        className="consent-modal"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id="consent-modal-title" className="consent-modal__title">
          {ANALYTICS_CONSENT_TITLE}
        </h2>
        <p id="consent-modal-body" className="consent-modal__body">{ANALYTICS_CONSENT_BODY}</p>
        <div className="consent-modal__actions">
          <button
            ref={declineRef}
            type="button"
            className="consent-modal__decline btn btn--ghost"
            onClick={onDecline}
          >
            {ANALYTICS_CONSENT_DECLINE}
          </button>
          <button
            type="button"
            className="consent-modal__accept btn btn--primary"
            onClick={onAccept}
          >
            {ANALYTICS_CONSENT_ACCEPT}
          </button>
        </div>
      </div>
    </div>
  );
}
