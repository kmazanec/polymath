import type { ComponentSpec } from '@polymath/contract';

/**
 * The Lesson 1 intro the walking skeleton renders. Copy is in Polymath's
 * pedagogical, three-representation voice (ADR-001): the same idea seen as a
 * truth table, a circuit, and code — mastery means doing it in all three.
 */
export const LESSON_1_INTRO: Extract<ComponentSpec, { kind: 'LessonIntro' }> = {
  kind: 'LessonIntro',
  lessonId: 1,
  title: 'Lesson 1 — Basic operators',
  body:
    'AND, OR, and NOT are the whole alphabet of logic. Here you will meet each one ' +
    'in three forms at once — a truth table, a circuit you can wire and pulse, and ' +
    'a line of code — because the same idea looks different in each, and really ' +
    'knowing it means recognising it in all three. You master this lesson by solving ' +
    'problems across every form, on your own, without hints.',
};

/**
 * The Lesson 2 intro (F-13 / F-15). Copy in Polymath's three-representation
 * voice — the final wording is Keith's pedagogical authoring (see the spec's Manual
 * setup). Composition is the lesson: nesting AND/OR/NOT into compound expressions,
 * and meeting XOR not as a new gate but as something you *build* — true when exactly
 * one input is true, i.e. `(A AND NOT B) OR (NOT A AND B)`. NB: never the string
 * "A XOR B" — the alphabet is still only AND/OR/NOT; XOR is a composition you read
 * off the truth table. It also doubles as the transient bridge the client shows the
 * instant a learner advances (F-15), covering the ~<500ms until the server's
 * deterministic L2 first-item mount lands, so the workspace is never blank during the
 * macro transition.
 */
export const LESSON_2_INTRO: Extract<ComponentSpec, { kind: 'LessonIntro' }> = {
  kind: 'LessonIntro',
  lessonId: 2,
  title: 'Lesson 2 — Composition',
  body:
    'You already know AND, OR, and NOT. Now you compose them: nesting them into ' +
    'compound expressions like (A AND B) OR (NOT C), and reading what the whole thing ' +
    'does across all three forms — truth table, circuit, and code. The headline idea ' +
    'is exclusive-or: "exactly one of A or B is true". It is not a new gate — it is ' +
    'something you build from the alphabet you have, true when exactly one input is on. ' +
    'You master this lesson by composing fluently across every form, on your own.',
};

/** Map a lesson id to its intro spec. Defaults to Lesson 1 for any unknown id. */
export function introForLesson(lessonId: number): Extract<ComponentSpec, { kind: 'LessonIntro' }> {
  return lessonId === 2 ? LESSON_2_INTRO : LESSON_1_INTRO;
}
