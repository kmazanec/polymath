import type { Action } from '@polymath/contract';
import type { AgentClient, AgentInput, MoveProvider } from './client.js';
import { runAgentTurn } from './graph.js';

/**
 * The provider-agnostic `AgentClient`: runs the inner-agent flow (graph + the
 * ADR-010 retry/fallback contract) against an injected `MoveProvider`. Production
 * passes `OpenAIMoveProvider`; tests pass a deterministic double.
 */
export class FlowAgentClient implements AgentClient {
  constructor(private readonly provider: MoveProvider) {}

  propose(input: AgentInput): Promise<Action> {
    return runAgentTurn(this.provider, input);
  }
}
