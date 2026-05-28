import type { ReactElement } from 'react';
import type { ComponentSpec, Rep } from '@polymath/contract';
import { LessonIntro } from './LessonIntro.js';
import { CircuitBuilder } from './CircuitBuilder.js';
import { PseudocodeChallenge } from './PseudocodeChallenge.js';
import { TruthTable } from './TruthTable.js';
import { AgentAnswer } from './AgentAnswer.js';
import { TransferProbe } from './TransferProbe.js';
import { HintCard } from './HintCard.js';
import {
  ExplainBackPrompt,
  type ExplainBackPromptDeps,
  type ExplainBackEndPayload,
} from './ExplainBackPrompt.js';

/**
 * The curated component registry renderer (ADR-005). A single exhaustive switch
 * on `ComponentSpec.kind` — no dynamic lookup, no `eval`, no
 * `dangerouslySetInnerHTML`. The `never` default makes the switch exhaustive at
 * compile time: adding a variant to the `ComponentSpec` union without adding a
 * case here is a type error (the testing-requirement exhaustiveness guarantee).
 *
 * F-05 wires the rep components' `onSubmit` (so a learner submission reaches the
 * socket) and renders `AgentAnswer` for real. `hiddenReps` is threaded so a
 * transfer probe (F-07) can suppress held-out reps; the rep components already
 * gate on `spec.visibleReps` themselves (the probe-integrity boundary).
 */

/** A normalized submission the caller dispatches over the WebSocket. The three
 *  reps share this shape (they each enrich it with a client-side `correct`). */
export interface RepSubmitPayload {
  submission: string;
  repSubmission: import('@polymath/contract').RepSubmission;
  correct: boolean;
}

export interface RenderOptions {
  onSubmit?: (payload: RepSubmitPayload) => void;
  hiddenReps?: Rep[];
  /** F-11: the TTS + recording seams for `ExplainBackPrompt`. App supplies the
   *  real F-10 voice-client-backed seam; absent → a safe no-op (no TTS, an empty
   *  transcript on close, which the server treats as a fail-closed precondition
   *  miss — never a crash). */
  explainBackDeps?: ExplainBackPromptDeps;
  /** F-11: dispatch the `explain_back_recording_ended` event when the window closes. */
  onExplainBackEnd?: (payload: ExplainBackEndPayload) => void;
}

/** A safe no-op explain-back seam for when no real voice client is wired (tests,
 *  the registry default). TTS is a no-op; the recorder yields an empty transcript
 *  → the server's precondition #3 fails CLOSED. */
const NOOP_EXPLAIN_BACK_DEPS: ExplainBackPromptDeps = {
  speak: () => undefined,
  startRecording: () => () => '',
};

function Tbd({ kind }: { kind: string }): ReactElement {
  return (
    <div role="note" data-tbd={kind}>
      <em>{kind}</em> — not yet implemented in the walking skeleton.
    </div>
  );
}

export function renderComponent(spec: ComponentSpec, opts: RenderOptions = {}): ReactElement {
  const { onSubmit } = opts;
  switch (spec.kind) {
    case 'LessonIntro':
      return <LessonIntro spec={spec} />;
    case 'CircuitBuilder':
      return <CircuitBuilder spec={spec} onSubmit={onSubmit} hiddenReps={opts.hiddenReps} />;
    case 'PseudocodeChallenge':
      return <PseudocodeChallenge spec={spec} onSubmit={onSubmit} />;
    case 'TruthTablePractice':
      // TruthTable's event carries `cells: number[]` (and a redundant `kind`);
      // normalize to the shared RepSubmitPayload (cells are 0/1 by construction).
      return (
        <TruthTable
          spec={spec}
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
      );
    case 'AgentAnswer':
      return <AgentAnswer spec={spec} />;
    case 'TransferProbe':
      return <TransferProbe spec={spec} onSubmit={onSubmit} />;
    case 'HintCard':
      return <HintCard spec={spec} />;
    case 'ExplainBackPrompt':
      return (
        <ExplainBackPrompt
          spec={spec}
          deps={opts.explainBackDeps ?? NOOP_EXPLAIN_BACK_DEPS}
          onExplainBackEnd={opts.onExplainBackEnd}
        />
      );
    case 'IntroExplanation':
    case 'WorkedExample':
    case 'ConfidenceCheck':
    case 'MasteryCelebration':
      return <Tbd kind={spec.kind} />;
    default: {
      // Exhaustiveness: if a new ComponentSpec variant is added without a case
      // above, `spec` is not `never` here and this fails to compile.
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}
