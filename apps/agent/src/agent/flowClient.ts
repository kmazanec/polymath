import { type Action, noAction } from '@polymath/contract';
import type { AgentClient, AgentInput, MoveProvider } from './client.js';
import { buildAgentGraph } from './graph.js';

/**
 * The provider-agnostic `AgentClient`: runs the inner-agent flow (graph + the
 * ADR-010 retry/fallback contract) against an injected `MoveProvider`. Production
 * passes `OpenAIMoveProvider`; tests pass a deterministic double.
 *
 * The LangGraph graph is compiled **once** (the provider is stable for the client's
 * lifetime), not per turn — `propose` just invokes the compiled graph.
 */
export class FlowAgentClient implements AgentClient {
  private readonly graph: ReturnType<typeof buildAgentGraph>;

  constructor(provider: MoveProvider) {
    this.graph = buildAgentGraph(provider);
  }

  async propose(input: AgentInput): Promise<Action> {
    const result = await this.graph.invoke({ input });
    return result.action ?? noAction('agent_unsure', 'graph produced no action');
  }
}
