import type { Action, ClientEvent } from '@polymath/contract';
import type { AgentClient } from './client.js';
import { runAgentTurn } from './graph.js';

/** The F-01 agent: drives the LangGraph stub, which emits `no_action`. No LLM. */
export class StubAgentClient implements AgentClient {
  propose(event: ClientEvent): Promise<Action> {
    return runAgentTurn(event);
  }
}
