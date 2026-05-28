import type { ReactElement } from 'react';
import type { ComponentSpec } from '@polymath/contract';

type LessonIntroSpec = Extract<ComponentSpec, { kind: 'LessonIntro' }>;

/** The one component the walking skeleton renders for real. */
export function LessonIntro({ spec }: { spec: LessonIntroSpec }): ReactElement {
  return (
    <section className="lesson-intro" aria-labelledby="lesson-intro-title">
      <h1 id="lesson-intro-title">{spec.title}</h1>
      <p>{spec.body}</p>
    </section>
  );
}
