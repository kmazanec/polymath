/**
 * F-27: Coherent learning surface — web-local state model (ADR-015).
 *
 * The `Turn` discriminated union is the append-only transcript ledger.  It
 * NEVER crosses the wire — these types exist only in the browser.
 *
 * Design decisions (from the F-27 build plan):
 *  - The active item stays a SEPARATE pinned `mounted` slot; it is NOT the
 *    newest transcript turn.  ADR-015 Option A (active = newest turn) was
 *    explicitly rejected so the workspace never scrolls away.
 *  - A `completedItem` turn is appended when the active item is superseded by
 *    a new active item, providing the "what I just solved" record in the log.
 *  - `spokenTurn` exists NOW (F-30 produces it; F-27 only defines the slot so
 *    F-30 can append one without a structural change).
 *  - `verdict` is client-derived (the existing <5ms booleans check) and is
 *    `aria-live` so screen readers announce it before the next mount.
 */

import type { ComponentSpec } from '@polymath/contract';

/** An intro card — LessonIntro or IntroExplanation — shown in the transcript. */
export interface IntroTurn {
  kind: 'intro';
  spec: ComponentSpec & ({ kind: 'LessonIntro' } | { kind: 'IntroExplanation' });
}

/** A worked-example shown in the transcript. */
export interface WorkedExampleTurn {
  kind: 'workedExample';
  spec: ComponentSpec & { kind: 'WorkedExample' };
}

/** A hint served during practice (after the item moved to the side slot). */
export interface HintTurn {
  kind: 'hint';
  spec: ComponentSpec & { kind: 'HintCard' };
}

/** An agent answer to a learner question. */
export interface AnswerTurn {
  kind: 'answer';
  spec: ComponentSpec & { kind: 'AgentAnswer' };
}

/** A cross-lesson recall card that was shown and dismissed. */
export interface RecallTurn {
  kind: 'recall';
  spec: ComponentSpec & { kind: 'CrossLessonRecall' };
}

/**
 * An explicit ✓/✗ verdict, appended from the existing <5ms client correctness
 * compute when the learner submits.  Rendered with `aria-live` so assistive
 * tech announces it before the next mount.
 */
export interface VerdictTurn {
  kind: 'verdict';
  correct: boolean;
  expression: string; // the expression the learner answered (for context)
}

/**
 * A completed item — appended when the active item is superseded by a new
 * active item.  Carries the full spec so the transcript can render a read-only
 * view of what was solved.
 */
export interface CompletedItemTurn {
  kind: 'completedItem';
  spec: ComponentSpec;
}

/**
 * A spoken turn (F-30 produces this; F-27 only defines the slot).
 * F-30 will append it; F-27 renders it as a learner/agent bubble.
 */
export interface SpokenTurn {
  kind: 'spokenTurn';
  speaker: 'learner' | 'agent';
  text: string;
}

/** The full discriminated union — append-only to the transcript. */
export type Turn =
  | IntroTurn
  | WorkedExampleTurn
  | HintTurn
  | AnswerTurn
  | RecallTurn
  | VerdictTurn
  | CompletedItemTurn
  | SpokenTurn;

/**
 * The full learning surface state: the pinned workspace (`mounted`) and the
 * append-only transcript.
 *
 * `mounted` is the only item the learner can currently interact with.
 * `transcript` is read-only history (never overwritten, only appended to).
 */
export interface SurfaceState {
  /** The current active item — pinned in the anchored workspace. */
  mounted: ComponentSpec;
  /** Ordered, append-only log of everything that has happened. */
  transcript: Turn[];
}

/**
 * Item-bearing `ComponentSpec` kinds — the ones that carry a grounding prompt
 * (AC#7).  A spec of one of these kinds with no `prompt` field is treated as
 * an error at the surface boundary.
 */
export const ITEM_BEARING_KINDS = new Set([
  'TruthTablePractice',
  'CircuitBuilder',
  'PseudocodeChallenge',
  'TransferProbe',
] as const);

/** Returns true iff this spec is an item-bearing challenge (needs a prompt). */
export function isItemBearing(spec: ComponentSpec): spec is
  | (ComponentSpec & { kind: 'TruthTablePractice' })
  | (ComponentSpec & { kind: 'CircuitBuilder' })
  | (ComponentSpec & { kind: 'PseudocodeChallenge' })
  | (ComponentSpec & { kind: 'TransferProbe' }) {
  return ITEM_BEARING_KINDS.has(spec.kind as 'TruthTablePractice' | 'CircuitBuilder' | 'PseudocodeChallenge' | 'TransferProbe');
}

