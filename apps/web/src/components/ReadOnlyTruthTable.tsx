import type { ReactElement } from 'react';
import type { Illustration } from '@polymath/contract';
import { truthTable } from '@polymath/booleans';
import { formatLogicExpression } from '../logicNotation.js';

/** Read-only truth table for a teaching surface: input rows derived MSB-first
 *  via @polymath/booleans, output column pre-filled from the spec. Returns null
 *  if the expression won't parse or the output column doesn't match the rows. */
export function ReadOnlyTruthTable({
  illustration,
  caption = true,
}: {
  illustration: Illustration;
  caption?: boolean | string;
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
  const captionContent =
    caption === false ? null : typeof caption === 'string' ? caption : (
      <>
        Example: <code>{display}</code> — read the output column top to bottom.
      </>
    );

  return (
    <figure className="readonly-tt">
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
      {captionContent && <figcaption className="readonly-tt__caption">{captionContent}</figcaption>}
    </figure>
  );
}
