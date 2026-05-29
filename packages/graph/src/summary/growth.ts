/**
 * Normalised learning-gain multiplier for a session's pre/post test scores.
 *
 * This is the single source of truth for the `growthMultiplier` tile on the
 * session summary (`SessionSummarySchema` in `@polymath/contract`). The summary
 * pipeline owns the rest of the report; this module owns only the gain formula so
 * every reader gets the same number.
 *
 * Formula (D1): `(post - pre) / max(pre, BASELINE_NORMALISATION)`.
 *  - Dividing by `max(pre, BASELINE_NORMALISATION)` keeps the multiplier finite and
 *    comparable when the pre-test is near zero: a learner who started at 0 and ended
 *    at 0.5 would otherwise divide by zero. The floor (0.25) is the assumed baseline
 *    competence below which we don't reward an even larger apparent gain.
 *  - `pre === null` → `null`: with no pre-test there is no baseline to measure growth
 *    against, so the multiplier is "not measured" (the tile renders "—"), never a
 *    fabricated 0. `post === null` with a real `pre` is treated as no post-progress
 *    (post defaults to the pre, i.e. multiplier 0) — a started-but-unfinished session.
 */
export const BASELINE_NORMALISATION = 0.25;

export function computeGrowthMultiplier(
  pre: number | null,
  post: number | null,
): number | null {
  // No pre-test ⇒ no baseline ⇒ not computable. Fail closed (null, never a fake 0).
  if (pre === null) return null;
  // Defensive: a non-finite pre would otherwise propagate NaN. Treat it as no baseline.
  if (!Number.isFinite(pre)) return null;
  // A null/non-finite post is "no post-progress" → defaults to pre (multiplier 0).
  const effectivePost = post === null || !Number.isFinite(post) ? pre : post;
  const result = (effectivePost - pre) / Math.max(pre, BASELINE_NORMALISATION);
  // The floored denominator already prevents div-by-zero; guard any residual drift so
  // this contract NEVER emits NaN/Infinity downstream.
  return Number.isFinite(result) ? result : null;
}
