import type { Action, ClientEvent } from '@polymath/contract';

/**
 * The provider-abstraction seam (ADR-006 / ADR-007). LangChain (`ChatOpenAI` /
 * `ChatAnthropic`) plugs in here behind a uniform structured-output interface so
 * the inner agent can be A/B'd across providers. F-01 ships only the stub
 * implementation, which emits `no_action` with no LLM call — the wiring is real,
 * the inference is deferred to F-05.
 */
export interface AgentClient {
  /** Given an inbound learner event (+ whatever state the caller threads in
   *  later), propose exactly one Action. F-05 makes this an LLM call. */
  propose(event: ClientEvent): Promise<Action>;
}
