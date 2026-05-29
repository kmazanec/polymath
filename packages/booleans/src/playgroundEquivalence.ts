import { equivalent, parse, variables } from './index.js';
import { MAX_EQUIVALENCE_VARS } from './scoreEquivalence.js';

/**
 * Playground equivalence scorer (ADR-012 free-build playground).
 *
 * Unlike `scoreEquivalence` (where `canonical` is trusted authored content and
 * only the learner `submission` side is capped), in the playground BOTH the
 * target expression and the learner's rep submissions are learner-authored /
 * learner-influenced. So the distinct-variable cap (DoS guard) and the
 * parse-error → `false` rule are applied to EVERY side: an over-cap or
 * unparseable input on either side is simply "not equivalent", never an
 * enumeration and never a throw.
 *
 * `submissions` is the set of rep expressions the learner built (truth-table,
 * circuit, pseudocode all reduce to a canonical Boolean expression string).
 * Each is scored independently against `target`; the result reports per-key
 * pass/fail plus `allEquivalent` (every supplied submission matches).
 */

export interface PlaygroundEquivalenceResult {
  /** Per-submission verdict, keyed identically to the input map. */
  byKey: Record<string, boolean>;
  /** True iff at least one submission was supplied and every one is equivalent. */
  allEquivalent: boolean;
}

/** Cap + parse-safe check that `expr` is within the variable cap and parseable. */
function withinCap(expr: string): boolean {
  try {
    return variables(parse(expr)).length <= MAX_EQUIVALENCE_VARS;
  } catch {
    return false;
  }
}

/**
 * Score each learner submission expression in `submissions` against `target`.
 * Caps BOTH the target and each submission; any over-cap / unparseable side
 * yields `false` for that key (never throws, never enumerates beyond the cap).
 */
export function playgroundEquivalence(
  target: string,
  submissions: Record<string, string>,
): PlaygroundEquivalenceResult {
  const byKey: Record<string, boolean> = {};
  const targetOk = withinCap(target);
  const keys = Object.keys(submissions);
  for (const key of keys) {
    const submission = submissions[key] ?? '';
    if (!targetOk || !withinCap(submission)) {
      byKey[key] = false;
      continue;
    }
    try {
      byKey[key] = equivalent(submission, target);
      /* v8 ignore start -- defensive: both sides already passed withinCap()
         (parseable + within the variable cap), so equivalent() cannot throw here. */
    } catch {
      byKey[key] = false;
    }
    /* v8 ignore stop */
  }
  const allEquivalent = keys.length > 0 && keys.every((k) => byKey[k] === true);
  return { byKey, allEquivalent };
}
