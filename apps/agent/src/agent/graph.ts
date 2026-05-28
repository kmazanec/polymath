import { Annotation, StateGraph } from '@langchain/langgraph';
import { type Action, type ClientEvent, noAction } from '@polymath/contract';

/**
 * The inner-agent flow as a real LangGraph `StateGraph` (ADR-007). F-01 wires a
 * single `propose` node that emits `no_action` — no LLM call. F-05 expands this
 * into the snapshot → classify → branch → subgraph → emit graph against the
 * locked `Action` schema. Standing it up now (rather than a bare function)
 * de-risks the framework bootstrap the roadmap flags as the biggest MVP risk.
 */

const AgentState = Annotation.Root({
  event: Annotation<ClientEvent>(),
  action: Annotation<Action | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

const graph = new StateGraph(AgentState)
  .addNode('propose', (state) => ({
    action: noAction(
      'wait_for_learner',
      `stub: acknowledged "${state.event.kind}" (no inner-agent inference until F-05)`,
    ),
  }))
  .addEdge('__start__', 'propose')
  .addEdge('propose', '__end__')
  .compile();

/** Run one turn of the (stub) inner-agent graph for an inbound event. */
export async function runAgentTurn(event: ClientEvent): Promise<Action> {
  const result = await graph.invoke({ event });
  // The graph always populates `action`; fall back defensively.
  return result.action ?? noAction('agent_unsure', 'graph produced no action');
}
