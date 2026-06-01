import type { ReactElement } from 'react';
import type { ComponentSpec } from '@polymath/contract';
import { ReadOnlyTruthTable } from './ReadOnlyTruthTable.js';

type IntroExplanationSpec = Extract<ComponentSpec, { kind: 'IntroExplanation' }>;

export function IntroExplanation({
  spec,
  onAdvanceIntro,
}: {
  spec: IntroExplanationSpec;
  onAdvanceIntro?: () => void;
}): ReactElement {
  return (
    <section className="intro-explanation" aria-labelledby="intro-explanation-topic">
      <p className="eyebrow intro-explanation__eyebrow">Concept</p>
      <h2 id="intro-explanation-topic" className="intro-explanation__topic">
        {spec.topic}
      </h2>
      <p className="intro-explanation__body">{spec.body}</p>
      {spec.illustration && (
        <ReadOnlyTruthTable
          illustration={spec.illustration}
          caption="Its truth table — output is 1 only in the last row, where both inputs are 1."
        />
      )}
      {onAdvanceIntro && (
        <button type="button" className="intro-continue-btn" onClick={onAdvanceIntro}>
          Got it — continue
        </button>
      )}
    </section>
  );
}
