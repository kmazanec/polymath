import { describe, expect, it } from 'vitest';
import { loadLesson } from './loader.js';

describe('loadLesson', () => {
  it('loads and validates lesson 1 against the contract + the validator', () => {
    const lesson = loadLesson(1);
    expect(lesson.content.lessonId).toBe(1);
    expect(lesson.content.knowledgeComponents).toEqual(['AND', 'OR', 'NOT']);
    expect(lesson.content.items).toHaveLength(3);
    expect(lesson.masteryConfig.bktMasteryThreshold).toBe(0.95);
  });

  it('cross-checks each item truth table against @polymath/booleans', () => {
    // loadLesson throws on any mismatch; reaching here proves all three agree.
    expect(() => loadLesson(1)).not.toThrow();
  });

  it('throws on a missing lesson directory', () => {
    expect(() => loadLesson(99)).toThrow();
  });
});
