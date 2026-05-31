import type { ReactElement } from 'react';
import type { ComponentSpec } from '@polymath/contract';

type IntroExplanationSpec = Extract<ComponentSpec, { kind: 'IntroExplanation' }>;

/**
 * A calm, legible teaching card that introduces a concept before the learner
 * works with it (the worked-example-effect preamble). Renders the `topic` as a
 * section heading and `body` as prose — no interactive elements, no submission
 * surface. The deliberate restraint is intentional: this is instruction, not
 * practice, so it should feel like a notebook page, not a widget.
 *
 * Structured as a landmark `<section>` with an `aria-labelledby` pointing at the
 * heading so screen-reader users can jump to it via the section list.
 */
export function IntroExplanation({ spec }: { spec: IntroExplanationSpec }): ReactElement {
  return (
    <section
      className="intro-explanation"
      aria-labelledby="intro-explanation-topic"
    >
      <p className="eyebrow intro-explanation__eyebrow">Concept</p>
      <h2 id="intro-explanation-topic" className="intro-explanation__topic">
        {spec.topic}
      </h2>
      <p className="intro-explanation__body">{spec.body}</p>
    </section>
  );
}
