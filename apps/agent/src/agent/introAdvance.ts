/**
 * F-27 (I7/D1, menu-lockstep): shared `intro_advance` handler for BOTH the
 * heuristic (`HeuristicMoveProvider`) and the OpenAI (`OpenAIMoveProvider`)
 * providers.
 *
 * When the learner clicks "Got it — continue" on an intro or worked-example
 * card, the web client sends `intro_advance` (NOT a `session_start` re-emit —
 * that's the old, flaky mechanism).  Both providers must branch on it and call
 * `openingMove(input)` to deterministically advance the opening sequence by one
 * stage.  This module is the single implementation of that branch.
 *
 * Invariants:
 *  - Pure / deterministic: stage derived from `recentHistory` mount count.
 *  - If practice has already started (any submit/hint/transfer in history):
 *    returns `no_action` — an intro_advance cannot restart the session.
 *  - If the intro content is absent from the lesson JSON: falls back to the
 *    first practice item (graceful degrade, identical to the original session_start
 *    fallback).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentInput } from './client.js';
import type { TacticalMove } from './menu.js';
import type { Rep } from '@polymath/contract';

/** The shape of the `intro` block in `lessons/<id>/content.json`. */
interface LessonIntroBlock {
  lessonIntro?: { title: string; body: string };
  explanations?: Array<{
    topic: string;
    body: string;
    visibleReps: string[];
    illustration?: { expression: string; variables: string[]; truthTable: number[] };
  }>;
  /**
   * The topics (in order) to teach in the OPENING walk — before the worked example
   * and the first practice item. The remaining `explanations` are taught
   * just-in-time before their own KC's first item (`explanationBeforeNextItem`).
   *
   * This is what lets a lesson teach a concept and then immediately practice IT,
   * instead of front-loading every operator's card. Lesson 1: opening walk is
   * [AND, then the truth-table card]; the worked example writes AND AS a table;
   * the learner fills AND's table; THEN OR is taught right before the OR item, and
   * NOT right before the NOT item — teaching always immediately precedes use.
   *
   * Absent → the opening walk falls back to ALL `explanations` in order (the
   * pre-existing behaviour; lessons 2–4 are unaffected).
   */
  openingExplanations?: string[];
  workedExample?: {
    expression: string;
    steps: Array<{ label: string; detail: string }>;
    visibleReps: string[];
    illustration?: { expression: string; variables: string[]; truthTable: number[] };
  };
}

/** Repo-root `lessons/` directory. */
const lessonsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../lessons',
);

/**
 * Read the raw `lessons/<lessonId>/content.json` intro block, bypassing Zod's
 * unknown-key strip.  Returns null on any failure — missing file, bad JSON,
 * absent/malformed `intro` — so the caller degrades gracefully.
 */
