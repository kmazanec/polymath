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
