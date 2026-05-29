import { Fragment, type ReactElement } from 'react';
import { InlineMath } from 'react-katex';

/**
 * Render a tutor message that may contain inline LaTeX delimited by single `$`.
 * Even-index segments are plain text; odd-index segments are math. This keeps the
 * baseline's "genuine LaTeX dialogue" (ADR-011 "what the baseline does well")
 * without a Markdown engine. An unterminated `$` falls back to plain text.
 */
export function LatexText({ text }: { text: string }): ReactElement {
  const parts = text.split('$');
  // An even number of `$` leaves an even count of segments → the last is text.
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <InlineMath key={i} math={part} />
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