export function readLessonIntro(lessonId: number): LessonIntroBlock | null {
  try {
    const file = path.join(lessonsRoot, String(lessonId), 'content.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const intro = raw['intro'];
    if (!intro || typeof intro !== 'object' || Array.isArray(intro)) return null;
    return intro as LessonIntroBlock;
  } catch {
    return null;
  }
}

/**
 * Coerce a raw `string[]` from the JSON into a typed `Rep[]`.
 */
export function toRepArray(raw: string[] | undefined, fallback: Rep[] = ['truth_table']): Rep[] {
  const VALID_REPS: ReadonlySet<string> = new Set(['truth_table', 'circuit', 'pseudocode']);
  const filtered = (raw ?? []).filter((r): r is Rep => VALID_REPS.has(r));
  return filtered.length > 0 ? filtered : fallback;
}

/**
 * Generate a default grounding prompt for an item (F-27 AC#7 backfill).
 * Used when no authored prompt is available (the heuristic path).
 * F-29's generation always supplies a richer prompt; this is the keyless fallback.
 */
export function defaultItemPrompt(targetExpression: string, rep: string): string {
  const display = formatLogicExpression(targetExpression);
  switch (rep) {
    case 'circuit':
      return `Build a circuit that computes ${display}.`;
    case 'pseudocode':
      return `Write pseudocode that computes ${display}.`;
    default:
      return `Complete the truth table for ${display}.`;
  }
}

/** Display Boolean expressions with the code-like operators learners should learn. */
export function formatLogicExpression(expression: string): string {
  return expression
    .replace(/\bNOT\s+(?=\()/g, '!')
    .replace(/\bNOT\s+([A-Z])\b/g, '!$1')
    .replace(/\bAND\b/g, '&')
    .replace(/\bOR\b/g, '||');
}

/**
 * Coerce a raw illustration block from the JSON into the typed move shape.
 * Drops it (returns undefined) if the table has any value other than 0/1 — an
 * illustration is decorative, so a malformed one degrades to a text-only card
 * rather than crashing the intro.
 */
export function toIllustration(
  raw: { expression: string; variables: string[]; truthTable: number[] } | undefined,
): { expression: string; variables: string[]; truthTable: (0 | 1)[] } | undefined {
  if (!raw) return undefined;
  if (!raw.truthTable.every((v) => v === 0 || v === 1)) return undefined;
  return {
    expression: raw.expression,
    variables: raw.variables,
    truthTable: raw.truthTable as (0 | 1)[],
  };
}

function explanationForTopic(input: AgentInput, topic: string, rationale: string): TacticalMove | null {
  const explanation = readLessonIntro(input.lesson.content.lessonId)?.explanations?.find(
    (candidate) => candidate.topic === topic,
  );
  if (!explanation) return null;
  const illustration = toIllustration(explanation.illustration);
  return {
    move: 'intro_explanation',
    topic: explanation.topic,
    body: explanation.body,
    visibleReps: toRepArray(explanation.visibleReps),
    ...(illustration ? { illustration } : {}),
    rationale,
  };
}

function itemMoveFor(
  input: AgentInput,
  item: AgentInput['lesson']['content']['items'][number],
  rationale: string,
): TacticalMove {
  return {
    move: 'next_practice_item',
    tier: item.difficultyTier,
    rationale,
    item: {
      rep: 'truth_table',
      targetExpression: item.targetExpression,
      claimedTruthTable: item.truthTable,
      visibleReps: ['truth_table'],
      prompt: defaultItemPrompt(item.targetExpression, 'truth_table'),
    },
  };
}

/** Continue after a mid-lesson explanation by mounting the first item for that KC. */
export function practiceAfterLatestExplanation(input: AgentInput): TacticalMove | null {
  const latestExplanation = [...input.recentHistory]
    .reverse()
    .find((turn) => turn.actionType === 'mount' && turn.componentKind === 'IntroExplanation');
  const topic = latestExplanation?.topic;
  if (!topic) return null;
  const item = input.lesson.content.items.find((candidate) => candidate.kc === topic);
  return item
    ? itemMoveFor(input, item, `finished explanation for "${topic}" — starting aligned practice`)
    : null;
}

/**
 * If the next item introduces a new KC with an authored explanation, teach that
 * concept before mounting its first challenge.
 */
export function explanationBeforeNextItem(input: AgentInput): TacticalMove | null {
  const ev = input.event;
  if (ev.kind !== 'submit') return null;
  if (input.currentSubmitCorrect === false) return null;

  const items = input.lesson.content.items;
  const idx = items.findIndex((i) => i.itemId === ev.itemId || i.targetExpression === ev.itemId);
  if (idx < 0) return null;
  const current = items[idx];
  const next = items[idx + 1]; // no wrap — the last item has no "next" to teach toward
  if (!current || !next || next.kc === current.kc) return null;
  const firstItemForNextKc = items.findIndex((candidate) => candidate.kc === next.kc);
  if (firstItemForNextKc !== idx + 1) return null;

  return explanationForTopic(
    input,
    next.kc,
    `teaching KC "${next.kc}" before first aligned practice item "${next.itemId}"`,
  );
}

/**
 * The deterministic opening move.  Shared between `session_start` and
 * `intro_advance`.  Stage is derived from prior mount count in `recentHistory`,
 * and the intro now walks EVERY authored explanation IN ORDER before the worked
 * example, so the lesson teaches each operator (and then the truth-table grid)
 * before any practice — never showing a representation it hasn't taught.
 *
 * With E authored explanation cards [e0, e1, …, e(E-1)]:
 *   Stage 0           → IntroExplanation e0      (e.g. AND)
 *   Stage 1           → IntroExplanation e1      (e.g. OR)
 *   …
 *   Stage E-1         → IntroExplanation e(E-1)  (e.g. the truth-table card)
 *   Stage E           → WorkedExample
 *   Stage E+1 onward  → first practice item
 *
 * `priorMounts` is the number of mount turns already shown in this opening
 * sequence, so it IS the index of the next card to teach. (Backwards-compatible:
 * a lesson with a single explanation behaves exactly as the old stage 0/1/2.)
 */
export function openingMove(input: AgentInput): TacticalMove {
  const priorMounts = input.recentHistory.filter((t) => t.actionType === 'mount').length;
  const intro = readLessonIntro(input.lesson.content.lessonId);

  if (intro) {
    const allExplanations = intro.explanations ?? [];
    // The opening walk teaches ONLY the `openingExplanations` topics (in order) —
    // the rest are taught just-in-time before their KC's first item. Absent →
    // walk all explanations (pre-existing behaviour, lessons 2–4 unchanged).
    const explanations =
      intro.openingExplanations && intro.openingExplanations.length > 0
        ? intro.openingExplanations
            .map((topic) => allExplanations.find((e) => e.topic === topic))
            .filter((e): e is NonNullable<typeof e> => e !== undefined)
        : allExplanations;

    // Stages 0..E-1: teach each opening explanation card in order.
    if (priorMounts < explanations.length) {
      const explanation = explanations[priorMounts];
      if (explanation) {
        const visibleReps = toRepArray(explanation.visibleReps);
        const illustration = toIllustration(explanation.illustration);
        return {
          move: 'intro_explanation',
          topic: explanation.topic,
          body: explanation.body,
          visibleReps,
          ...(illustration ? { illustration } : {}),
          rationale: `intro stage ${priorMounts}/${explanations.length} — teaching "${explanation.topic}" before practice (opening move)`,
        };
      }
    }

    // Stage E: the worked example, once every explanation has been taught.
    if (priorMounts === explanations.length) {
      const we = intro.workedExample;
      if (we) {
        const visibleReps = toRepArray(we.visibleReps, ['truth_table']);
        const illustration = toIllustration(we.illustration);
        return {
          move: 'worked_example',
          expression: we.expression,
          steps: we.steps,
          visibleReps,
          ...(illustration ? { illustration } : {}),
          rationale: `intro stage ${priorMounts} — mounting WorkedExample for "${we.expression}" after all ${explanations.length} explanation(s) (opening move)`,
        };
      }
    }
  }

  // Stage 2+ or missing intro content — mount the first practice item.
  const first = input.lesson.content.items[0];
  if (first) {
    return {
      move: 'next_practice_item',
      tier: first.difficultyTier,
      rationale: `opening move — starting at "${first.itemId}"`,
      item: {
        rep: 'truth_table',
        targetExpression: first.targetExpression,
        claimedTruthTable: first.truthTable,
        visibleReps: ['truth_table'],
        // F-27 AC#7: backfill prompt so the surface boundary never shows PromptMissing.
        prompt: defaultItemPrompt(first.targetExpression, 'truth_table'),
      },
    };
  }
  return {
    move: 'no_action',
    reason: 'wait_for_learner',
    rationale: 'lesson has no items to start (opening move)',
  };
}
