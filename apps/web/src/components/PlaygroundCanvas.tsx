import { type ReactElement, useMemo, useState } from 'react';
import type { ComponentSpec, Gate, Rep, RepSubmission } from '@polymath/contract';
import {
  BooleanParseError,
  parse,
  truthTable,
  variables,
  playgroundEquivalence,
  type PlaygroundEquivalenceResult,
} from '@polymath/booleans';
import { TruthTable } from './TruthTable.js';
import { CircuitBuilder } from './CircuitBuilder.js';
import { PseudocodeChallenge } from './PseudocodeChallenge.js';

type PlaygroundCanvasSpec = Extract<ComponentSpec, { kind: 'PlaygroundCanvas' }>;

/** What the canvas hands the App to send over the WebSocket on a unified Submit. */
export interface PlaygroundSubmitPayload {
  targetExpression: string;
  submissions: {
    truth_table?: RepSubmission;
    circuit?: RepSubmission;
    pseudocode?: RepSubmission;
  };
  /** The client-side verdict (ADR-013: correctness is computed in the browser, off
   *  the network — the server recompute is defense-in-depth only). */
  verdict: PlaygroundEquivalenceResult;
}

export interface PlaygroundRequestScaffoldPayload {
  targetExpression: string;
  learnerQuestion?: string;
}

export interface PlaygroundCanvasProps {
  spec: PlaygroundCanvasSpec;
  /** Sends the unified `playground_submit` event (the persisted record). */
  onPlaygroundSubmit?: (payload: PlaygroundSubmitPayload) => void;
  /** Sends `playground_request_scaffold` — the agent answers but never directs. */
  onRequestScaffold?: (payload: PlaygroundRequestScaffoldPayload) => void;
  /** Sends `exit_playground` → the App mounts the session-end celebration. */
  onExitPlayground?: () => void;
  /** The agent's most recent scaffold answer (AC#5), threaded from App's `answer`
   *  state. Null until the learner requests a hint and the server replies with the
   *  `verify_playground_equivalence` action. Rendered in a side slot so the canvas
   *  (the learner's in-progress build) is never replaced by it. */
  scaffold?: string | null;
}

/** Every gate the learner may drop in the playground circuit (the full I6 grammar). */
const ALL_GATES: Gate[] = ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR'];

function claimedTableFor(expr: string): (0 | 1)[] {
  return truthTable(expr).out.map((b) => (b ? 1 : 0));
}

/**
 * PlaygroundCanvas — the free-build capstone (ADR-013, ADR-012 stretch).
 *
 * Two phases mirroring the playground micro-statechart's `proposing` and
 * `building`:
 *  1. The learner authors a TARGET Boolean expression (AC#2). Until it parses it
 *     is refused (stays in `proposing`).
 *  2. All three rep editors (truth table, circuit, pseudocode) become available
 *     simultaneously (AC#3), each composing the EXISTING rep component (so they
 *     keep their own client-side verification + the `visibleReps` probe-integrity
 *     gate). The learner builds the target in any/all of them.
 *
 * The unified "Check my work" button (AC#4) computes a CLIENT-SIDE cross-rep
 * verdict via `playgroundEquivalence` (correctness off the network — the locked
 * invariant) and fires `onPlaygroundSubmit` so the server can persist a record.
 * "Request a hint" (AC#5) asks the agent for scaffold-only help. "Finish" (AC#6)
 * exits to the session-end celebration.
 *
 * Honors `spec.visibleReps`: a rep not listed is never rendered (its rep component
 * also self-gates), so the canvas can never expose a held-out rep.
 */
