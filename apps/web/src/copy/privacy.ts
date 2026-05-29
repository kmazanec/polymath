/**
 * Canonical privacy / consent copy.
 *
 * Owned by the accessibility/polish workstream (which writes the final, reviewed
 * wording and the privacy posture doc). The consent-modal workstream consumes the
 * copy through these exported constants ONLY — it never inlines its own strings — so
 * the wording stays in one auditable place. This barrier ships placeholder strings
 * so a consumer compiles and renders; the polish workstream replaces the text.
 */

/** Heading for the analytics opt-in modal. */
export const ANALYTICS_CONSENT_TITLE = 'Help improve this tutor';

/** Body explaining what is collected and that opting in is voluntary. PLACEHOLDER —
 *  the polish workstream owns the final, reviewed wording. */
export const ANALYTICS_CONSENT_BODY =
  'We collect anonymous product analytics to improve the tutor. You can opt in or out at any time; opting out does not affect your lesson.';

/** Affirmative opt-in button label. */
export const ANALYTICS_CONSENT_ACCEPT = 'Allow anonymous analytics';

/** Decline button label. */
export const ANALYTICS_CONSENT_DECLINE = 'No thanks';

/** Short privacy-posture summary shown alongside the modal / in an "about your data"
 *  surface. PLACEHOLDER — the polish workstream owns the final wording. */
export const PRIVACY_POSTURE_SUMMARY =
  'Your lesson interactions are processed to teach you Boolean logic. Analytics are optional and anonymous.';
