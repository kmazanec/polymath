import { Fragment, type ReactElement } from 'react';
import type { Illustration } from '@polymath/contract';
import { truthTable } from '@polymath/booleans';
import { formatLogicExpression } from '../logicNotation.js';

/** If the formatted expression is a SINGLE binary operator between two operands
 *  (e.g. `A & B`), return that operator glyph — used to repeat the operator
 *  between the input value columns on the walk-through table so a row reads
 *  "0 & 0". Returns null for anything else (NOT, nested, >1 operator), so the
 *  operator column simply isn't shown. */
function singleBinaryOperatorGlyph(formatted: string): string | null {
  // Match: operand <op> operand, where operand is a bare variable. The op is one
  // of the formatted binary glyphs (&, ||). (NOT is unary → no between-column op.)
  const m = /^\s*[A-Z]\s*(&|\|\|)\s*[A-Z]\s*$/.exec(formatted);
  return m ? m[1]! : null;
}

/** Read-only truth table for a teaching surface: input rows derived MSB-first
 *  via @polymath/booleans, output column pre-filled from the spec. Returns null
 *  if the expression won't parse or the output column doesn't match the rows. */
export function ReadOnlyTruthTable({
  illustration,
  caption = true,
  operatorBetweenInputs = false,
}: {
  illustration: Illustration;
  caption?: boolean | string;
  /** Walk-through only: render the binary operator glyph between the input value
   *  columns (and headers), so each row reads "0 & 1" — making "A & B" explicit. */
  operatorBetweenInputs?: boolean;
}): ReactElement | null {
  let rows: boolean[][];
  let vars: string[];
  try {
    const table = truthTable(illustration.expression);
    rows = table.rows;
    vars = table.vars;
  } catch {
    return null;
  }
  if (illustration.truthTable.length !== rows.length) return null;

  const display = formatLogicExpression(illustration.expression);
  // Operator glyph repeated between input columns (walk-through only). Only when
  // the caller opted in AND the expression is a single binary op between vars.
  const opGlyph = operatorBetweenInputs ? singleBinaryOperatorGlyph(display) : null;
  const captionContent =
    caption === false ? null : typeof caption === 'string' ? caption : (
      <>
        Example: <code>{display}</code> — read the output column top to bottom.
      </>
    );

  const lastInputIdx = vars.length - 1;

  return (
    <figure className="readonly-tt">
      <section className="truth-table truth-table--readonly" aria-label={`Example truth table for ${display}`}>
        <table role="table">
          <thead>
            <tr role="row">
              {vars.map((v, i) => (
                <Fragment key={v}>
                  <th scope="col">{v}</th>
                  {opGlyph && i < lastInputIdx && (
                    <th scope="col" className="tt-op-col" aria-hidden="true">
                      {opGlyph}
                    </th>
                  )}
                </Fragment>
              ))}
              {/* divider sits on the Output header (left border) — see CSS */}
              <th scope="col" className="tt-out-col">Output</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inputRow, rowIdx) => {
              const out = illustration.truthTable[rowIdx] ?? 0;
              return (
                <tr key={rowIdx} role="row">
                  {inputRow.map((val, colIdx) => (
                    <Fragment key={colIdx}>
                      <td>
                        <span className={`tt-bit ${val ? 'tt-bit--on' : 'tt-bit--off'}`}>{val ? '1' : '0'}</span>
                      </td>
                      {opGlyph && colIdx < lastInputIdx && (
                        <td className="tt-op-col" aria-hidden="true">
                          <span className="tt-op">{opGlyph}</span>
                        </td>
                      )}
                    </Fragment>
                  ))}
                  <td className="tt-out-col">
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
      {captionContent && <figcaption className="readonly-tt__caption">{captionContent}</figcaption>}
    </figure>
  );
}
