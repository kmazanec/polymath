import { type ReactElement } from 'react';

/**
 * The persistent "I'm ready to hand off to a tutor" affordance (ADR-012 stretch,
 * AC#1). Visible from any phase; activating it takes the learner to their own handoff
 * artifact for the current session. Pure CLIENT navigation via a real link — it emits
 * NO WebSocket / wire event (the artifact is built read-only by the handoff route on
 * page load); the graded practice turn is never touched. A plain `<a href>` (not a
 * router hook) so it works regardless of router context AND supports open-in-new-tab.
 *
 * Renders nothing until a session id exists (no broken link before the session is
 * minted).
 */
export function HandoffButton({ sessionId }: { sessionId: string | null }): ReactElement | null {
  if (!sessionId) return null;
  return (
    <a className="handoff-button" role="button" href={`/handoff/${sessionId}`}>
      I&apos;m ready to hand off to a tutor
    </a>
  );
}
