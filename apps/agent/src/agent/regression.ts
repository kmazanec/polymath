/**
 * F-14 — cross-lesson regression detector (pure module).
 *
 * During an L2 session the SERVER reflex (server.ts) reads the learner's
 * prior-lesson (L1) KC BKT from `learner_state` and asks this module: has any L1
 * KC the learner had mastered slipped back below the recall threshold? If so, the
 * server mounts a text-only `CrossLessonRecall` card reminding the learner how
 * that KC shows up in the current composed expression.
 *
 * This is a DETERMINISTIC reflex, NOT an LLM-emitted menu move (it never goes
 * through `proposeMove` / `TacticalMove` / the OpenAI `MoveSchema`): the BKT check
 * IS the earned-it gate, so the server is the truth-maker. Pure + unit-tested.
 *
 * Inputs are all SERVER-DERIVED by the caller:
 *  - `l1BktByKc` — the L1 KC → BKT probability map read from `learner_state`.
 *  - `alreadyRecalledKcs` — KCs already recalled this session, from a SEPARATE
 *    UNCAPPED count query (the monotonic-throttle invariant: never the bounded
 *    event-log fold). This enforces "≤1 recall per session per KC".
 *  - `currentItemId` — the L2 item the learner is working when the slip is seen.
 */

/** The recall threshold. An L1 KC at OR ABOVE this is "still held"; strictly
 *  below it has regressed. Mirrors the spec boundary: 0.85 does NOT trigger,
 *  0.849 does. */
export const REGRESSION_THRESHOLD = 0.85;

export interface DetectRegressionInput {
  /** L1 KC → BKT probability, server-derived from `learner_state`. */
  l1BktByKc: Record<string, number>;
  /** KCs already recalled this session (from the uncapped throttle query). */
  alreadyRecalledKcs: readonly string[];
  /** The current L2 item the learner is working. */
  currentItemId: string;
}

/** The detector's output — exactly the slots the `CrossLessonRecall` ComponentSpec
 *  needs (minus `kind`), so the caller can mount it directly. */
export interface RegressionHit {
  kc: string;
  currentItemId: string;
  priorBktAtRegression: number;
  reminderBody: string;
}

/** A short, text-only reminder of how a KC behaves. Authored prose keyed by KC;
 *  an unknown KC degrades to a generic-but-valid reminder (never empty, never a
 *  throw) so the loader/renderer can't break on a new gate alphabet. */
const REMINDERS: Record<string, string> = {
  AND: 'Remember from Lesson 1: AND is true only when BOTH inputs are true. Spot the AND inside this composed expression.',
  OR: 'Remember from Lesson 1: OR is true when AT LEAST ONE input is true. Find the OR in this composed expression.',
  NOT: 'Remember from Lesson 1: NOT flips its input — true becomes false and false becomes true. Watch how the NOT acts here.',
};

function reminderFor(kc: string): string {
  return (
    REMINDERS[kc] ??
    `Remember from Lesson 1: you mastered ${kc} — here's how ${kc} shows up in this composed expression.`
  );
}

/**
 * Return the L1 KC that has regressed (BKT strictly below `REGRESSION_THRESHOLD`)
 * and has NOT yet been recalled this session, or null if none. When several KCs
 * have slipped, the LOWEST-BKT one is chosen (the most-regressed gets the recall).
 * Deterministic and total — never throws.
 */
export function detectRegression(input: DetectRegressionInput): RegressionHit | null {
  const { l1BktByKc, alreadyRecalledKcs, currentItemId } = input;
  const recalled = new Set(alreadyRecalledKcs);

  let best: { kc: string; bkt: number } | null = null;
  for (const [kc, bkt] of Object.entries(l1BktByKc)) {
    if (typeof bkt !== 'number' || Number.isNaN(bkt)) continue; // skip garbled
    if (bkt >= REGRESSION_THRESHOLD) continue; // still held — not a regression
    if (recalled.has(kc)) continue; // per-KC throttle: already recalled this session
    if (best === null || bkt < best.bkt) best = { kc, bkt };
  }

  if (best === null) return null;
  return {
    kc: best.kc,
    currentItemId,
    priorBktAtRegression: best.bkt,
    reminderBody: reminderFor(best.kc),
  };
}
