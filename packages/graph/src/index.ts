/**
 * @polymath/graph — LangGraph subgraphs for content evaluation (ADR-010 Layer 4).
 *
 * F-11 introduces the explain-back rubric subgraph: 5 deterministic preconditions
 * (Stage 4a) followed by an LLM-as-judge (Stage 4b). Everything FAILS CLOSED — a
 * missing input, an unconfigured judge (no key), or a thrown error produces
 * `{ passed: false }` with a named reason, never a degraded pass.
 *
 * The verdict shape (`ExplainBackVerdict`, `PreconditionReason`) lives in
 * `@polymath/contract` (the F-11 → F-12 seam) and is re-exported here for callers.
 */

export type { ExplainBackVerdict, PreconditionReason } from '@polymath/contract';

export * from './explainback/prosody.js';
export * from './explainback/preconditions.js';
export * from './explainback/retryPrompts.js';
export * from './explainback/judge.js';
export * from './explainback/subgraph.js';
export * from './summary/growth.js';
