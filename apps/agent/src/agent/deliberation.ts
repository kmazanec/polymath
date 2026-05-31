/**
 * Agent-internal deliberation types (F-28 / ADR-014).
 *
 * These are the shared types that thread through the 5-node deliberation graph:
 *   assess → decide → realize → validate → emit
 *
 * None of these types cross the wire (they are NOT in @polymath/contract).
 * They are purely agent-internal state: derived/cached from the server snapshot,
 * never the integrity source for BKT, mastery, or any gate.
 */

/** The assess node's output: a named classification of where the learner stands.
 *  Derived ONLY from server-derived snapshot fields (never from client flags). */
export type LearnerProgress =
  | 'stuck'         // repeated misses, no progress
  | 'progressing'   // moving forward, mostly correct
  | 'guessing'      // high variability, low BKT despite some correct
  | 'over_hinting'  // using too many hints relative to progress
  | 'ready';        // rule-gate passed, all BKT thresholds met

/** The decide node's output: advisory pedagogical intent. The heuristic provider
 *  keeps its own policy and may ignore it — so the keyless path remains byte-identical.
 *  The LLM provider uses this to modulate its response style. */
export type PedagogicalIntent =
  | 'introduce'       // show a new concept or worked example
  | 'practice'        // mount next practice item
  | 'simplify'        // drop to a simpler item
  | 'rephrase'        // re-present the same item
  | 'hint'            // offer a hint
  | 'answer'          // answer a learner question
  | 'probe_transfer'  // fire a transfer probe
  | 'propose_mastery' // propose mastery transition
  | 'wait';           // nothing to do, wait for learner

/** Per-session deliberation memory: cached advisory state, NOT integrity.
 *  Stored in FlowAgentClient's Map<sessionId, DeliberationMemory>.
 *  Lost on restart — that is fine; BKT/streak/gates are the durable fold. */
export interface DeliberationMemory {
  /** The last pedagogical intent the agent chose. */
  lastIntent?: PedagogicalIntent;
  /** The last difficulty tier committed by the agent, if any. */
  lastDifficultyTier?: number;
  /** Count of generation retries this session (informational only). */
  regenerationCount: number;
  /** The last learner classification from assess. */
  lastClassification?: LearnerProgress;
  /** Total turns this session (informational, advisory only). */
  turnCount: number;
}

/** The full deliberation context threaded into the realize node.
 *  Built by assess + decide + the stored memory; consumed by the provider. */
export interface DeliberationContext {
  classification: LearnerProgress;
  intent: PedagogicalIntent;
  memory: DeliberationMemory;
}

/** Return a fresh, zeroed DeliberationMemory for a new session. */
export function emptyMemory(): DeliberationMemory {
  return {
    regenerationCount: 0,
    turnCount: 0,
  };
}
