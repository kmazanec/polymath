import { describe, expect, it } from 'vitest';
import {
  LESSON_1_INTRO,
  LESSON_2_INTRO,
  LESSON_3_INTRO,
  introForLesson,
} from './lessonIntroContent.js';

describe('introForLesson', () => {
  it('maps each known lesson id to its own intro', () => {
    expect(introForLesson(1)).toBe(LESSON_1_INTRO);
    expect(introForLesson(2)).toBe(LESSON_2_INTRO);
    expect(introForLesson(3)).toBe(LESSON_3_INTRO);
  });

  it('defaults an unknown lesson id to Lesson 1 (never a blank intro)', () => {
    expect(introForLesson(99)).toBe(LESSON_1_INTRO);
  });

  it('the Lesson 3 intro is the NAND-universality lesson and names the universality idea', () => {
    expect(LESSON_3_INTRO.kind).toBe('LessonIntro');
    expect(LESSON_3_INTRO.lessonId).toBe(3);
    expect(LESSON_3_INTRO.title).toMatch(/NAND/i);
    expect(LESSON_3_INTRO.body).toMatch(/NAND/);
  });
});
