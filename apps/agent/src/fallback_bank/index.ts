import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ProposedItem } from '../agent/menu.js';

/**
 * ADR-010 Layer 2 fallback bank. When the agent fails to produce a valid item
 * twice in a row, the loop falls back to a hand-curated item from here, so the
 * lesson never stalls. The bank is committed JSON (never LLM-generated); every
 * `claimedTruthTable` is asserted against @polymath/booleans in the test suite.
 *
 * Loading is **non-fatal** (CLAUDE.md → Deploy): a missing/corrupt bank degrades
 * to an empty bank (the loop then emits `no_action` rather than crashing boot).
 */

const FallbackItem = z.object({
  itemId: z.string(),
  kc: z.string(),
  tier: z.number().int().positive(),
  targetExpression: z.string(),
  claimedTruthTable: z.array(z.union([z.literal(0), z.literal(1)])),
});
const FallbackBank = z.object({
  lessonId: z.number().int().positive(),
  note: z.string().optional(),
  items: z.array(FallbackItem),
});
export type FallbackItem = z.infer<typeof FallbackItem>;

const bankDir = path.dirname(fileURLToPath(import.meta.url));

/** Read + validate the fallback bank for a lesson. Returns `[]` on any failure
 *  (non-fatal: a degraded read path beats crashing the agent at boot). */
export function loadFallbackBank(lessonId: number, dir: string = bankDir): FallbackItem[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, `lesson_${lessonId}.json`), 'utf8'));
    return FallbackBank.parse(raw).items;
  } catch (err) {
    console.error(`fallback bank for lesson ${lessonId} unavailable — degrading to empty`, err);
    return [];
  }
}

/** Pick a fallback item, preferring the requested tier, skipping any already used
 *  this turn-chain. Returns a `ProposedItem` ready for `compileMove`, or null if
 *  the bank is exhausted. */
export function pickFallbackItem(
  bank: FallbackItem[],
  opts: { tier?: number; excludeExpressions?: Set<string>; visibleReps: ProposedItem['visibleReps']; rep: ProposedItem['rep'] },
): ProposedItem | null {
  const exclude = opts.excludeExpressions ?? new Set<string>();
  const eligible = bank.filter((i) => !exclude.has(i.targetExpression));
  if (eligible.length === 0) return null;
  const chosen = (opts.tier && eligible.find((i) => i.tier === opts.tier)) || eligible[0]!;
  return {
    rep: opts.rep,
    targetExpression: chosen.targetExpression,
    claimedTruthTable: chosen.claimedTruthTable,
    visibleReps: opts.visibleReps,
  };
}
