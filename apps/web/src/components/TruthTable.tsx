import { type ReactElement, useCallback, useState } from 'react';
import type { ComponentSpec, ClientEvent } from '@polymath/contract';
import { truthTable, variables, parse } from '@polymath/booleans';
import { prefersReducedMotion } from '../motion/AnimateOrNot.js';

type TruthTableSpec = Extract<ComponentSpec, { kind: 'TruthTablePractice' }>;

/** Maximum number of distinct variables before the 2^n blowup guard fires. */
const MAX_VARS = 10;

/** The shape of the submit event the parent receives (a subset of ClientEvent 'submit'
 *  enriched with a client-side `correct` verdict so the caller doesn't re-derive it). */
export interface TruthTableSubmitEvent {
  kind: 'submit';
  submission: string;
  repSubmission: { rep: 'truth_table'; cells: number[] };
  correct: boolean;
}

interface TruthTableProps {
  spec: TruthTableSpec;
  /** Called when the learner clicks Submit. Receives the event shape to dispatch
   *  over the WebSocket plus the pre-computed `correct` flag. */
  onSubmit?: (event: TruthTableSubmitEvent) => void;
}

/**
 * Suppress the truth-table workspace when its rep isn't visible (a transfer probe
 * hiding `truth_table` must not expose it). Guards before the inner component's
 * hooks. Mirrors CircuitBuilder's visibleReps gate.
 */
export function TruthTable({ spec, onSubmit }: TruthTableProps): ReactElement | null {
  if (!spec.visibleReps.includes('truth_table')) return null;
  return <TruthTableInner spec={spec} onSubmit={onSubmit} />;
}

type CellVerdict = 'correct' | 'incorrect' | null;

/**
 * TruthTable practice component (F-02).
 *
 * Renders a truth table for `spec.expression`:
 *  - Input columns are read-only (the agent/expression determines them).
 *  - The output column is fully interactive (click to toggle 0/1).
 *  - On Submit, validates client-side via @polymath/booleans and calls onSubmit.
 *  - Reduced-motion: no CSS transition when prefers-reduced-motion is active.
 *  - Keyboard: output cells are <button>s (Tab-reachable, Space toggles, Enter on Submit).
 *  - Variable count is capped at 10 (2^n blowup guard); renders error otherwise.
 *
 * The coordinator wires this into registry.tsx under the TruthTablePractice case.
 * PulseContext subscriber (AC8 / T-02c) is deferred until F-03 lands PulseContext.
 */
function TruthTableInner({ spec, onSubmit }: TruthTableProps): ReactElement {
  // -----------------------------------------------------------------------
  // Parse expression and derive table
  // -----------------------------------------------------------------------
  let parseError: string | null = null;
  let vars: string[] = [];
  let tableRows: boolean[][] = [];
  let expectedOut: boolean[] = [];

  try {
    const ast = parse(spec.expression);
    vars = variables(ast);
    if (vars.length > MAX_VARS) {
      parseError = `Expression has ${vars.length} variables — truth tables are capped at ${MAX_VARS} (2^n rows).`;
    } else {
      const table = truthTable(spec.expression);
      vars = table.vars;
      tableRows = table.rows;
      expectedOut = table.out;
    }
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  // -----------------------------------------------------------------------
  // State: learner output cells (0 = false, 1 = true) + post-submit verdicts
  // -----------------------------------------------------------------------
  const rowCount = tableRows.length;
  const [cells, setCells] = useState<(0 | 1)[]>(() => new Array(rowCount).fill(0) as (0 | 1)[]);
  const [verdicts, setVerdicts] = useState<CellVerdict[]>(() =>
    new Array(rowCount).fill(null) as CellVerdict[],
  );
  const [submitted, setSubmitted] = useState(false);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------
  const handleToggle = useCallback(
    (rowIdx: number) => {
      if (submitted) return; // lock after submit
      setCells((prev) => {
        const next = [...prev] as (0 | 1)[];
        next[rowIdx] = next[rowIdx] === 0 ? 1 : 0;
        return next;
      });
    },
    [submitted],
  );

  const handleSubmit = useCallback(() => {
    if (submitted || parseError !== null) return;
    // Client-side verdict (ADR-008: correctness never touches the network)
    const newVerdicts: CellVerdict[] = cells.map((cell, i) => {
      const expected = expectedOut[i] ? 1 : 0;
      return cell === expected ? 'correct' : 'incorrect';
    });
    setVerdicts(newVerdicts);
    setSubmitted(true);

    const correct = newVerdicts.every((v) => v === 'correct');
    onSubmit?.({
      kind: 'submit',
      submission: spec.expression,
      repSubmission: { rep: 'truth_table', cells },
      correct,
    });
  }, [submitted, parseError, cells, expectedOut, spec.expression, onSubmit]);

  // -----------------------------------------------------------------------
  // Reduced-motion flag (AC7)
  // -----------------------------------------------------------------------
  const noMotion = prefersReducedMotion();

  // -----------------------------------------------------------------------
  // Error guard (2^n blowup)
  // -----------------------------------------------------------------------
  if (parseError !== null) {
    return (
      <div role="alert" className="truth-table-error">
        <p>{parseError}</p>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <section className="truth-table" aria-label={`Truth table for ${spec.expression}`}>
      <table role="table">
        <thead>
          <tr role="row">
            {vars.map((v) => (
              <th key={v} scope="col">
                {v}
              </th>
            ))}
            <th scope="col">Output</th>
          </tr>
        </thead>
        <tbody>
          {tableRows.map((inputRow, rowIdx) => {
            const verdict = verdicts[rowIdx] ?? null;
            const cellValue = cells[rowIdx] ?? 0;
            return (
              <tr key={rowIdx} role="row">
                {/* Input columns — static, non-interactive text. A native <td>
                    already conveys cell semantics; `aria-readonly` is NOT a supported
                    attribute on role="cell" (axe `aria-allowed-attr`, an a11y audit
                    finding) — these cells are inherently read-only, so no attribute
                    is needed to say so. */}
                {inputRow.map((val, colIdx) => (
                  <td key={colIdx}>{val ? '1' : '0'}</td>
                ))}
                {/* Output cell — interactive button */}
                <td role="cell">
                  <button
                    type="button"
                    aria-pressed={cellValue === 1}
                    data-verdict={verdict ?? undefined}
                    onClick={() => handleToggle(rowIdx)}
                    disabled={submitted}
                    style={
                      noMotion
                        ? { transition: 'none' }
                        : undefined
                    }
                    className={[
                      'truth-table-output-cell',
                      verdict === 'correct' ? 'verdict-correct' : '',
                      verdict === 'incorrect' ? 'verdict-incorrect' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {cellValue === 1 ? '1' : '0'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitted || parseError !== null}
        className="truth-table-submit"
      >
        Submit
      </button>
    </section>
  );
}
