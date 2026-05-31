import type { ReactElement } from 'react';
import type { ComponentSpec } from '@polymath/contract';

type IntroExplanationSpec = Extract<ComponentSpec, { kind: 'IntroExplanation' }>;

/**
 * A calm, legible teaching card that introduces a concept before the learner
 * works with it (the worked-example-effect preamble). Renders the `topic` as a
 * section heading and `body` as prose.
 *
 * F-27 (AC#4): When `onAdvanceIntro` is provided, renders a "Got it — continue"
 * button that sends `intro_advance` to deterministically advance the opening
 * sequence without relying on a stray `session_start` re-emit.  In the transcript
 * view (read-only), `onAdvanceIntro` is absent → no continue button.
 *
 * Structured as a landmark `<section>` with an `aria-labelledby` pointing at the
 * heading so screen-reader users can jump to it via the section list.
 */
export function IntroExplanation({
  spec,
  onAdvanceIntro,
}: {
  spec: IntroExplanationSpec;
  onAdvanceIntro?: () => void;
}): ReactElement {
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
      {onAdvanceIntro && (
        <button
          type="button"
          className="intro-continue-btn"
          onClick={onAdvanceIntro}
        >
          Got it — continue
        </button>
      )}
    </section>
  );
}
