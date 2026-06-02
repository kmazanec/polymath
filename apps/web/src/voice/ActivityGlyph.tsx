/**
 * Per-activity SVG glyphs and announcements for the voice button (ADR-018).
 *
 * Split into its own module so the core AskTutorButton module stays lean — the
 * SVG paths are loaded lazily when the voice button first encounters an active
 * session. Each glyph is a distinct shape so colorblind + reduced-motion users
 * have a non-color, non-animation cue per state (ADR-004 / WCAG 1.4.1).
 */
import { type ReactElement } from 'react';
import type { VoiceActivity } from './AskTutorButton.js';

/**
 * Renders the per-activity SVG glyph for the voice button.
 *
 * - listening:      microphone body + stand (mic is hot)
 * - thinking:       three horizontal dots (processing)
 * - agent-speaking: speaker cone + two sound waves (tutor is talking)
 *
 * Each is 20x20, inherits currentColor, aria-hidden (the button's aria-label
 * carries the accessible name; the glyph is purely visual/shape information).
 */
export function ActivityGlyph({ activity }: { activity: VoiceActivity }): ReactElement {
  switch (activity) {
    case 'listening':
      return (
        <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
          {/* mic capsule */}
          <rect x="7" y="1" width="6" height="10" rx="3" />
          {/* mic stand arc */}
          <path d="M4 9a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="1.5" fill="none" />
          {/* stand + base */}
          <line x1="10" y1="15" x2="10" y2="18" stroke="currentColor" strokeWidth="1.5" />
          <line x1="7" y1="18" x2="13" y2="18" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'thinking':
      return (
        <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
          {/* three dots — unambiguous "processing" shape */}
          <circle cx="4"  cy="10" r="2" />
          <circle cx="10" cy="10" r="2" />
          <circle cx="16" cy="10" r="2" />
        </svg>
      );
    case 'agent-speaking':
      return (
        <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
          {/* speaker body */}
          <path d="M3 7h3l4-3v12l-4-3H3z" />
          {/* inner sound wave */}
          <path d="M13 7a4 4 0 0 1 0 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          {/* outer sound wave */}
          <path d="M15 5a6.5 6.5 0 0 1 0 10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      );
  }
}

/** Human-readable announcement text for the aria-live region (WCAG 4.1.3 / ADR-016). */
export function activityAnnouncement(activity: VoiceActivity): string {
  switch (activity) {
    case 'listening':       return 'Listening';
    case 'thinking':        return 'Tutor is thinking';
    case 'agent-speaking':  return 'Tutor is speaking';
  }
}
