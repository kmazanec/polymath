import { equivalent, parse, variables } from './index.js';

/**
 * The single var-capped, parse-safe equivalence scorer (the I3/I4 shared-contract
 * barrier).
 *
 * Every server-side `equivalent()` call on a learner-controlled submission must
 * apply the SAME three-part guard, or it is either a DoS or an unfair scorer:
 *
 *  1. **Distinct-variable cap (≤10).** The L1 grammar permits 26 single-letter
 *     vars → `equivalent` enumerates 2^n rows; a wide submission would block the
 *     event loop. Over the cap → simply *incorrect*, never an enumeration.
 *  2. **Parse-error → `false`.** An unparseable submission (prose, partial syntax)
 *     is *wrong*, never a thrown crash. A baseline chat learner types free text,
 *     so this catch is mandatory there.
 *  3. **Equivalence is the truth-maker** (`@polymath/booleans.equivalent`), never
 *     an LLM "is this right?" judgement.
 *
 * This was duplicated across `recomputeCorrect` (submit-correctness BKT path),
 * `computeTransferVerdict` (transfer path), and `layer2` (claimed-table recompute).
 * F-16 (baseline chat scoring) and F-17 (experiment test scoring) are NEW call
 * sites; fairness (ADR-011) + DoS-safety depend on all of them sharing ONE path,
 * so the triad lives here and every site calls it.
 *
 * Pure, zero-dependency (rides `@polymath/booleans`, already a workspace dep of
 * the agent and the baseline app — no new Dockerfile COPY).
 */

/** The distinct-variable cap shared by every learner-input equivalence check. */
export const MAX_EQUIVALENCE_VARS = 10;

/**
 * Score a learner `submission` against a `canonical` target expression.
 *
 * Returns `true` only when both parse and are logically equivalent within the
 * variable cap. An unparseable submission, an over-cap submission, or a parse
 * failure on either side returns `false` — never throws, never enumerates beyond
 * the cap. `canonical` is trusted content (an authored target expression); the
 * cap is applied to the *submission* (the learner-controlled, abuse-prone side),
 * matching the existing `computeTransferVerdict` / `recomputeCorrect` behavior.
 */
export function scoreEquivalence(submission: string, canonical: string): boolean {
  try {
    if (variables(parse(submission)).length > MAX_EQUIVALENCE_VARS) return false;
    return equivalent(submission, canonical);
  } catch {
    return false;
  }
}
