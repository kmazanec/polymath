/**
 * Transfer bank verification tests (F-08 merge gate).
 *
 * These tests are DB-FREE — they load `seed_data/transfer_items.json` directly
 * and verify correctness, schema compliance, uniqueness, and matrix coverage.
 * They must pass in CI without a database connection.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { truthTable } from '@polymath/booleans';
import { TransferItemFile, type TransferItem } from './transferBankSchema.js';

const seedFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../seed_data/transfer_items.json',
);

function loadItems(): TransferItem[] {
  const raw: unknown = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  return TransferItemFile.parse(raw);
}

describe('transfer_items.json — schema validation', () => {
  it('parses without error against the TransferItem Zod schema', () => {
    expect(() => loadItems()).not.toThrow();
  });

  it('contains exactly 32 items', () => {
    const items = loadItems();
    expect(items).toHaveLength(32);
  });

  it('contains exactly 8 items per lesson (L1, L2, L3, L4)', () => {
    const items = loadItems();
    for (const lessonId of [1, 2, 3, 4] as const) {
      const lesson = items.filter((i) => i.lessonId === lessonId);
      expect(lesson, `lesson ${lessonId}`).toHaveLength(8);
    }
  });
});

describe('transfer_items.json — truth-table correctness (merge gate)', () => {
  it('every item truthTable matches @polymath/booleans.truthTable(targetExpression)', () => {
    const items = loadItems();
    const failures: string[] = [];

    for (const item of items) {
      const computed = truthTable(item.targetExpression).out.map((v) => (v ? 1 : 0));
      if (JSON.stringify(computed) !== JSON.stringify(item.truthTable)) {
        failures.push(
          `${item.itemId}: claimed ${JSON.stringify(item.truthTable)}, computed ${JSON.stringify(computed)}`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(`Truth-table mismatches:\n${failures.join('\n')}`);
    }
  });
});

describe('transfer_items.json — uniqueness', () => {
  it('no two items in the same lesson share the same targetExpression', () => {
    const items = loadItems();
    const violations: string[] = [];

    for (const lessonId of [1, 2, 3, 4] as const) {
      const lesson = items.filter((i) => i.lessonId === lessonId);
      const seen = new Set<string>();
      for (const item of lesson) {
        if (seen.has(item.targetExpression)) {
          violations.push(
            `L${lessonId}: duplicate expression "${item.targetExpression}" (item ${item.itemId})`,
          );
        }
        seen.add(item.targetExpression);
      }
    }

    if (violations.length > 0) {
      throw new Error(`Within-lesson uniqueness violations:\n${violations.join('\n')}`);
    }
  });
});

describe('transfer_items.json — L1 matrix coverage', () => {
  it('L1 has exactly 3 items with targetRep=circuit and hiddenReps=[truth_table]', () => {
    const items = loadItems();
    const l1 = items.filter((i) => i.lessonId === 1);
    const matching = l1.filter(
      (i) =>
        i.targetRep === 'circuit' &&
        i.hiddenReps.length === 1 &&
        i.hiddenReps[0] === 'truth_table',
    );
    expect(matching).toHaveLength(3);
  });

  it('L1 has exactly 3 items with targetRep=pseudocode and hiddenReps=[circuit]', () => {
    const items = loadItems();
    const l1 = items.filter((i) => i.lessonId === 1);
    const matching = l1.filter(
      (i) =>
        i.targetRep === 'pseudocode' &&
        i.hiddenReps.length === 1 &&
        i.hiddenReps[0] === 'circuit',
    );
    expect(matching).toHaveLength(3);
  });

  it('L1 has exactly 2 items with targetRep=truth_table and hiddenReps=[pseudocode]', () => {
    const items = loadItems();
    const l1 = items.filter((i) => i.lessonId === 1);
    const matching = l1.filter(
      (i) =>
        i.targetRep === 'truth_table' &&
        i.hiddenReps.length === 1 &&
        i.hiddenReps[0] === 'pseudocode',
    );
    expect(matching).toHaveLength(2);
  });
});

describe('transfer_items.json — L4 De Morgan misconception items', () => {
  it('L4 has at least 2 items tagged as halfway-DeMorgan misconception targets', () => {
    const items = loadItems();
    const l4 = items.filter((i) => i.lessonId === 4);
    // The two misconception-targeting items use difficultyTier "harder" or "hardest"
    // and their itemId includes "demorgan-halfway". We check this via the naming
    // convention established in the seed data.
    const halfwayItems = l4.filter((i) => i.itemId.includes('halfway'));
    expect(halfwayItems.length).toBeGreaterThanOrEqual(2);
  });
});
