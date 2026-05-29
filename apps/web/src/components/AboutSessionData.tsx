import { type ReactElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ABOUT_SESSION_DATA_TITLE,
  ACCESSIBILITY_POSTURE_POINTS,
  PRIVACY_POSTURE_POINTS,
  PRIVACY_POSTURE_SUMMARY,
} from '../copy/privacy.js';

/**
 * The route-independent "About this session's data" affordance (ADR-012 privacy
 * posture, made visible). A small footer trigger opens a focus-trapped modal that
 * renders the canonical privacy/accessibility copy — so the same writeup is
 * reachable from every route without per-route wiring (it is mounted once in App's
 * <main>; lift to a shared layout when the routes converge).
 *
 * Accessibility: `role="dialog"` + `aria-modal` + `aria-labelledby`; focus moves
 * into the dialog on open, Tab/Shift+Tab cycle within it (never escaping to the page
 * behind), Esc and an explicit Close button dismiss it, and focus returns to the
 * trigger on close — the WCAG keyboard + screen-reader contract for a modal.
 */
export function AboutSessionData(): ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const close = useCallback((): void => {
    setOpen(false);
  }, []);

  // On open, move focus into the dialog. On close, restore focus to the trigger so a
  // keyboard user is never stranded (focus restoration is part of the modal contract).
  useEffect(() => {
    if (open) {
      dialogRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [open]);

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
        close();
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
    [close],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="about-session-trigger"
        onClick={() => setOpen(true)}
      >
        About this session’s data
      </button>

      {open && (
        <div className="about-session-backdrop" onClick={close}>
          {/* The dialog stops click propagation so a click on the panel doesn't
              dismiss via the backdrop handler. */}
          <div
            ref={dialogRef}
            className="about-session-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={titleId} className="about-session-dialog__title">
              {ABOUT_SESSION_DATA_TITLE}
            </h2>
            <p className="about-session-dialog__summary">{PRIVACY_POSTURE_SUMMARY}</p>

            <h3>Privacy</h3>
            <ul className="about-session-dialog__list">
              {PRIVACY_POSTURE_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>

            <h3>Accessibility</h3>
            <ul className="about-session-dialog__list">
              {ACCESSIBILITY_POSTURE_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>

            <button type="button" className="about-session-dialog__close" onClick={close}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
