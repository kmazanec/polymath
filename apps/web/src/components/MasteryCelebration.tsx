import type { ReactElement } from 'react';
import type { ComponentSpec } from '@polymath/contract';

type MasteryCelebrationSpec = Extract<ComponentSpec, { kind: 'MasteryCelebration' }>;

/**
 * F-12 (AC#6): the celebration mounted when the server's mastery gate accepts a
 * transition→mastered. It lists the concepts the learner has actually mastered
 * (`spec.conceptsMastered`, sourced server-side from `learner_state` BKT, not the
 * agent's claim) and offers a "Continue to Lesson 2" affordance. The affordance is
 * a DISABLED placeholder until F-15 wires the L1→L2 transition; it only enables when
 * a `nextLessonId` is present, so a mastered learner sees a real next step exists
 * without the (not-yet-built) navigation firing.
 */
export function MasteryCelebration({ spec }: { spec: MasteryCelebrationSpec }): ReactElement {
  const concepts = spec.conceptsMastered;
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
        // F-15 wires the actual transition; until a next lesson is offered the
        // affordance is a visible-but-disabled placeholder (no handler yet).
        disabled={spec.nextLessonId === undefined}
        aria-disabled={spec.nextLessonId === undefined}
      >
        Continue to Lesson 2
      </button>
    </section>
  );
}
