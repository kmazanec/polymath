import type { Action, ComponentSpec, PhaseName, Rep } from '@polymath/contract';
import { type LessonEvent, isHiddenRepMountRefused } from '@polymath/statechart';

/**
 * Bridge the server's wire `Action` into the web's two consumers: the lesson
 * statechart (which owns *when* the phase changes) and the rendered workspace
 * (which owns *what* is shown). F-01 discarded server Actions; F-05 wires them in.
 *
 * - `mount`           → set the mounted `ComponentSpec` (the agent picked the next
 *                       thing to show). Item mounts also move the learner into
 *                       `practicing` if they were still on the intro.
 * - `transition`      → the statechart `LessonEvent` that drives the phase change.
 * - `answer_question` → no statechart/mount change; the caller surfaces the answer.
 * - `no_action`       → nothing.
 *
 * Pure + DOM-free so it is unit-testable in node (the canvas split pattern).
 */

export interface AdapterResult {
  /** Statechart events to `send` in order, if this Action drives a phase change.
   *  A list because some transitions need an intermediate step (e.g. from
   *  `transferring`, reaching `mastered`/`remediating` goes via `assess` →
   *  `assessed` first; the spine has no direct edge). */
  lessonEvents?: LessonEvent[];
  /** A new component to mount, if this Action mounts one. */
  mount?: ComponentSpec;
  /** An answer to surface to the learner, if this Action is a Q&A response. */
  answer?: {
    question: string;
    answer: string;
    topicClassification: 'on_topic' | 'off_topic';
    /** F-30 (D9): true when the question arrived as a server-captured spoken turn.
     *  The surface renders a spoken-turn bubble for the learner side when set.
     *  Absent or false → typed bubble (fail-safe default). */
    spoken?: boolean;
  };
  /** True when a mount was refused by the transfer-probe hidden-rep guard
   *  (ADR-005 refusal #2). The caller drops the mount and may surface the refusal. */
  refused?: boolean;
}

/** The runtime context the adapter needs to enforce the transfer-probe refusal:
 *  the current phase and the active probe's held-out reps. */
export interface AdapterContext {
  phase: string;
  hiddenReps: readonly Rep[];
}

/** ComponentSpec kinds that put the learner into the `practicing` phase. */
const PRACTICE_KINDS = new Set<ComponentSpec['kind']>([
  'TruthTablePractice',
  'CircuitBuilder',
  'PseudocodeChallenge',
  'WorkedExample',
]);

/** Which representation a mounted component would reveal (undefined for non-rep
 *  components like AgentAnswer / HintCard / MasteryCelebration). */
function repOf(spec: ComponentSpec): Rep | undefined {
  switch (spec.kind) {
    case 'TruthTablePractice':
      return 'truth_table';
    case 'CircuitBuilder':
      return 'circuit';
    case 'PseudocodeChallenge':
      return 'pseudocode';
    default:
      return undefined;
  }
}

/** Map a contract `PhaseName` transition target to the `LessonEvent` sequence that
 *  reaches it from the current phase. The spine accepts `mastery_ok`/`remediate`
 *  only from `assessed`, so a transition out of `transferring` (after a probe) is
 *  expanded to `assess` (→ assessed) then the terminal event. */
function transitionEvents(to: PhaseName, fromPhase: string | undefined): LessonEvent[] {
  const viaAssessed = fromPhase === 'transferring';
  switch (to) {
    case 'mastered':
      return viaAssessed ? [{ type: 'assess' }, { type: 'mastery_ok' }] : [{ type: 'mastery_ok' }];
    case 'transferring':
      return [{ type: 'enter_transfer' }];
    case 'remediating':
      return viaAssessed ? [{ type: 'assess' }, { type: 'remediate' }] : [{ type: 'remediate' }];
    case 'practicing':
      return [{ type: 'resume_practice' }];
    default:
      return [];
  }
}

export function adaptAction(action: Action, ctx?: AdapterContext): AdapterResult {
  switch (action.type) {
    case 'mount': {
      // ADR-005 refusal #2: during a transfer probe, a mount that would reveal a
      // held-out rep is refused — the agent cannot bring back a hidden scaffold.
      if (ctx && isHiddenRepMountRefused(ctx.phase, repOf(action.component), ctx.hiddenReps)) {
        return { refused: true };
      }
      const result: AdapterResult = { mount: action.component };
      // A TransferProbe mount drives the spine into `transferring` — this is what
      // makes the hidden-rep refusal + pulse suppression active (they gate on the
      // phase). Without it the probe would render but the refusals stay inert.
      if (action.component.kind === 'TransferProbe') {
        // The agent only mounts a probe when the server-side rule gate passed, so
        // the probe arrival is the signal to open the statechart's transfer guard
        // (set_transfer_ready) before entering the transferring phase.
        result.lessonEvents = [{ type: 'set_transfer_ready', ready: true }, { type: 'enter_transfer' }];
      } else if (PRACTICE_KINDS.has(action.component.kind)) {
        // A practice item arriving *during* a transfer probe is the agent
        // remediating a failed transfer: walk the spine transferring → assessed →
        // remediating → practicing so the simpler item lands in `practicing`.
        result.lessonEvents =
          ctx?.phase === 'transferring'
            ? [{ type: 'assess' }, { type: 'remediate' }, { type: 'resume_practice' }]
            : [{ type: 'start_practice' }];
      }
      return result;
    }
    case 'transition': {
      const lessonEvents = transitionEvents(action.to, ctx?.phase);
      return lessonEvents.length ? { lessonEvents } : {};
    }
    case 'answer_question':
      return {
        answer: {
          question: action.question,
          answer: action.answer,
          topicClassification: action.topicClassification,
          // F-30 (D9): forward the spoken flag so App.tsx can append a spoken-turn
          // bubble for the learner's side. Absent → typed (fail-safe default).
          ...(action.spoken ? { spoken: true } : {}),
        },
      };
    case 'no_action':
      return {};
  }
}
