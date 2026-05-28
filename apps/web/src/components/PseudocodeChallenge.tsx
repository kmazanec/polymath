/**
 * PseudocodeChallenge — F-04.
 *
 * Renders a CodeMirror 6 editor pre-configured with the Boolean pseudocode
 * language extension (syntax highlighting, keywords `and`/`or`/`not`/`if`/`then`).
 * On Submit: parses the source via parsePseudocode, computes equivalence client-side
 * via equivalent(), and fires onSubmit with the verdict + repSubmission payload.
 *
 * PulseContext subscriber (T-04d / AC8) is deferred until F-03 lands PulseContext.
 */

import { type ReactElement, useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import type { ComponentSpec } from '@polymath/contract';
import { parsePseudocode, astToExpression, equivalent, BooleanParseError } from '@polymath/booleans';
import { booleanPseudocodeExtension } from '../pseudocode/language.js';

type PseudocodeChallengeSpec = Extract<ComponentSpec, { kind: 'PseudocodeChallenge' }>;

export interface SubmitPayload {
  correct: boolean;
  submission: string;
  repSubmission: {
    rep: 'pseudocode';
    expression: string;
    source: string;
  };
  parseError?: string;
}

interface Props {
  spec: PseudocodeChallengeSpec;
  /** Called when the learner presses Submit with a parseable expression. */
  onSubmit?: (payload: SubmitPayload) => void;
}

const EDITOR_LABEL_ID = 'pseudocode-editor-label';

export function PseudocodeChallenge({ spec, onSubmit }: Props): ReactElement {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Track source in state so tests can set it via fireEvent
  const [source, setSource] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<'correct' | 'incorrect' | null>(null);

  // Mount CM6 editor
  useEffect(() => {
    if (!editorRef.current) return;
    if (viewRef.current) return; // already mounted

    const state = EditorState.create({
      doc: '',
      extensions: [
        booleanPseudocodeExtension,
        placeholder('// write your expression here'),
        keymap.of(defaultKeymap),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setSource(update.state.doc.toString());
          }
        }),
        EditorView.contentAttributes.of({ 'aria-labelledby': EDITOR_LABEL_ID }),
        EditorView.theme({
          '&': { border: '1px solid #d1d5db', borderRadius: '4px', padding: '4px' },
          '.cm-content': { minHeight: '4em', fontFamily: 'monospace' },
          '.cm-placeholder': { color: '#9ca3af', fontStyle: 'italic' },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Allow tests to drive the editor via fireEvent.change on the hidden input
  // (CM6's contenteditable is opaque to RTL; we expose a controlled sync path)
  function handleHiddenInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const val = e.target.value;
    setSource(val);
    // Sync value into CM6 view if it exists
    if (viewRef.current) {
      const currentDoc = viewRef.current.state.doc.toString();
      if (currentDoc !== val) {
        viewRef.current.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: val },
        });
      }
    }
  }

  function handleSubmit(): void {
    setParseError(null);
    setVerdict(null);

    if (!source.trim()) {
      setParseError('Please enter an expression before submitting.');
      return;
    }

    let ast;
    try {
      ast = parsePseudocode(source);
    } catch (err) {
      const msg = err instanceof BooleanParseError ? err.message : String(err);
      setParseError(msg);
      return;
    }

    const expression = astToExpression(ast);
    const isCorrect = equivalent(expression, spec.targetExpression);
    setVerdict(isCorrect ? 'correct' : 'incorrect');

    onSubmit?.({
      correct: isCorrect,
      submission: expression,
      repSubmission: {
        rep: 'pseudocode',
        expression,
        source,
      },
    });
  }

  return (
    <section
      role="region"
      aria-labelledby={EDITOR_LABEL_ID}
      style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      <h2 id={EDITOR_LABEL_ID} style={{ fontSize: '1rem', margin: 0 }}>
        Write a Boolean expression equivalent to:{' '}
        <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
          {spec.targetExpression}
        </code>
      </h2>

      {/* Hidden input for test-driving the editor content (data-testid for tests) */}
      <input
        data-testid="source-input"
        type="text"
        aria-label="pseudocode expression (sync)"
        tabIndex={-1}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
        value={source}
        onChange={handleHiddenInputChange}
      />

      {/* CM6 mounts here */}
      <div ref={editorRef} />

      {/* Parse error / verdict feedback */}
      {parseError !== null && (
        <p role="alert" style={{ color: '#dc2626', margin: 0 }}>
          {parseError}
        </p>
      )}
      {verdict === 'correct' && (
        <p role="status" style={{ color: '#16a34a', margin: 0 }}>
          Correct! Your expression is equivalent to {spec.targetExpression}.
        </p>
      )}
      {verdict === 'incorrect' && (
        <p role="status" style={{ color: '#b45309', margin: 0 }}>
          Incorrect — expression is not equivalent to the target.
        </p>
      )}

      <button type="button" onClick={handleSubmit}>
        Submit
      </button>
    </section>
  );
}
