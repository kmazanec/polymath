import type { ReactElement } from 'react';
import type { ComponentSpec } from '@polymath/contract';

type MasteryCelebrationSpec = Extract<ComponentSpec, { kind: 'MasteryCelebration' }>;

/**
 * F-12 (AC#6): the celebration mounted when the server's mastery gate accepts a
 * transition→mastered. It lists the concepts the learner has actually mastered
 * (`spec.conceptsMastered`, sourced server-side from `learner_state` BKT, not the
 * agent's claim) and offers a "Continue to Lesson 2" affordance. The affordance is
 * enabled only when a `nextLessonId` is present (server-set, guarded by the non-fatal
 * `loadLesson(next)` existence check), so a mastered learner sees a real next step
 * exists.
 *
 * F-15 wires its click to `onContinue(nextLessonId)`, which the App turns into an
 * `advance_lesson` event — a SERVER reflex re-derives L1 mastery (the earned-it guard)
 * and deterministically mounts L2's first item on the SAME session. Absent `onContinue`
 * (isolated component tests, no socket) the button is inert even when enabled.
 */
export function MasteryCelebration({
  spec,
  onContinue,
  onTryPlayground,
}: {
  spec: MasteryCelebrationSpec;
  onContinue?: (nextLessonId: number) => void;
  /** ADR-013 stretch: the "Try the Playground" affordance. The App passes it ONLY
   *  when the just-mastered lesson is the final one (no `nextLessonId`), so a
   *  mastered learner sees the free-build capstone as a separate door from the
   *  next-lesson advance. Absent → the button is not rendered. */
  onTryPlayground?: () => void;
}): ReactElement {
  const concepts = spec.conceptsMastered;
  const nextLessonId = spec.nextLessonId;
  const disabled = nextLessonId === undefined;
  return (
    <section className="mastery-celebration" aria-labelledby="mastery-celebration-title">
      <h1 id="mastery-celebration-title">Mastered!</h1>
      {concepts.length > 0 ? (
        <>
          <p>You have demonstrated mastery of:</p>
          <ul aria-label="concepts mastered">
            {concepts.map((kc) => (
              <li key={kc} data-kc={kc}>
                {kc}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>You have demonstrated mastery.</p>
      )}
      <button
        type="button"
        className="continue-to-next-lesson"
        // Enabled iff the server offered a next lesson (it loaded + validated). Clicking
        // fires onContinue(nextLessonId); the App sends `advance_lesson` and the server
        // reflex (re-derived L1 mastery guard) mounts L2 on the same session.
        disabled={disabled}
        aria-disabled={disabled}
        onClick={
          disabled || onContinue === undefined
            ? undefined
            : () => onContinue(nextLessonId)
        }
      >
        Continue to Lesson 2
      </button>
      {onTryPlayground !== undefined && (
        <button
          type="button"
          className="try-the-playground"
          onClick={onTryPlayground}
        >
          Try the Playground
        </button>
      )}
    </section>
  );
}
