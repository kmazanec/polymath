import type { ReactElement } from 'react';
import type { ComponentSpec, Step } from '@polymath/contract';
import { formatLogicExpression } from '../logicNotation.js';
import { ReadOnlyTruthTable } from './ReadOnlyTruthTable.js';

type WorkedExampleSpec = Extract<ComponentSpec, { kind: 'WorkedExample' }>;

export function WorkedExample({
  spec,
  onAdvanceIntro,
}: {
  spec: WorkedExampleSpec;
  onAdvanceIntro?: () => void;
}): ReactElement {
  return (
    <section className="worked-example" aria-labelledby="worked-example-heading">
      <p className="eyebrow worked-example__eyebrow">Worked example</p>
      <h2 id="worked-example-heading" className="worked-example__heading">
        Walk-through
      </h2>
      <p className="worked-example__expression" aria-label={`Expression: ${spec.expression}`}>
        <code>{formatLogicExpression(spec.expression)}</code>
      </p>
      <div className={spec.illustration ? 'worked-example__layout worked-example__layout--illustrated' : 'worked-example__layout'}>
        {spec.illustration && (
          <div className="worked-example__visual">
            <ReadOnlyTruthTable illustration={spec.illustration} caption={false} operatorBetweenInputs />
          </div>
        )}
        <ol className="worked-example__steps" aria-label="Step-by-step derivation">
          {spec.steps.map((step: Step, i: number) => (
            <li key={i} className="worked-example__step">
              <span className="worked-example__step-label">{step.label}</span>
              <span className="worked-example__step-detail">{step.detail}</span>
            </li>
          ))}
        </ol>
      </div>
      {onAdvanceIntro && (
        <button type="button" className="intro-continue-btn" onClick={onAdvanceIntro}>
          Got it — continue
        </button>
      )}
    </section>
  );
}
