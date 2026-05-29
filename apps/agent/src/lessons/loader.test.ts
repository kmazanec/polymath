import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadLesson, loadLessonIfExists } from './loader.js';

/** Resolve a repo path from this test file (NOT process.cwd(), which differs
 *  between `pnpm --filter @polymath/agent test` and a root `pnpm test` run). */
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../../..');

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

  // F-13: Lesson 2 (composition). Validator-passing content + config + KC vocab.
  it('loads and validates lesson 2 against the contract + the validator (F-13)', () => {
    // loadLesson cross-checks every item's hand-authored truthTable against
    // @polymath/booleans and throws on any mismatch — reaching the assertions
    // proves all L2 items agree with the validator.
    expect(() => loadLesson(2)).not.toThrow();
    const lesson = loadLesson(2);
    expect(lesson.content.lessonId).toBe(2);
    expect(lesson.content.title).toMatch(/Composition/i);
    expect(lesson.content.knowledgeComponents.length).toBeGreaterThan(0);
    // ~12 practice items across the difficulty tiers (the composition + XOR gym).
    expect(lesson.content.items.length).toBeGreaterThanOrEqual(12);
    // XOR-as-composition: at least one item carries the canonical XOR truth table
    // [0,1,1,0], expressed as a pure AND/OR/NOT composition (never the string
    // "A XOR B" — the parser knows only NOT/AND/OR; the criterion is the table).
    expect(
      lesson.content.items.some(
        (i) => JSON.stringify(i.truthTable) === JSON.stringify([0, 1, 1, 0]),
      ),
    ).toBe(true);
    // No item smuggles the bare XOR keyword into a parsed expression.
    for (const i of lesson.content.items) {
      expect(i.targetExpression).not.toMatch(/\bXOR\b/);
    }
    expect(lesson.masteryConfig.bktMasteryThreshold).toBe(0.95);
  });

  it('reads the L2 KC vocabulary list including the composition/XOR terms (F-13)', () => {
    const lesson = loadLesson(2);
    expect(Array.isArray(lesson.kcVocabulary)).toBe(true);
    expect(lesson.kcVocabulary).toContain('composition');
    expect(lesson.kcVocabulary).toContain('XOR');
    expect(lesson.kcVocabulary).toContain('exclusive or');
  });

  // Lesson 3 (NAND universality). Validator-passing content + config + KC vocab.
  it('loads and validates lesson 3 against the contract + the validator', () => {
    // loadLesson cross-checks every item's hand-authored truthTable against
    // @polymath/booleans (including the NAND grammar) and throws on any mismatch —
    // reaching the assertions proves all L3 items agree with the validator.
    expect(() => loadLesson(3)).not.toThrow();
    const lesson = loadLesson(3);
    expect(lesson.content.lessonId).toBe(3);
    expect(lesson.content.title).toMatch(/NAND/i);
    // 12 practice items across the difficulty tiers (the NAND-universality gym).
    expect(lesson.content.items.length).toBeGreaterThanOrEqual(12);
    // Tiers 1–4 are all represented.
    expect(new Set(lesson.content.items.map((i) => i.difficultyTier))).toEqual(
      new Set([1, 2, 3, 4]),
    );
    // Every item's KC is one of the lesson's declared knowledge components.
    for (const i of lesson.content.items) {
      expect(lesson.content.knowledgeComponents).toContain(i.kc);
    }
    // At least one item carries the canonical XOR table [0,1,1,0] (the aha target).
    expect(
      lesson.content.items.some(
        (i) => JSON.stringify(i.truthTable) === JSON.stringify([0, 1, 1, 0]),
      ),
    ).toBe(true);
    expect(lesson.masteryConfig.bktMasteryThreshold).toBe(0.95);
  });

  it('L3 uses the same 4-condition mastery gate as L2 (copied verbatim)', () => {
    const l2 = loadLesson(2);
    const l3 = loadLesson(3);
    expect(l3.masteryConfig).toEqual(l2.masteryConfig);
  });

  it('reads the L3 KC vocabulary list including the NAND-universality terms', () => {
    const lesson = loadLesson(3);
    expect(Array.isArray(lesson.kcVocabulary)).toBe(true);
    expect(lesson.kcVocabulary).toContain('nand');
    expect(lesson.kcVocabulary).toContain('universal gate');
    expect(lesson.kcVocabulary).toContain('functional completeness');
  });

  it('reads the L1 KC vocabulary list (the explain-back precondition #4 source)', () => {
    const lesson = loadLesson(1);
    expect(Array.isArray(lesson.kcVocabulary)).toBe(true);
    // Thread 12: the L1 KC vocab is tightened toward lesson-specific compound terms
    // (less likely in off-topic paste than bare `true/gate/input/output`), kept
    // DISTINCT from precondition #5 (the item's bare vars + operators). The
    // lesson-specific multi-word terms must be present.
    expect(lesson.kcVocabulary).toContain('truth table');
    expect(lesson.kcVocabulary).toContain('AND gate');
    expect(lesson.kcVocabulary).toContain('boolean expression');
    // The over-generic single words were removed (they matched off-topic English).
    expect(lesson.kcVocabulary).not.toContain('true');
    expect(lesson.kcVocabulary).not.toContain('output');
  });

  // F-15: the non-fatal existence check the L1→L2 advance reflex's `nextLessonId`
  // guard reads. A `loadLesson(2)` that throws (ENOENT before `lessons/2/` exists, or
  // a bad-content throw) must NOT crash the turn/boot — it returns `undefined` so the
  // "continue to Lesson 2" affordance stays disabled (a dead button is better than a
  // boot crash), and is enabled only once a real L2 loads.
  describe('loadLessonIfExists (F-15 nextLessonId guard)', () => {
    it('returns the lesson when it exists + validates', () => {
      const lesson = loadLessonIfExists(1);
      expect(lesson).not.toBeUndefined();
      expect(lesson!.content.lessonId).toBe(1);
    });

    it('returns undefined (no throw) for a missing lesson directory', () => {
      expect(loadLessonIfExists(99)).toBeUndefined();
    });

    it('returns undefined (no throw) when the lesson content is invalid', () => {
      // A lesson dir whose truthTable disagrees with the validator throws in
      // loadLesson; the existence check must swallow it (degrade, not crash).
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polymath-lesson-bad-'));
      const dir = path.join(tmp, '8');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'content.json'),
        JSON.stringify({
          lessonId: 8,
          title: 'bad-truthtable',
          knowledgeComponents: ['AND'],
          items: [
            { itemId: 'x', kc: 'AND', difficultyTier: 1, targetExpression: 'A AND B', variables: ['A', 'B'], truthTable: [1, 1, 1, 1] },
          ],
        }),
      );
      const cfg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'lessons/1/mastery_config.json'), 'utf8'),
      );
      fs.writeFileSync(path.join(dir, 'mastery_config.json'), JSON.stringify(cfg));
      expect(loadLessonIfExists(8, tmp)).toBeUndefined();
    });
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
      fs.readFileSync(path.join(repoRoot, 'lessons/1/mastery_config.json'), 'utf8'),
    );
    fs.writeFileSync(path.join(dir, 'mastery_config.json'), JSON.stringify(cfg));

    const lesson = loadLesson(7, tmp);
    expect(lesson.kcVocabulary).toEqual([]); // fail closed, did not throw
  });
});
