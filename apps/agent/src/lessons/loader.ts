import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { truthTable } from '@polymath/booleans';
import { LessonContent, MasteryConfig } from '@polymath/contract';

/** Repo-root `lessons/` directory (apps/agent/src/lessons → ../../../../lessons). */
const lessonsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../lessons',
);

export interface Lesson {
  content: LessonContent;
  masteryConfig: MasteryConfig;
  /** Generic KC vocabulary terms (ADR-010 Layer 4a #4) for the explain-back
   *  preconditions. OPTIONAL + NON-FATAL: a missing/garbled `kc_vocabulary.json`
   *  degrades to an EMPTY list — precondition #4 then fails CLOSED (a learner
   *  cannot pass explain-back without the vocab check), never a crash, never a
   *  pass (CLAUDE.md fail-closed invariant). */
  kcVocabulary: string[];
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Read the lesson's optional KC vocabulary list. NON-FATAL: any failure (missing
 *  file, bad JSON, wrong shape) returns `[]` and logs — it must NEVER throw at
 *  load/boot (a boot-time data read is non-fatal-but-FAILING, degrade to block, not
 *  crash). An empty list makes precondition #4 fail closed downstream. */
function readKcVocabulary(file: string): string[] {
  try {
    const raw = readJson(file) as { kcVocabulary?: unknown };
    const list = raw?.kcVocabulary;
    if (!Array.isArray(list)) {
      console.error(`kc_vocabulary.json at ${file} has no string[] "kcVocabulary"; degrading to empty (precondition #4 will fail closed)`);
      return [];
    }
    const terms = list.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    return terms;
  } catch {
    // Missing/garbled file: degrade to empty (fail closed), never crash the boot.
    console.error(`kc_vocabulary.json at ${file} unreadable; degrading to empty (precondition #4 will fail closed)`);
    return [];
  }
}

/**
 * Load + validate a lesson. Throws if the JSON violates the contract schema, or
 * if any item's hand-authored `truthTable` disagrees with the independently
 * computed table from @polymath/booleans (ADR-010: the validator is the source
 * of truth; content answer keys must agree with it).
 */
export function loadLesson(lessonId: number, root: string = lessonsRoot): Lesson {
  const dir = path.join(root, String(lessonId));
  const content = LessonContent.parse(readJson(path.join(dir, 'content.json')));
  const masteryConfig = MasteryConfig.parse(
    readJson(path.join(dir, 'mastery_config.json')),
  );

  for (const item of content.items) {
    const computed = truthTable(item.targetExpression).out.map((v) => (v ? 1 : 0));
    if (JSON.stringify(computed) !== JSON.stringify(item.truthTable)) {
      throw new Error(
        `Lesson ${lessonId} item "${item.itemId}" truth table disagrees with the validator: ` +
          `claimed ${JSON.stringify(item.truthTable)}, computed ${JSON.stringify(computed)}`,
      );
    }
  }

  const kcVocabulary = readKcVocabulary(path.join(dir, 'kc_vocabulary.json'));

  return { content, masteryConfig, kcVocabulary };
}
