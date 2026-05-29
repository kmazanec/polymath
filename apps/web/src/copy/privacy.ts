/**
 * Canonical privacy / consent copy — the SINGLE source of truth for every
 * privacy/consent string the web app shows, and the source the privacy posture
 * doc (`docs/privacy-and-accessibility.md`) is written from.
 *
 * Owned by the accessibility/polish workstream. The consent-modal workstream
 * consumes the copy through these exported constants ONLY — it never inlines its
 * own strings — so the wording stays in one auditable place. Aligned to ADR-012's
 * privacy posture: no webcam / no facial affect, no minor PII by default, opaque
 * session IDs, PostHog session replay opt-in & off-by-default, session-data
 * deletion on close with a 24h grace, WCAG 2.1 AA, keyboard-first, reduced motion,
 * screen-reader announcements, colour-blind-safe palette.
 */

/** Heading for the analytics opt-in modal. */
export const ANALYTICS_CONSENT_TITLE = 'Help improve this tutor';

/** Body explaining what is collected and that opting in is voluntary. Session
 *  replay is OFF until this is accepted (off-by-default, informed consent). */
export const ANALYTICS_CONSENT_BODY =
  'Session replay and product analytics are OFF by default. If you opt in, we record an anonymous replay of this session to improve the tutor. No video, no microphone unless you press “Ask the tutor”, no personal details. You can opt out at any time, and opting out never affects your lesson.';

/** Affirmative opt-in button label. */
export const ANALYTICS_CONSENT_ACCEPT = 'Allow anonymous analytics';

/** Decline button label. */
export const ANALYTICS_CONSENT_DECLINE = 'No thanks';

/** Short privacy-posture summary shown alongside the modal / in the
 *  "About this session's data" surface. */
export const PRIVACY_POSTURE_SUMMARY =
  'Your lesson interactions are processed to teach you Boolean logic. Analytics and session replay are optional, anonymous, and off until you opt in.';

/** Title of the route-independent "About this session's data" modal. */
export const ABOUT_SESSION_DATA_TITLE = 'About this session’s data';

/** The privacy-posture bullets shown in the "About this session's data" modal and
 *  mirrored, near-verbatim, in `docs/privacy-and-accessibility.md`. Each is a
 *  verifiable property of the running app, not a marketing claim. */
export const PRIVACY_POSTURE_POINTS: readonly string[] = [
  'No webcam access at any point, and no facial-affect or eye tracking.',
  'No personal details are collected; your session ID is an opaque random token.',
  'Your microphone is requested only when you press “Ask the tutor”, never at start.',
  'Product analytics and session replay are off by default and start only if you opt in.',
  'Your session data is deleted by default when the session ends, after a short grace period for the eval tool.',
];

/** The accessibility-posture bullets shown in the same modal and the doc. */
export const ACCESSIBILITY_POSTURE_POINTS: readonly string[] = [
  'Designed to align with WCAG 2.1 AA: ≥4.5:1 contrast on body text, ≥3:1 on UI.',
  'A colour-blind-safe palette: correct/incorrect never rely on hue alone.',
  'Keyboard-first: every control is reachable with a visible focus indicator.',
  'Reduced-motion preference honoured: the pulse falls back to step-through.',
  'Screen-reader announcements for the pulse, mastery, and transfer-probe changes.',
];
