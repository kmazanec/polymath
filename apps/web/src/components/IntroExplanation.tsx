import type { ReactElement } from 'react';
import type { ComponentSpec } from '@polymath/contract';
import { truthTable } from '@polymath/booleans';
import { formatLogicExpression } from '../logicNotation.js';

type IntroExplanationSpec = Extract<ComponentSpec, { kind: 'IntroExplanation' }>;
type Illustration = NonNullable<IntroExplanationSpec['illustration']>;

/**
 * A small READ-ONLY truth-table grid shown inside a concept card to ground an
 * abstract definition (e.g. "what a truth table is") in a concrete example.
 *
 * Unlike the practice `TruthTable`, there are no interactive cells and no
 * Submit — the output column is pre-filled from `illustration.truthTable` (the
 * MSB-first 0/1 out-vector). The input rows are derived from the expression via
 * @polymath/booleans so the row order is canonical (MSB-first) and always
 * matches the engine. If the expression can't be parsed (it shouldn't — lesson
 * authoring keeps it consistent), the grid is simply omitted rather than
 * throwing; the card still teaches via its prose.
 */
function IllustrativeTruthTable({ illustration }: { illustration: Illustration }): ReactElement | null {
  let rows: boolean[][];
  let vars: string[];
  try {
    const table = truthTable(illustration.expression);
    rows = table.rows;
    vars = table.vars;
  } catch {
    return null;
  }
  // Only render if the provided output column lines up with the derived rows.
  if (illustration.truthTable.length !== rows.length) return null;

  const display = formatLogicExpression(illustration.expression);
  return (
    <figure className="intro-explanation__illustration">
      <section className="truth-table truth-table--readonly" aria-label={`Example truth table for ${display}`}>
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
            {rows.map((inputRow, rowIdx) => {
              const out = illustration.truthTable[rowIdx] ?? 0;
              return (
                <tr key={rowIdx} role="row">
                  {inputRow.map((val, colIdx) => (
                    <td key={colIdx}>
                      <span className={`tt-bit ${val ? 'tt-bit--on' : 'tt-bit--off'}`}>{val ? '1' : '0'}</span>
                    </td>
                  ))}
                  <td>
                    <span className={`tt-bit ${out === 1 ? 'tt-bit--on' : 'tt-bit--off'}`}>
                      {out === 1 ? '1' : '0'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <figcaption className="intro-explanation__illustration-caption">
        Example: <code>{display}</code> — read the output column top to bottom.
      </figcaption>
    </figure>
  );
}

/**
 * A calm, legible teaching card that introduces a concept before the learner
 * works with it (the worked-example-effect preamble). Renders the `topic` as a
 * section heading, an optional concrete truth-table illustration, and `body` as
 * prose.
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
      {spec.illustration && <IllustrativeTruthTable illustration={spec.illustration} />}
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
