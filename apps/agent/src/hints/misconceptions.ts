import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Halfway-misconception hint data (ADR-012 stretch). A lesson-adjacent file —
 * validated by THIS small Zod schema in the agent, deliberately NOT in
 * `@polymath/contract` (it is content, not a cross-package wire contract).
 *
 * A "halfway" misconception is a recognisable partial answer (e.g. the learner
 * filled in the truth table for the inner operator but stopped before negating):
 * `halfwayTruthTable` is the MSB-first 0/1 output vector of that partial answer,
 * and `hintBody` is the targeted nudge to show when a wrong submission matches it.
 *
 * FAIL-SOFT: `loadMisconceptions` returns an empty bank on a missing or invalid
 * file (degraded read path, never a boot crash — the agent falls back to a generic
 * rephrase). Matching the Docker/COPY + non-fatal-seeding invariant.
 */

export const MisconceptionItemSchema = z.object({
  itemId: z.string(),
  /** The partial-answer output column, MSB-first 0/1 ints (booleans truth-table order). */
  halfwayTruthTable: z.array(z.union([z.literal(0), z.literal(1)])),
  hintBody: z.string(),
});
export type MisconceptionItem = z.infer<typeof MisconceptionItemSchema>;

export const MisconceptionsFileSchema = z.object({
  items: z.array(MisconceptionItemSchema),
});
export type MisconceptionsFile = z.infer<typeof MisconceptionsFileSchema>;

/** Repo-root `lessons/` directory (apps/agent/src/hints → ../../../../lessons). */
const lessonsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../lessons',
);

/**
 * Load and validate a lesson's misconception bank. FAIL-SOFT: a missing or
 * malformed file degrades to an empty bank (no items) rather than throwing — a
 * bad data file must not crash agent boot.
 */
export function loadMisconceptions(
  lessonId: number,
  root: string = lessonsRoot,
): MisconceptionsFile {
  const file = path.join(root, String(lessonId), 'misconceptions.json');
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    const parsed = MisconceptionsFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : { items: [] };
  } catch {
    return { items: [] };
  }
}

/**
 * Detect whether a learner's (wrong) output column matches a known halfway
 * misconception for `itemId`. Returns the matching item, or `undefined`.
 *
 * Compares the full 0/1 vector element-wise (length + every cell). Pure over the
 * supplied `bank` so it is unit-testable without filesystem access.
 */
export function detectHalfwayMisconception(
  bank: MisconceptionsFile,
  itemId: string,
  learnerOutput: (0 | 1)[],
): MisconceptionItem | undefined {
  return bank.items.find(
    (m) =>
      m.itemId === itemId &&
      m.halfwayTruthTable.length === learnerOutput.length &&
      m.halfwayTruthTable.every((v, i) => v === learnerOutput[i]),
  );
}

/**
 * The targeted hint body for a detected halfway misconception, or `undefined`
 * when none matches (the caller falls back to a generic rephrase).
 */
export function halfwayHintFor(
  bank: MisconceptionsFile,
  itemId: string,
  learnerOutput: (0 | 1)[],
): string | undefined {
  return detectHalfwayMisconception(bank, itemId, learnerOutput)?.hintBody;
}
