import type { Action, ComponentSpec, PhaseName } from '@polymath/contract';
import type { LessonEvent } from '@polymath/statechart';

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
  /** A statechart event to `send`, if this Action drives a phase transition. */
  lessonEvent?: LessonEvent;
  /** A new component to mount, if this Action mounts one. */
  mount?: ComponentSpec;
  /** An answer to surface to the learner, if this Action is a Q&A response. */
  answer?: { question: string; answer: string; topicClassification: 'on_topic' | 'off_topic' };
}

/** ComponentSpec kinds that put the learner into the `practicing` phase. */
const PRACTICE_KINDS = new Set<ComponentSpec['kind']>([
  'TruthTablePractice',
  'CircuitBuilder',
  'PseudocodeChallenge',
  'WorkedExample',
]);

/** Map a contract `PhaseName` transition target to the `LessonEvent` that reaches
 *  it from the current spine. Only the transitions the agent can drive in F-05. */
function transitionEvent(to: PhaseName): LessonEvent | undefined {
  switch (to) {
    case 'mastered':
      return { type: 'mastery_ok' };
    case 'transferring':
      return { type: 'enter_transfer' };
    case 'remediating':
      return { type: 'remediate' };
    case 'practicing':
      return { type: 'resume_practice' };
    default:
      return undefined;
  }
}

export function adaptAction(action: Action): AdapterResult {
  switch (action.type) {
    case 'mount': {
      const result: AdapterResult = { mount: action.component };
      if (PRACTICE_KINDS.has(action.component.kind)) {
        result.lessonEvent = { type: 'start_practice' };
      }
      return result;
    }
    case 'transition': {
      const lessonEvent = transitionEvent(action.to);
      return lessonEvent ? { lessonEvent } : {};
    }
    case 'answer_question':
      return {
        answer: {
          question: action.question,
          answer: action.answer,
          topicClassification: action.topicClassification,
        },
      };
    case 'no_action':
      return {};
  }
}