/**
 * Determines whether a new incoming spec should RE-ANCHOR the workspace
 * (become the new `mounted` item) or should APPEND to the transcript as a
 * side turn.
 *
 * Re-anchors:
 *  - Item-bearing practice/probe specs → new active item
 *  - WorkedExample → re-anchor (it's the focus while the learner studies it)
 *  - LessonIntro / IntroExplanation → re-anchor (the learner reads/advances it)
 *  - MasteryCelebration / ExplainBackPrompt / ConfidenceCheck → re-anchor
 *    (these own the workspace while they're active)
 *  - PlaygroundCanvas → re-anchor (the capstone)
 *
 * Appends (side turns — do NOT replace the workspace):
 *  - HintCard → `hint` turn in the transcript, mounted item stays
 *  - AgentAnswer → `answer` turn in the transcript
 *  - CrossLessonRecall → `recall` turn in the transcript
 *
 * This is the single policy location for the append-vs-re-anchor decision.
 */
export function shouldReanchor(spec: ComponentSpec): boolean {
  switch (spec.kind) {
    case 'HintCard':
    case 'AgentAnswer':
    case 'CrossLessonRecall':
      return false;
    default:
      return true;
  }
}

/**
 * Convert a re-anchoring spec into the transcript `Turn` it becomes when
 * it's superseded by a NEW workspace item.  Returns null for specs that
 * don't need a completedItem record in the transcript (e.g. intros —
 * they become IntroTurn / WorkedExampleTurn when first appended, not
 * completedItem).
 */
export function toCompletedTurn(spec: ComponentSpec): CompletedItemTurn | null {
  switch (spec.kind) {
    case 'TruthTablePractice':
    case 'CircuitBuilder':
    case 'PseudocodeChallenge':
    case 'TransferProbe':
      return { kind: 'completedItem', spec };
    default:
      // Intros/explanations/celebrations don't get a completedItem echo —
      // they leave the transcript via the intro turn appended when first shown.
      return null;
  }
}

/**
 * Convert a re-anchoring spec into the initial transcript turn appended
 * when it first mounts (before it becomes the workspace).  Not all specs
 * need a transcript echo on mount — only intro/worked/explanation cards.
 */
export function toInitialTurn(spec: ComponentSpec): Turn | null {
  switch (spec.kind) {
    case 'LessonIntro':
    case 'IntroExplanation':
      return { kind: 'intro', spec: spec as IntroTurn['spec'] };
    case 'WorkedExample':
      return { kind: 'workedExample', spec: spec as WorkedExampleTurn['spec'] };
    default:
      return null;
  }
}

/**
 * Apply a server-delivered `ComponentSpec` mount to the surface state.
 *
 * - Side turns (HintCard, AgentAnswer, CrossLessonRecall) append to the
 *   transcript without touching `mounted`.
 * - Re-anchoring specs: append a `completedItem` for the prior mounted item
 *   (if it's an item-bearing spec), then update `mounted`.
 */
export function applyMount(state: SurfaceState, spec: ComponentSpec): SurfaceState {
  if (!shouldReanchor(spec)) {
    // Side turn: append to transcript; workspace unchanged.
    let turn: Turn | null = null;
    if (spec.kind === 'HintCard') turn = { kind: 'hint', spec: spec as HintTurn['spec'] };
    else if (spec.kind === 'AgentAnswer') turn = { kind: 'answer', spec: spec as AnswerTurn['spec'] };
    else if (spec.kind === 'CrossLessonRecall') turn = { kind: 'recall', spec: spec as RecallTurn['spec'] };
    return turn
      ? { ...state, transcript: [...state.transcript, turn] }
      : state;
  }

  // Re-anchor: add completedItem for the prior workspace, then set new mounted.
  const newTranscript = [...state.transcript];

  // Append the prior mounted item as completedItem (if it was an item-bearing spec).
  const completed = toCompletedTurn(state.mounted);
  if (completed) newTranscript.push(completed);

  // Append an intro/worked-example turn when the new item is one of those.
  const initial = toInitialTurn(spec);
  if (initial) newTranscript.push(initial);

  return { mounted: spec, transcript: newTranscript };
}

/**
 * Append an explicit verdict turn (correct/incorrect) to the transcript.
 * Called on submit, BEFORE the next mount arrives.
 */
export function appendVerdict(state: SurfaceState, correct: boolean, expression: string): SurfaceState {
  return {
    ...state,
    transcript: [...state.transcript, { kind: 'verdict', correct, expression }],
  };
}

/**
 * Append a spoken turn (F-30 seam).  F-27 defines the slot; F-30 calls this.
 */
export function appendSpokenTurn(
  state: SurfaceState,
  speaker: SpokenTurn['speaker'],
  text: string,
): SurfaceState {
  return {
    ...state,
    transcript: [...state.transcript, { kind: 'spokenTurn', speaker, text }],
  };
}