export function PlaygroundCanvas({
  spec,
  onPlaygroundSubmit,
  onRequestScaffold,
  onExitPlayground,
  scaffold,
}: PlaygroundCanvasProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  // The latest learner submission per rep (captured from each rep's own onSubmit).
  const [reps, setReps] = useState<{
    truth_table?: { repSubmission: RepSubmission; expression: string; correct: boolean };
    circuit?: { repSubmission: RepSubmission; expression: string };
    pseudocode?: { repSubmission: RepSubmission; expression: string };
  }>({});
  const [verdict, setVerdict] = useState<PlaygroundEquivalenceResult | null>(null);

  // Hooks must run unconditionally (before any early return). `claimed`/`vars`
  // are only consumed in phase 2 but are cheap and safe to derive from a null
  // target (empty fallback) in phase 1.
  const claimed = useMemo<(0 | 1)[]>(() => {
    if (target === null) return [];
    try {
      return claimedTableFor(target);
    } catch {
      return [];
    }
  }, [target]);

  const visible = (rep: Rep): boolean => spec.visibleReps.includes(rep);

  function handleSetTarget(): void {
    setTargetError(null);
    const expr = draft.trim();
    if (!expr) {
      setTargetError('Enter a target expression first.');
      return;
    }
    try {
      // Parse + cap-aware: a wildly large table is refused before any enumeration.
      const vars = variables(parse(expr));
      if (vars.length > 8) {
        setTargetError('That target has too many variables for the playground (max 8).');
        return;
      }
    } catch (e) {
      setTargetError(e instanceof BooleanParseError ? e.message : 'Could not parse that expression.');
      return;
    }
    setTarget(expr);
    setReps({});
    setVerdict(null);
  }

  function handleCheck(): void {
    if (target === null) return;
    // Build the per-rep expression map for the client-side equivalence verdict.
    // truth_table authors no new expression (the learner fills the target's table);
    // its "equivalent" signal is its own correctness flag, modelled here by feeding
    // the target itself when the table was filled correctly and a guaranteed-wrong
    // sentinel otherwise — so playgroundEquivalence is the single verdict authority.
    const exprByKey: Record<string, string> = {};
    const submissions: PlaygroundSubmitPayload['submissions'] = {};
    if (reps.truth_table) {
      exprByKey.truth_table = reps.truth_table.correct ? target : '__playground_tt_mismatch__';
      submissions.truth_table = reps.truth_table.repSubmission;
    }
    if (reps.circuit) {
      exprByKey.circuit = reps.circuit.expression;
      submissions.circuit = reps.circuit.repSubmission;
    }
    if (reps.pseudocode) {
      exprByKey.pseudocode = reps.pseudocode.expression;
      submissions.pseudocode = reps.pseudocode.repSubmission;
    }
    const result = playgroundEquivalence(target, exprByKey);
    setVerdict(result);
    onPlaygroundSubmit?.({ targetExpression: target, submissions, verdict: result });
  }

  // ----- phase 1: proposing -----
  if (target === null) {
    return (
      <section className="playground-canvas" aria-labelledby="playground-title">
        <h1 id="playground-title">Playground</h1>
        <p>
          Propose a Boolean function, then build it across the truth table, a gate
          circuit, and pseudocode. The tutor verifies and helps when you ask — it
          will not solve it for you.
        </p>
        <label htmlFor="playground-target">Target expression</label>
        <input
          id="playground-target"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. A AND (B OR C)"
        />
        <button type="button" onClick={handleSetTarget}>
          Set target
        </button>
        {targetError !== null && (
          <p role="alert" style={{ color: '#dc2626' }}>
            {targetError}
          </p>
        )}
      </section>
    );
  }

  // ----- phase 2: building -----
  return (
    <section className="playground-canvas" aria-labelledby="playground-title">
      <h1 id="playground-title">Playground</h1>
      <p>
        Build your target across all three representations, then check your work.
        Target: <code>{target}</code>
      </p>

      {visible('truth_table') && (
        <TruthTable
          spec={{
            kind: 'TruthTablePractice',
            expression: target,
            claimedTruthTable: claimed,
            visibleReps: spec.visibleReps,
          }}
          onSubmit={(e) =>
            setReps((r) => ({
              ...r,
              truth_table: {
                repSubmission: { rep: 'truth_table', cells: e.repSubmission.cells as (0 | 1)[] },
                expression: e.submission,
                correct: e.correct,
              },
            }))
          }
        />
      )}

      {visible('circuit') && (
        <CircuitBuilder
          spec={{
            kind: 'CircuitBuilder',
            targetExpression: target,
            claimedTruthTable: claimed,
            allowedGates: ALL_GATES,
            visibleReps: spec.visibleReps,
          }}
          onSubmit={(p) =>
            setReps((r) => ({
              ...r,
              circuit: {
                repSubmission: p.repSubmission,
                expression:
                  p.repSubmission.rep === 'circuit' ? p.repSubmission.expression : p.submission,
              },
            }))
          }
        />
      )}

      {visible('pseudocode') && (
        <PseudocodeChallenge
          spec={{
            kind: 'PseudocodeChallenge',
            targetExpression: target,
            claimedTruthTable: claimed,
            visibleReps: spec.visibleReps,
          }}
          onSubmit={(p) =>
            setReps((r) => ({
              ...r,
              pseudocode: { repSubmission: p.repSubmission, expression: p.repSubmission.expression },
            }))
          }
        />
      )}

      <div className="playground-actions" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <button type="button" onClick={handleCheck}>
          Check my work
        </button>
        <button
          type="button"
          onClick={() =>
            onRequestScaffold?.({ targetExpression: target })
          }
        >
          Request a hint
        </button>
        <button type="button" onClick={() => onExitPlayground?.()}>
          Finish
        </button>
      </div>

      {verdict !== null && (
        <p role="status" aria-label="playground verdict" style={{ marginTop: '8px' }}>
          {verdict.allEquivalent
            ? 'All your representations match the target. Nicely done!'
            : 'At least one representation is not equivalent to the target yet — keep building.'}
          <span aria-hidden="true"> </span>
          {Object.entries(verdict.byKey).map(([rep, ok]) => (
            <span key={rep} data-rep={rep} data-verdict={ok ? 'match' : 'mismatch'} style={{ marginLeft: 8 }}>
              {rep}: {ok ? 'match' : 'mismatch'}
            </span>
          ))}
        </p>
      )}

      {/* AC#5: the agent's scaffold-on-request, shown in a side slot (announced via
          role="status") so the learner's in-progress build is never replaced. The
          scaffold nudges across reps; it never reveals the answer (the verdict is the
          client-side equivalence check above). */}
      {scaffold && (
        <aside
          className="playground-scaffold"
          role="status"
          aria-label="tutor hint"
          style={{ marginTop: '12px' }}
        >
          {scaffold}
        </aside>
      )}
    </section>
  );
}
