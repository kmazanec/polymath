import type { ReactElement } from 'react';
import type { ComponentSpec } from '@polymath/contract';
import { LessonIntro } from './LessonIntro.js';
import { CircuitBuilder } from './CircuitBuilder.js';
import { PseudocodeChallenge } from './PseudocodeChallenge.js';
import { TruthTable } from './TruthTable.js';

/**
 * The curated component registry renderer (ADR-005). A single exhaustive switch
 * on `ComponentSpec.kind` — no dynamic lookup, no `eval`, no
 * `dangerouslySetInnerHTML`. The `never` default makes the switch exhaustive at
 * compile time: adding a variant to the `ComponentSpec` union without adding a
 * case here is a type error (the testing-requirement exhaustiveness guarantee).
 *
 * F-01 renders only `LessonIntro`; every other variant renders a typed TBD
 * placeholder so the walking skeleton compiles against the full union. F-02..
 * onwards replace each placeholder with the real component.
 */
function Tbd({ kind }: { kind: string }): ReactElement {
  return (
    <div role="note" data-tbd={kind}>
      <em>{kind}</em> — not yet implemented in the walking skeleton.
    </div>
  );
}

export function renderComponent(spec: ComponentSpec): ReactElement {
  switch (spec.kind) {
    case 'LessonIntro':
      return <LessonIntro spec={spec} />;
    case 'CircuitBuilder':
      // Visibility is driven by spec.visibleReps inside the component; F-07 will
      // pass an explicit hiddenReps override when it wires transfer probes.
      return <CircuitBuilder spec={spec} />;
    case 'PseudocodeChallenge':
      return <PseudocodeChallenge spec={spec} />;
    case 'TruthTablePractice':
      return <TruthTable spec={spec} />;
    case 'IntroExplanation':
    case 'WorkedExample':
    case 'HintCard':
    case 'TransferProbe':
    case 'ExplainBackPrompt':
    case 'ConfidenceCheck':
    case 'MasteryCelebration':
    case 'AgentAnswer':
      return <Tbd kind={spec.kind} />;
    default: {
      // Exhaustiveness: if a new ComponentSpec variant is added without a case
      // above, `spec` is not `never` here and this fails to compile.
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}
