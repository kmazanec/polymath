import { Annotation, StateGraph } from '@langchain/langgraph';
import { type Action, noAction } from '@polymath/contract';
import type { AgentInput, MoveProvider } from './client.js';
import { compileMove, type ProposedItem, type TacticalMove } from './menu.js';
import { validateLayer2 } from './layer2.js';
import { loadFallbackBank, pickFallbackItem } from '../fallback_bank/index.js';
import type { DeliberationContext, DeliberationMemory } from './deliberation.js';
import { emptyMemory } from './deliberation.js';
import { assess, decide } from './deliberationNodes.js';
import { checkGeneratedItem } from './rails.js';

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

/** Extract the `ProposedItem` from an item-bearing move, or null for non-item moves. */
function itemOf(move: TacticalMove): ProposedItem | null {
  switch (move.move) {
    case 'next_practice_item':
    case 'simpler_item':
    case 'rephrase':
      return move.item;
    case 'alt_representation':
      return move.item;
    default:
      return null;
  }
}

/**
 * F-29: Engine-owns-key overwrite gate.
 *
 * Applied to EVERY item-bearing move from EVERY provider (idempotent for authored
 * items that already carry the correct key; defensive for generated items whose
 * key the model asserts). Returns:
 *  - `{ok: true, move}` with `item.claimedTruthTable` overwritten by the engine key.
 *  - `{ok: false, detail}` when the item fails the generation rails (over-cap,
 *    unparseable, out-of-alphabet, prompt-less, over-lesson-max-vars).
 *
 * INVARIANT: Layer-2 stays BYTE-FOR-BYTE UNCHANGED (layer2.ts is not modified).
 * Because the engine overwrites the key BEFORE compileMove, Layer-2 always sees
 * the correct table — so a "wrong-key" adversarial test asserts the OVERWRITE
 * (the mounted spec carries the computed key), not a Layer-2 rejection.
 *
 * NOTE: TransferProbe is not item-bearing in the menu (it has its own move kind
 * `propose_transfer_probe`), so it is NOT processed here. Transfer bank stays
 * hand-curated and read-only — generation never produces a probe.
 */
function applyEngineKey(
  move: TacticalMove,
  input: AgentInput,
): { ok: true; move: TacticalMove } | { ok: false; detail: string } {
  const item = itemOf(move);
  if (!item) {
    // Not an item-bearing move — nothing to overwrite
    return { ok: true, move };
  }

  // Run rails check: validates alphabet, prompt presence, var-cap, lesson-max-vars.
  // On success: returns the engine-computed key.
  const validity = checkGeneratedItem(
    { expression: item.targetExpression, prompt: item.prompt },
    input,
  );

  if (!validity.ok) {
    return { ok: false, detail: validity.detail };
  }

  // Overwrite the model's asserted claimedTruthTable with the engine-computed key.
  const engineItem: ProposedItem = { ...item, claimedTruthTable: validity.table };

  // Reattach the overwritten item to the move. The move shape is discriminated by
  // `move.move`; we need to update `item` (or in the alt_representation case, the
  // original item that gets re-repped in compileMove).
  let engineMove: TacticalMove;
  switch (move.move) {
    case 'next_practice_item':
      engineMove = { ...move, item: engineItem };
      break;
    case 'simpler_item':
      engineMove = { ...move, item: engineItem };
      break;
    case 'rephrase':
      engineMove = { ...move, item: engineItem };
      break;
    case 'alt_representation':
      engineMove = { ...move, item: engineItem };
      break;
    default:
      // Non-item move — unreachable given the itemOf check above
      engineMove = move;
  }

  return { ok: true, move: engineMove };
}

/** Run the model with at most one generation-rails-driven retry, then the fallback
 *  bank, then `no_action`. Returns a validated, compiled wire Action — never malformed.
 *
 *  F-29: the engine-owns-key overwrite is applied here, between `proposeMove` and
 *  `compileMove`, for EVERY item-bearing move from EVERY provider. The rails check
 *  (alphabet, prompt, var-cap, lesson-max-vars) rejects invalid items and drives the
 *  retry. Layer-2 (validateLayer2) stays BYTE-FOR-BYTE UNCHANGED. */
export async function proposeAction(
  provider: MoveProvider,
  input: AgentInput,
  deliberation?: DeliberationContext,
): Promise<Action> {
  let lastDetail: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    let action: Action;
    try {
      const rawMove = await provider.proposeMove(input, lastDetail, deliberation);

      // F-29: Engine-owns-key gate — validate rails + overwrite claimedTruthTable.
      // Applied to ALL item-bearing moves from ALL providers.
      const gated = applyEngineKey(rawMove, input);
      if (!gated.ok) {
        lastDetail = `generation rails rejected: ${gated.detail}`;
        continue;
      }

      action = compileMove(gated.move);
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
