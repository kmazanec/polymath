import type { ReactElement } from 'react';
import type { ComponentSpec } from '@polymath/contract';
import { ReadOnlyTruthTable } from './ReadOnlyTruthTable.js';
import { GateShape, type GateShapeKind } from './gateShapes.js';

type IntroExplanationSpec = Extract<ComponentSpec, { kind: 'IntroExplanation' }>;

/** Map an operator-explanation topic to its gate shape. Returns null for a
 *  non-operator card (e.g. the "Truth tables" card), which shows no gate. */
function gateForTopic(topic: string): GateShapeKind | null {
  switch (topic.trim().toUpperCase()) {
    case 'AND':
      return 'AND';
    case 'OR':
      return 'OR';
    case 'NOT':
      return 'NOT';
    default:
      return null;
  }
}

export function IntroExplanation({
  spec,
  onAdvanceIntro,
}: {
  spec: IntroExplanationSpec;
  onAdvanceIntro?: () => void;
}): ReactElement {
  // Operator cards (AND/OR/NOT) teach the concept in three forms: the body carries
  // the symbol + the code form as text, and we render the canonical logic-gate
  // shape here so the learner meets the gate from the very first exposure (the
  // brief's "fluency across three representations"). The "Truth tables" card has no
  // gate and instead shows the illustrative grid.
  const gate = gateForTopic(spec.topic);

  return (
    <section className="intro-explanation" aria-labelledby="intro-explanation-topic">
      <p className="eyebrow intro-explanation__eyebrow">Concept</p>
      <h2 id="intro-explanation-topic" className="intro-explanation__topic">
        {spec.topic}
      </h2>
      <p className="intro-explanation__body">{spec.body}</p>

      {gate && (
        <figure className="intro-explanation__gate" aria-label={`The ${spec.topic} logic gate`}>
          <div className="intro-explanation__gate-wires" data-gate={gate}>
            {/* input wires + the gate body + output wire, so it reads as a real gate */}
            <span className="intro-explanation__wire-stack" aria-hidden="true">
              <span className="intro-explanation__wire" data-label={gate === 'NOT' ? '' : 'A'} />
              {gate !== 'NOT' && <span className="intro-explanation__wire" data-label="B" />}
            </span>
            <span className="intro-explanation__gate-body">
              <GateShape kind={gate} />
            </span>
            <span className="intro-explanation__wire intro-explanation__wire--out" aria-hidden="true" />
          </div>
          <figcaption className="intro-explanation__gate-caption">
            The {spec.topic} gate — {gate === 'NOT' ? 'one input, one output' : 'two inputs, one output'}.
          </figcaption>
        </figure>
      )}

      {spec.illustration && (
        <ReadOnlyTruthTable
          illustration={spec.illustration}
          caption="Inputs on the left, Output on the right. Each row is one situation — read it across; the Output column top-to-bottom is what this operator does."
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
