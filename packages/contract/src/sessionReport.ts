import { z } from 'zod';

/**
 * Session summary contract — the end-of-session report tiles.
 *
 * This is the cross-cutting seam between the summary-building pipeline (agent-side,
 * which assembles the numbers from the event log + experiment tables) and every
 * reader of those numbers (the metrics dashboard, future session-wrap UIs). It is
 * **locked and append-only** once accepted: a new tile is added as a new optional
 * field, an existing field is never re-shaped or removed (the contract change
 * protocol in ROADMAP.md). `.strict()` makes an unexpected extra key a parse error
 * so a drifting producer is caught at the boundary, not silently carried.
 *
 * Nullable score fields distinguish "measured as zero" from "never measured": a
 * `null` pre-test means the learner skipped (or there was no experiment arm), and a
 * downstream tile must render that as "—", never as a real 0 that would skew an
 * aggregate. `growthMultiplier` is likewise null whenever it can't be computed (no
 * pre-test) — see `computeGrowthMultiplier` in `@polymath/graph`.
 */
export const SessionSummarySchema = z
  .object({
    /** Pre-test score in [0,1], or null if no pre-test was taken (skipped / no arm). */
    preTestScore: z.number().nullable(),
    /** Post-test score in [0,1], or null if no post-test was taken. */
    postTestScore: z.number().nullable(),
    /** Normalised learning-gain multiplier, or null when it can't be computed (no
     *  pre-test). Producer: `computeGrowthMultiplier` (@polymath/graph). */
    growthMultiplier: z.number().nullable(),
    /** Total engaged time on task for the session, in milliseconds. */
    timeOnTaskMs: z.number(),
    /** Fraction of transfer probes the learner passed, in [0,1]. */
    transferSuccessRate: z.number(),
    /** The session's terminal mastery status. `not_started` covers a session that
     *  never reached practice. */
    masteryStatus: z.enum(['mastered', 'remediating', 'practicing', 'not_started']),
    /** The explain-back verdict (the integrity boundary): whether it passed and the
     *  named reasons (precondition / judge reasons). Fails closed elsewhere — here it
     *  is reported verbatim. */
    explainBackVerdict: z.object({
      passed: z.boolean(),
      reasons: z.array(z.string()),
    }),
    /** KCs the learner reached mastery on this session. */
    kcsMastered: z.array(z.string()),
    /** KCs the learner is stuck on (repeated misses / below threshold). */
    kcsStuck: z.array(z.string()),
    /** Provenance: an experiment-arm session (pre/post tests exist) vs. a plain
     *  in-session summary. Lets a reader know whether the test scores are meaningful. */
    source: z.enum(['experiment', 'in_session']),
  })
  .strict();

export type SessionSummary = z.infer<typeof SessionSummarySchema>;
