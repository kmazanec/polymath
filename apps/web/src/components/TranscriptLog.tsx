/**
 * F-27: Transcript log renderer (ADR-015).
 *
 * Renders the append-only ordered transcript of everything that has happened
 * in the lesson:  intros, worked examples, hints, answers, verdicts, completed
 * items, and (F-30 seam) spoken turns.  Each turn is a read-only record —
 * nothing here is interactive.
 *
 * The whole region is a `<section aria-label="Lesson log">` so screen-reader
 * users can navigate to it via the landmark list.  Verdicts carry `aria-live`
 * so they're announced immediately on submit.
 *
 * Design: delegates spec-bearing turns back to `renderComponent` (the existing
 * registry switch) with NO `onSubmit` — the transcript is read-only.  The
 * `never` default on the Turn switch catches missing arms at compile time.
 */

import type { ReactElement } from 'react';
import type { Turn } from '../surfaceState.js';
import { renderComponent } from './registry.js';

interface TranscriptLogProps {
  turns: Turn[];
}

function renderTurn(turn: Turn, index: number): ReactElement {
  switch (turn.kind) {
    case 'intro':
      return (
        <div key={index} className="transcript-turn transcript-turn--intro">
          {renderComponent(turn.spec)}
        </div>
      );
    case 'workedExample':
      return (
        <div key={index} className="transcript-turn transcript-turn--worked-example">
          {renderComponent(turn.spec)}
        </div>
      );
    case 'hint':
      return (
        <div key={index} className="transcript-turn transcript-turn--hint">
          {renderComponent(turn.spec)}
        </div>
      );
    case 'answer':
      return (
        <div key={index} className="transcript-turn transcript-turn--answer">
          {renderComponent(turn.spec)}
        </div>
      );
    case 'recall':
      // Recall is rendered via renderComponent (preserves the read-only note semantics
      // + data-kc attribute) but with NO onCrossLessonRecallDismiss — in the transcript
      // the recall is a read-only record, never dismissible.
      return (
        <div key={index} className="transcript-turn transcript-turn--recall">
          {renderComponent(turn.spec)}
        </div>
      );
    case 'verdict':
      // aria-live so the announcement fires immediately when appended to the DOM.
      return (
        <div
          key={index}
          className={`transcript-turn transcript-turn--verdict transcript-verdict--${turn.correct ? 'correct' : 'incorrect'}`}
          aria-live="polite"
          data-testid="verdict"
        >
          <span className="verdict-icon" aria-hidden="true">
            {turn.correct ? '✓' : '✗'}
          </span>
          <span className="verdict-label">
            {turn.correct ? 'Correct' : 'Incorrect'} — {turn.expression}
          </span>
        </div>
      );
    case 'completedItem': {
      // Read-only echo of the superseded workspace item.  BUG-03: an item whose
      // LAST verdict was wrong (the tutor moved on / remediated) is "Reviewed",
      // not "Completed ✓" — only a correct last verdict earns the completed
      // label.  `solved === undefined` (no verdict recorded) is neutral.
      const itemExpr =
        'expression' in turn.spec
          ? (turn.spec as { expression: string }).expression
          : 'targetExpression' in turn.spec
          ? (turn.spec as { targetExpression: string }).targetExpression
          : turn.spec.kind;
      const wasWrong = turn.solved === false;
      return (
        <div
          key={index}
          className={`transcript-turn transcript-turn--completed-item${
            wasWrong ? ' transcript-turn--reviewed-item' : ''
          }`}
        >
          <div
            className="completed-item-label"
            aria-label={wasWrong ? 'Reviewed item' : 'Completed item'}
          >
            <span aria-hidden="true">{wasWrong ? '↻' : '✓'}</span>{' '}
            {wasWrong ? 'Reviewed' : 'Completed'}: {itemExpr}
          </div>
        </div>
      );
    }
    case 'spokenTurn':
      // F-30 seam: rendered as a chat bubble. F-27 only defines the slot;
      // F-30 produces the content.
      return (
        <div
          key={index}
          className={`transcript-turn transcript-turn--spoken transcript-spoken--${turn.speaker}`}
          aria-label={`${turn.speaker === 'learner' ? 'You said' : 'Tutor said'}: ${turn.text}`}
        >
          <span className="spoken-speaker">{turn.speaker === 'learner' ? 'You' : 'Tutor'}</span>
          <span className="spoken-text">{turn.text}</span>
        </div>
      );
    default: {
      // Exhaustiveness: if a new Turn variant is added without a case here,
      // `turn` is not `never` and this fails to compile.
      const _exhaustive: never = turn;
      return _exhaustive;
    }
  }
}

/**
 * Renders the ordered, read-only lesson transcript as a named semantic region.
 * Empty when no turns have been appended yet (the region still renders so
 * screen readers see the landmark from the start).
 */
export function TranscriptLog({ turns }: TranscriptLogProps): ReactElement {
  return (
    <section className="transcript-log" aria-label="Lesson log">
      {turns.length === 0 ? (
        <p className="transcript-empty" aria-hidden="true">
          Your lesson history will appear here.
        </p>
      ) : (
        <ol className="transcript-list" aria-label="Lesson history">
          {turns.map((turn, i) => (
            <li key={i} className="transcript-list-item">
              {renderTurn(turn, i)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
