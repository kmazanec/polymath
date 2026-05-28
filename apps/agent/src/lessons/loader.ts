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
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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

  return { content, masteryConfig };
}
