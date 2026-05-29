import { type ReactElement } from 'react';
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
  return (
    <div
      className="consent-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--color-backdrop, rgba(0, 0, 0, 0.5))',
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-modal-title"
        aria-describedby="consent-modal-body"
        className="consent-modal"
        style={{
          maxWidth: '42ch',
          padding: '1.5rem',
          borderRadius: '0.5rem',
          background: 'var(--color-surface, #fff)',
          color: 'var(--color-text, #111)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
        }}
      >
        <h2 id="consent-modal-title" style={{ marginTop: 0 }}>
          {ANALYTICS_CONSENT_TITLE}
        </h2>
        <p id="consent-modal-body">{ANALYTICS_CONSENT_BODY}</p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button type="button" className="consent-modal__decline" onClick={onDecline}>
            {ANALYTICS_CONSENT_DECLINE}
          </button>
          <button type="button" className="consent-modal__accept" onClick={onAccept}>
            {ANALYTICS_CONSENT_ACCEPT}
          </button>
        </div>
      </div>
    </div>
  );
}
