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

/**
 * The Lesson 3 intro (NAND universality). Copy in Polymath's three-representation
 * voice — the final wording is Keith's pedagogical authoring (see the spec's Manual
 * setup). The lesson is the "aha" of the whole gym: a SINGLE gate, NAND, is enough
 * to build every Boolean function. The learner first sees AND, OR, and NOT each
 * rebuilt from NAND alone (the universality proof, worked), then constructs given
 * functions in a NAND-only circuit workspace — culminating in XOR from four NANDs,
 * pulsed through the circuit. Like LESSON_2_INTRO it also doubles as the transient
 * bridge shown the instant a learner advances L2→L3, so the workspace is never blank
 * during the macro transition.
 */
export const LESSON_3_INTRO: Extract<ComponentSpec, { kind: 'LessonIntro' }> = {
  kind: 'LessonIntro',
  lessonId: 3,
  title: 'Lesson 3 — NAND universality',
  body:
    'Here is the surprise the whole alphabet has been hiding: you do not need AND, OR, ' +
    'and NOT as separate gates at all. One gate — NAND, "not-and", true unless both ' +
    'inputs are on — can build every one of them, and therefore every Boolean function ' +
    'that exists. You will first watch NOT, AND, and OR each reappear out of NAND alone, ' +
    'then build given functions in a NAND-only workspace across all three forms, ending ' +
    'with exclusive-or wired from four NANDs and pulsed through the circuit. You master ' +
    'this lesson by constructing fluently from NAND alone, on your own.',
};

/** Map a lesson id to its intro spec. Defaults to Lesson 1 for any unknown id. */
export function introForLesson(lessonId: number): Extract<ComponentSpec, { kind: 'LessonIntro' }> {
  if (lessonId === 2) return LESSON_2_INTRO;
  if (lessonId === 3) return LESSON_3_INTRO;
  return LESSON_1_INTRO;
}
