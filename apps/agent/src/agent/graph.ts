import { Annotation, StateGraph } from '@langchain/langgraph';
import { type Action, noAction } from '@polymath/contract';
import type { AgentInput, MoveProvider } from './client.js';
import { compileMove } from './menu.js';
import { validateLayer2 } from './layer2.js';
import { loadFallbackBank, pickFallbackItem } from '../fallback_bank/index.js';
import type { DeliberationContext, DeliberationMemory } from './deliberation.js';
import { emptyMemory } from './deliberation.js';
import { assess, decide } from './deliberationNodes.js';

/**
 * The inner-agent flow as a LangGraph `StateGraph` (ADR-007 / ADR-014 / F-28):
 *   assess → decide → realize → validate → emit
 *
 * Graph nodes:
 *  - `assess`: classifies the learner's progress from the server-derived snapshot.
 *  - `decide`: converts the classification to an advisory pedagogical intent.
 *  - `realize`: calls the MoveProvider with the classification + intent + memory
 *               (the ADR-010 retry/fallback contract lives here — unchanged from the
 *               pre-F-28 single-node graph).
 *
 *               *** F-29 SEAM: the generation step plugs into THIS node. ***
 *               F-29 overrides the provider call with a validator-gated generated item
 *               when `intent === 'practice'` and the lesson config enables generation.
 *               F-28 leaves a plain `provider.proposeMove(input, error, deliberation)`
 *               call here; F-29 wraps/replaces it without reshaping the graph.
 *
 *  - `validate`: confirms the Action is Layer-2 valid (byte-for-byte unchanged contract).
 *                The `validateLayer2` call is explicit here even though `realize`
 *                already validates — keeping it as a named node makes the invariant
 *                visible in the graph topology and ensures any future realize-override
 *                (F-29) still passes through Layer-2.
 *  - `emit`:    builds `memoryOut` from the realized action + previous memory.
 *
 * The `MoveProvider` is injected (DI), so the flow is exercised in tests with a
 * deterministic double and in production with `OpenAIMoveProvider`.
 *
 * ADR-006 provider-selection: `OpenAIMoveProvider` when OPENAI_API_KEY is set,
 * heuristic (`HeuristicMoveProvider`) otherwise — wired via `makeAgentClient`.
 *
 * The heuristic provider IGNORES the deliberation arg (optional 3rd param) — this is
 * intentional so the keyless path is byte-identical to pre-F-28 behaviour (AC#5).
 *
 * The 15-second timeout stays in `server.ts::proposeWithTimeout` (outside the graph).
 * The retry-once → fallback-bank → no_action contract is INSIDE `proposeAction` (realize),
 * NOT modeled as graph cycles — behaviour-preservation is a pure function, not re-derived.
 */

// ---------------------------------------------------------------------------
// State annotation: the 5 channels threaded through the graph
// ---------------------------------------------------------------------------

const FlowState = Annotation.Root({
  input:       Annotation<AgentInput>(),
  memoryIn:    Annotation<DeliberationMemory>({ default: emptyMemory, reducer: (_p, n) => n }),
  classification: Annotation<string | undefined>({ default: () => undefined, reducer: (_p, n) => n }),
  intent:      Annotation<string | undefined>({ default: () => undefined, reducer: (_p, n) => n }),
  action:      Annotation<Action | null>({ reducer: (_prev, next) => next, default: () => null }),
  memoryOut:   Annotation<DeliberationMemory | undefined>({ default: () => undefined, reducer: (_p, n) => n }),
});

// ---------------------------------------------------------------------------
// proposeAction: the realize node's inner body — unchanged retry/fallback contract
// ---------------------------------------------------------------------------

/** The fallback rep for an item-bearing turn: prefer the rep the learner is
 *  currently working in, else truth_table. */
function preferredRep(input: AgentInput): 'truth_table' | 'circuit' | 'pseudocode' {
  const ev = input.event;
  if (ev.kind === 'submit' && ev.repSubmission) return ev.repSubmission.rep;
  return 'truth_table';
}

/** Run the model with at most one Layer-2-driven retry, then the fallback bank,
 *  then `no_action`. Returns a validated, compiled wire Action — never malformed.
 *
 *  F-29 SEAM: when F-29 plugs in, it replaces the `provider.proposeMove` call for
 *  `intent === 'practice'` with a validator-gated generated item. The rest of this
 *  function (retry, fallback, no_action) remains unchanged. */
export async function proposeAction(
  provider: MoveProvider,
  input: AgentInput,
  deliberation?: DeliberationContext,
): Promise<Action> {
  let lastDetail: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    let action: Action;
    try {
      const move = await provider.proposeMove(input, lastDetail, deliberation);
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

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

/** Build the compiled inner-agent graph for a given provider. Compile once per
 *  provider (the provider is stable for the client's lifetime); `FlowAgentClient`
 *  caches the compiled graph and invokes it per turn. */
export function buildAgentGraph(provider: MoveProvider) {
  return new StateGraph(FlowState)

    // Node 1: assess — classify learner progress from the server-derived snapshot only
    .addNode('assess', (state) => ({
      classification: assess(state.input.learnerState, state.memoryIn) as string,
    }))

    // Node 2: decide — advisory pedagogical intent from the classification
    .addNode('decide', (state) => ({
      intent: decide(
        state.classification as Parameters<typeof decide>[0],
        state.memoryIn,
      ) as string,
    }))

    // Node 3: realize — call the provider with full deliberation context
    //         *** F-29 SEAM: generation plugs in here ***
    .addNode('realize', async (state) => {
      const deliberation: DeliberationContext = {
        classification: state.classification as DeliberationContext['classification'],
        intent: state.intent as DeliberationContext['intent'],
        memory: state.memoryIn,
      };
      return {
        action: await proposeAction(provider, state.input, deliberation),
      };
    })

    // Node 4: validate — explicit Layer-2 re-affirmation (the contract is byte-for-byte
    //         unchanged; this node makes the invariant visible in the topology so any
    //         future realize override (F-29) can't accidentally bypass it).
    .addNode('validate', (state) => {
      if (state.action && state.action.type !== 'no_action') {
        const v = validateLayer2(state.action);
        if (!v.ok) {
          // The proposeAction body already retried and fell back; if we reach here
          // with an invalid action that somehow bypassed it, fail safe.
          return {
            action: noAction('agent_unsure', `validate node: Layer-2 re-check failed: ${v.detail}`),
          };
        }
      }
      return {};  // pass through
    })

    // Node 5: emit — build memoryOut from the action + current memory
    .addNode('emit', (state) => {
      const prev = state.memoryIn;
      const memoryOut: DeliberationMemory = {
        lastIntent: state.intent as DeliberationMemory['lastIntent'],
        lastClassification: state.classification as DeliberationMemory['lastClassification'],
        lastDifficultyTier: prev.lastDifficultyTier,  // unchanged unless realize sets it
        regenerationCount: prev.regenerationCount,
        turnCount: prev.turnCount + 1,
      };
      return { memoryOut };
    })

    // Linear edges: assess → decide → realize → validate → emit
    .addEdge('__start__', 'assess')
    .addEdge('assess', 'decide')
    .addEdge('decide', 'realize')
    .addEdge('realize', 'validate')
    .addEdge('validate', 'emit')
    .addEdge('emit', '__end__')
    .compile();
}
