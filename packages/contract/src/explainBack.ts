/**
 * The explain-back verdict — THE load-bearing F-11 → F-12 seam.
 *
 * F-11 (the explain-back rubric subgraph) PRODUCES an `ExplainBackVerdict`:
 * five deterministic preconditions run first, then (only on pass) the LLM judge.
 * The verdict is persisted into the explain-back turn's `events` row under
 * `payload.explainBackVerdict`, mirroring `payload.transferVerdict`
 * (see `apps/agent/src/server.ts`).
 *
 * F-12 (the full mastery gate) CONSUMES it: `toLoggedEvent` reads
 * `payload.explainBackVerdict.passed`, `deriveState` projects it into
 * `explainBackPassed`, and `evaluateMasteryGate` blocks on
 * `explain_back_not_passed` until it is true.
 *
 * FAIL CLOSED (CLAUDE.md invariant): a missing/unbuilt input is BLOCK, never a
 * degraded pass. No OPENAI_API_KEY, a judge throw, or an undefined judge all
 * resolve to `{ passed: false, reasons: ['judge_unavailable'] }`. A turn with NO
 * persisted `explainBackVerdict` leaves `explainBackPassed` false → blocker → block.
 *
 * Lives in `@polymath/contract` (not `@polymath/graph`) so the agent reads it
 * without a graph workspace dep — no Dockerfile change for F-12. `@polymath/graph`
 * imports it from here (graph already depends on contract).
 */

export interface ExplainBackVerdict {
  passed: boolean;
  /** Empty on pass; precondition/judge-fail reasons otherwise. */
  reasons: string[];
  /** Opaque LLM sub-scores; present only when the judge ran. */
  llmJudgmentDetail?: Record<string, unknown>;
}

/**
 * The closed set of deterministic-precondition / judge-availability fail reasons.
 * `reasons` is typed as `string[]` (the judge may add free-form content reasons),
 * but every precondition and the fail-closed judge path emit one of these.
 */
export type PreconditionReason =
  | 'duration_too_short'
  | 'duration_too_long'
  | 'too_few_words'
  | 'no_kc_vocab'
  | 'no_item_reference'
  | 'judge_unavailable'; // FAIL-CLOSED: no key / judge throw / missing judge
