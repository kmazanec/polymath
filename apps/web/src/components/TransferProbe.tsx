import { type ReactElement, useMemo } from 'react';
import type { ComponentSpec, Rep } from '@polymath/contract';
import { truthTable } from '@polymath/booleans';
import { TruthTable } from './TruthTable.js';
import { CircuitBuilder } from './CircuitBuilder.js';
import { PseudocodeChallenge } from './PseudocodeChallenge.js';
import type { RepSubmitPayload } from './registry.js';

type TransferProbeSpec = Extract<ComponentSpec, { kind: 'TransferProbe' }>;

/**
 * The transfer-probe workspace (ADR-005 refusal #2 / ADR-010 Layer 5). It mounts
 * the workspace for **only** `targetRep` and renders nothing for any rep in
 * `hiddenReps` — the held-out reps are literally not in the DOM, so the learner
 * must produce the answer in the target form without the scaffold they trained on.
 *
 * It reuses the real rep components, handing each a synthetic spec with
 * `visibleReps: [targetRep]` so the rep's own `visibleReps` gate (the
 * probe-integrity boundary) keeps every non-target rep `null`.
 */
export function TransferProbe({
  spec,
  onSubmit,
}: {
  spec: TransferProbeSpec;
  onSubmit?: (payload: RepSubmitPayload) => void;
}): ReactElement {
  // The canonical answer key for the probed expression, computed client-side
  // (ADR-008). The learner produces the answer; the rep verifies it locally and
  // the canonical submission round-trips for the server's transfer_submitted check.
  const claimedTruthTable = useMemo(
    () => truthTable(spec.expression).out.map((v) => (v ? 1 : 0)) as (0 | 1)[],
    [spec.expression],
  );
  const visibleReps: Rep[] = [spec.targetRep];

  return (
    <section className="transfer-probe" aria-label="Transfer check">
      <p className="transfer-probe__banner">
        Transfer check — show me you can do this without scaffolds.
      </p>
      {spec.targetRep === 'truth_table' && (
        <TruthTable
          spec={{ kind: 'TruthTablePractice', expression: spec.expression, claimedTruthTable, visibleReps }}
          onSubmit={
            onSubmit &&
            ((e) =>
              onSubmit({
                submission: e.submission,
                repSubmission: { rep: 'truth_table', cells: e.repSubmission.cells as (0 | 1)[] },
                correct: e.correct,
              }))
          }
        />
      )}
      {spec.targetRep === 'circuit' && (
        <CircuitBuilder
          spec={{
            kind: 'CircuitBuilder',
            targetExpression: spec.expression,
            claimedTruthTable,
            allowedGates: ['AND', 'OR', 'NOT'],
            visibleReps,
          }}
          hiddenReps={spec.hiddenReps}
          onSubmit={onSubmit}
        />
      )}
      {spec.targetRep === 'pseudocode' && (
        <PseudocodeChallenge
          spec={{ kind: 'PseudocodeChallenge', targetExpression: spec.expression, claimedTruthTable, visibleReps }}
          onSubmit={onSubmit}
        />
      )}
    </section>
  );
}
