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
 *
 * `solved` records whether the learner's LAST verdict on this item was correct.
 * A wrong-then-superseded item (e.g. a wrong truth-table answer that the tutor
 * remediates with a fresh retry) must NOT be labelled "Completed ✓" — that is
 * BUG-03.  It is derived at append time from the most recent matching verdict
 * turn; `undefined` when no verdict was recorded for the item (treated as
 * neutral, not a success claim).
 */
export interface CompletedItemTurn {
  kind: 'completedItem';
  spec: ComponentSpec;
  solved?: boolean;
}

/**
 * A spoken turn committed to the durable transcript.
 *
 * F-30 produces final turns via `appendSpokenTurn`; the streaming layer (ADR-018)
 * holds in-progress (interim) chunks in a SEPARATE ephemeral React state so the
 * append-only transcript is never mutated mid-stream. `partial` is carried here
 * only as a DISPLAY hint on committed turns (always absent / false on a durable
 * record — the field is optional so existing turns remain unchanged).
 */
export interface SpokenTurn {
  kind: 'spokenTurn';
  speaker: 'learner' | 'agent';
  text: string;
  /** Set only on transient in-progress turns rendered outside the transcript array.
   *  Durable committed turns never carry this field. Optional + append-only. */
  partial?: boolean;
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
  /** Increments on every re-anchoring server mount, even when the spec repeats. */
  mountSeq: number;
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
export function toCompletedTurn(spec: ComponentSpec): Turn | null {
  switch (spec.kind) {
    case 'TruthTablePractice':
    case 'CircuitBuilder':
    case 'PseudocodeChallenge':
    case 'TransferProbe':
      return { kind: 'completedItem', spec };
    case 'IntroExplanation':
      return { kind: 'intro', spec: spec as IntroTurn['spec'] };
    case 'WorkedExample':
      return { kind: 'workedExample', spec: spec as WorkedExampleTurn['spec'] };
    default:
      // Lesson intros/celebrations don't get a completedItem echo.
      return null;
  }
}

/**
 * A stable identity string for a `ComponentSpec`, used to detect when a
 * re-anchor would push a transcript turn byte-identical to one already there.
 *
 * It captures the *meaningful* identity of a card — its kind plus the fields a
 * learner would recognise as "the same card" (the worked example's
 * expression + steps, an intro's topic + body, an item's target expression /
 * prompt) — NOT a blanket "same kind". Two genuinely different worked examples
 * (different expression or steps) produce different identities and both appear.
 */
function specIdentity(spec: ComponentSpec): string {
  switch (spec.kind) {
    case 'WorkedExample':
      return `WorkedExample:${spec.expression}:${JSON.stringify(spec.steps)}`;
    case 'IntroExplanation':
      return `IntroExplanation:${spec.topic}:${spec.body}`;
    case 'LessonIntro':
      return `LessonIntro:${spec.title}:${spec.body}`;
    case 'TruthTablePractice':
      return `TruthTablePractice:${spec.expression}:${spec.prompt ?? ''}`;
    case 'CircuitBuilder':
      return `CircuitBuilder:${spec.targetExpression}:${spec.prompt ?? ''}`;
    case 'PseudocodeChallenge':
      return `PseudocodeChallenge:${spec.targetExpression}:${spec.prompt ?? ''}`;
    case 'TransferProbe':
      return `TransferProbe:${spec.itemId}`;
    default:
      return spec.kind;
  }
}

/**
 * The expression an item-bearing spec answers — what the matching `verdict`
 * turn records in its `expression` field.  Used to pair a completed item with
 * the learner's last verdict on it (BUG-03).  Null for non-item specs.
 */
function specExpression(spec: ComponentSpec): string | null {
  if ('expression' in spec && typeof (spec as { expression?: unknown }).expression === 'string') {
    return (spec as { expression: string }).expression;
  }
  if (
    'targetExpression' in spec &&
    typeof (spec as { targetExpression?: unknown }).targetExpression === 'string'
  ) {
    return (spec as { targetExpression: string }).targetExpression;
  }
  return null;
}

/**
 * The learner's most recent verdict for `expression`, scanning the transcript
 * newest-first.  `undefined` when no verdict was recorded for it — a completed
 * item with no verdict is rendered neutrally, never as a success.
 */
function lastVerdictFor(transcript: Turn[], expression: string | null): boolean | undefined {
  if (expression === null) return undefined;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const t = transcript[i];
    if (t !== undefined && t.kind === 'verdict' && t.expression === expression) return t.correct;
  }
  return undefined;
}

/** The spec a transcript turn carries (for identity comparison), or null for
 *  turns that don't echo a spec (verdict, spokenTurn). */
function turnSpec(turn: Turn): ComponentSpec | null {
  switch (turn.kind) {
    case 'intro':
    case 'workedExample':
    case 'hint':
    case 'answer':
    case 'recall':
    case 'completedItem':
      return turn.spec;
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

  // Append the prior mounted item as a transcript turn (if it warrants one).
  const completed = toCompletedTurn(state.mounted);
  if (completed) {
    // DEDUPE (B4/B6 — the duplicate-worked-example / double-Completed class of bug):
    // the server can re-emit the SAME spec across a phase transition (e.g. the
    // WorkedExample is sent twice across introducing→practicing) and a retry
    // re-mounts the SAME item — each re-anchor would otherwise push another
    // identical turn, stacking byte-identical cards ("Walk-through (A & B)" twice)
    // or two "Completed: B AND A" entries for one item. Skip the push when the
    // prior mounted is identical (by meaningful identity) to EITHER the incoming
    // spec OR the last spec-bearing turn already in the transcript. Genuinely
    // distinct repeats (a different worked example / item) have different
    // identities and are still logged.
    const priorIdentity = specIdentity(state.mounted);
    const lastTurnSpec = [...newTranscript].reverse().map(turnSpec).find((s) => s !== null);
    const duplicatesIncoming = priorIdentity === specIdentity(spec);
    const duplicatesLastTurn = lastTurnSpec !== undefined && lastTurnSpec !== null
      ? priorIdentity === specIdentity(lastTurnSpec)
      : false;
    if (!duplicatesIncoming && !duplicatesLastTurn) {
      // BUG-03: tag the completed turn with the learner's last verdict on this
      // item so the renderer doesn't label a wrong-then-remediated item as
      // "Completed ✓".  Verdict turns precede the re-anchor that completes the
      // item, so the matching one is already in `newTranscript`.
      if (completed.kind === 'completedItem') {
        completed.solved = lastVerdictFor(newTranscript, specExpression(completed.spec));
      }
      newTranscript.push(completed);
    }
  }

  return { mounted: spec, mountSeq: state.mountSeq + 1, transcript: newTranscript };
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
