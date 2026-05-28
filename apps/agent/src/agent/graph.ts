import { Annotation, StateGraph } from '@langchain/langgraph';
import { type Action, noAction } from '@polymath/contract';
import type { AgentInput, MoveProvider } from './client.js';
import { compileMove } from './menu.js';
import { validateLayer2 } from './layer2.js';
import { loadFallbackBank, pickFallbackItem } from '../fallback_bank/index.js';

/**
 * The inner-agent flow as a LangGraph `StateGraph` (ADR-007): snapshot → propose
 * → emit. The `propose` node owns the ADR-010 retry contract — the model proposes
 * a tactical move, the move is compiled to a wire Action and Layer-2 validated;
 * on failure the model is retried **once** with the validation error; a second
 * failure falls back to a hand-curated bank item; an exhausted bank yields
 * `no_action`. The graph never emits a malformed or un-recomputed item.
 *
 * The `MoveProvider` is injected (DI), so the flow is exercised in tests with a
 * deterministic double and in production with `OpenAIMoveProvider`.
 */

const FlowState = Annotation.Root({
  input: Annotation<AgentInput>(),
  action: Annotation<Action | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

/** The fallback rep for an item-bearing turn: prefer the rep the learner is
 *  currently working in, else truth_table. */
function preferredRep(input: AgentInput): 'truth_table' | 'circuit' | 'pseudocode' {
  const ev = input.event;
  if (ev.kind === 'submit' && ev.repSubmission) return ev.repSubmission.rep;
  return 'truth_table';
}

/** Run the model with at most one Layer-2-driven retry, then the fallback bank,
 *  then `no_action`. Returns a validated, compiled wire Action — never malformed. */
export async function proposeAction(provider: MoveProvider, input: AgentInput): Promise<Action> {
  let lastDetail: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    let action: Action;
    try {
      const move = await provider.proposeMove(input, lastDetail);
      action = compileMove(move);
    } catch (err) {
      lastDetail = `provider error: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
    const v = validateLayer2(action);
    if (v.ok) return action;
    lastDetail = v.detail;
  }

  // Two failures: fall back to a hand-curated item (re-validated defensively).
  const rep = preferredRep(input);
  const bank = loadFallbackBank(input.lesson.content.lessonId);
  const item = pickFallbackItem(bank, { rep, visibleReps: [rep] });
  if (item) {
    const fallback = compileMove({
      move: 'simpler_item',
      item,
      rationale: `fallback after validation failure: ${lastDetail ?? 'unknown'}`,
    });
    if (validateLayer2(fallback).ok) return fallback;
  }
  return noAction(
    'agent_unsure',
    `agent failed validation twice and the fallback bank was unusable (${lastDetail ?? 'unknown'})`,
  );
}

/** Build the compiled inner-agent graph for a given provider. Compile once per
 *  provider (the provider is stable for the client's lifetime); `FlowAgentClient`
 *  caches the compiled graph and invokes it per turn. */
export function buildAgentGraph(provider: MoveProvider) {
  return new StateGraph(FlowState)
    .addNode('propose', async (state) => ({
      action: await proposeAction(provider, state.input),
    }))
    .addEdge('__start__', 'propose')
    .addEdge('propose', '__end__')
    .compile();
}
