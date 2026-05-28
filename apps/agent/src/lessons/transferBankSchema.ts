import { z } from 'zod';
import { Rep } from '@polymath/contract';

/**
 * Zod schema for a single item in `seed_data/transfer_items.json`.
 *
 * NOTE: `difficultyTier` lives here (the JSON authoring file) but is NOT a column
 * in the DB `transfer_bank` table. The shipped schema (`schema.ts`) has columns:
 * item_id, lesson_id, target_expression, truth_table, target_rep, hidden_reps.
 * The schema divergence is flagged to Keith: if `difficulty_tier` is needed at
 * query time (e.g. for difficulty-stratified probe selection), a migration adding
 * it to the DB table will be required (F-future).
 */
export const TransferItem = z.object({
  itemId: z.string().min(1),
  lessonId: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  targetExpression: z.string().min(1),
  /**
   * Canonical truth table as 0/1 ints, MSB-first, matching @polymath/booleans
   * `truthTable(targetExpression).out.map(v => v ? 1 : 0)`.
   */
  truthTable: z.array(z.union([z.literal(0), z.literal(1)])).min(2),
  targetRep: Rep,
  hiddenReps: z.array(Rep).min(1),
  difficultyTier: z.enum(['intro', 'basic', 'harder', 'hardest']),
});
export type TransferItem = z.infer<typeof TransferItem>;

/** The full seed file is an array of TransferItem. */
export const TransferItemFile = z.array(TransferItem);
export type TransferItemFile = z.infer<typeof TransferItemFile>;
