import type { ReactElement } from 'react';
import type { ComponentSpec, Step } from '@polymath/contract';

type WorkedExampleSpec = Extract<ComponentSpec, { kind: 'WorkedExample' }>;

/**
 * The worked-example-effect payload (Sweller): the learner studies a complete,
 * step-by-step derivation BEFORE attempting similar problems on their own. The
 * `expression` is the target — displayed prominently in monospace so it reads as
 * the thing being operated on. The `steps` are an ordered demonstration sequence:
 * each `label` names the move (e.g. "Apply De Morgan's law"), and `detail` shows
 * the result or elaboration.
 *
 * This component is READ-ONLY — no inputs, no submission, no verdict. Its whole
 * job is reducing intrinsic load before practice begins by giving the learner a
 * schema to anchor subsequent problems against.
 *
 * Structured as a `<section>` landmark with an ordered `<ol>` (step numbers are
 * load-bearing — they let a learner say "step 3 confused me" and are the correct
 * semantic for a sequence with a defined order and a last item).
 */
export function WorkedExample({ spec }: { spec: WorkedExampleSpec }): ReactElement {
  return (
    <section
      className="worked-example"
      aria-labelledby="worked-example-heading"
    >
      <p className="eyebrow worked-example__eyebrow">Worked example</p>
      <h2 id="worked-example-heading" className="worked-example__heading">
        Walk-through
      </h2>
      <p className="worked-example__expression" aria-label={`Expression: ${spec.expression}`}>
        <code>{spec.expression}</code>
      </p>
      <ol className="worked-example__steps" aria-label="Step-by-step derivation">
        {spec.steps.map((step: Step, i: number) => (
          <li key={i} className="worked-example__step">
            <span className="worked-example__step-label">{step.label}</span>
            <span className="worked-example__step-detail">{step.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
