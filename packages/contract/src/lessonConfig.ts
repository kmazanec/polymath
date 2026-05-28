import { z } from 'zod';

/**
 * The locked shape of `lessons/<id>/mastery_config.json` (ADR-011) and
 * `lessons/<id>/content.json`. F-01 ships lesson 1; lessons 2/3/4 reuse these
 * shapes. The *values* are per-lesson; the *shape* is the contract.
 */

export const MasteryConfig = z.object({
  consecutiveCorrectAtHardestTier: z.number().int().positive(),
  hintsUsedInLastN_items: z.number().int().nonnegative(),
  responseTimeFloorMs: z.number().int().nonnegative(),
  responseTimeCeilingMs: z.number().int().positive(),
  responseTimeMedianBandMs: z.tuple([z.number(), z.number()]),

  bktMasteryThreshold: z.number().min(0).max(1),
  bktPrior_L0: z.number().min(0).max(1),
  bktTransition_T: z.number().min(0).max(1),
  bktGuess_G: z.number().min(0).max(1),
  bktSlip_S: z.number().min(0).max(1),

  hintRatioMax: z.number().min(0).max(1),
  retryRatioMax: z.number().min(0).max(1),

  requireHandCuratedTransfer: z.boolean(),
  requireDifferentRepresentation: z.boolean(),
  requireExplainBackPass: z.boolean(),
});
export type MasteryConfig = z.infer<typeof MasteryConfig>;

/** A practice item in `content.json`. `truthTable` is the hand-verified canonical
 *  output vector (0/1, MSB-first per @polymath/booleans), the answer key. */
export const ContentItem = z.object({
  itemId: z.string(),
  kc: z.string(),
  difficultyTier: z.number().int().positive(),
  targetExpression: z.string(),
  variables: z.array(z.string()),
  truthTable: z.array(z.union([z.literal(0), z.literal(1)])),
});
export type ContentItem = z.infer<typeof ContentItem>;

export const LessonContent = z.object({
  lessonId: z.number().int().positive(),
  title: z.string(),
  knowledgeComponents: z.array(z.string()),
  items: z.array(ContentItem),
});
export type LessonContent = z.infer<typeof LessonContent>;
