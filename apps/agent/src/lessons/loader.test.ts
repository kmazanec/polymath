import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

  it('reads the L1 KC vocabulary list (the explain-back precondition #4 source)', () => {
    const lesson = loadLesson(1);
    expect(Array.isArray(lesson.kcVocabulary)).toBe(true);
    // The ADR-010 Layer 4 generic terms must be present.
    expect(lesson.kcVocabulary).toContain('AND');
    expect(lesson.kcVocabulary).toContain('gate');
    expect(lesson.kcVocabulary).toContain('output');
  });

  it('FAILS CLOSED (empty list, no throw) when kc_vocabulary.json is absent', () => {
    // A lesson dir with content+config but no kc_vocabulary.json must still load —
    // the missing vocab degrades to [] (precondition #4 fails closed downstream),
    // never crashing the agent boot. We point loadLesson at a temp root with only
    // the required files.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polymath-lesson-'));
    const dir = path.join(tmp, '7');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'content.json'),
      JSON.stringify({
        lessonId: 7,
        title: 'no-vocab',
        knowledgeComponents: ['AND'],
        items: [
          { itemId: 'x', kc: 'AND', difficultyTier: 1, targetExpression: 'A AND B', variables: ['A', 'B'], truthTable: [0, 0, 0, 1] },
        ],
      }),
    );
    // Reuse lesson 1's mastery_config shape.
    const cfg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), '../../lessons/1/mastery_config.json'), 'utf8'),
    );
    fs.writeFileSync(path.join(dir, 'mastery_config.json'), JSON.stringify(cfg));

    const lesson = loadLesson(7, tmp);
    expect(lesson.kcVocabulary).toEqual([]); // fail closed, did not throw
  });
});
