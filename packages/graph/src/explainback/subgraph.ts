import { END, START, StateGraph } from '@langchain/langgraph';
import type { ExplainBackVerdict, PreconditionReason } from '@polymath/contract';
import { checkPreconditions, type PreconditionInput } from './preconditions.js';
import type { ExplainBackJudge } from './judge.js';
import type { ProsodyFeatures } from './prosody.js';

/**
 * The explain-back rubric subgraph (ADR-010 Layer 4): a LangGraph StateGraph that
 * runs the 5 deterministic preconditions, then conditionally either emits a
 * precondition-fail verdict (NO LLM) or invokes the LLM judge and emits its verdict.
 *
 * EVERYTHING FAILS CLOSED (CLAUDE.md integrity invariant):
 *   - any precondition fails           → { passed:false, reasons:[<precondition>] }, no judge call
 *   - no judge injected (no key)        → { passed:false, reasons:['judge_unavailable'] }
 *   - the judge throws/times out        → { passed:false, reasons:['judge_unavailable'] }
 *   - the judge returns passed:false    → { passed:false, reasons:['judge_failed'], detail }
 * A missing input is BLOCK, never a degraded pass.
 */

export interface ExplainBackInput extends PreconditionInput {
  prosody?: ProsodyFeatures;
}

export interface ExplainBackDeps {
  /** The LLM judge. Absent (no key) → the verdict is `judge_unavailable` (fail closed). */
  judge?: ExplainBackJudge;
}

/** The graph's mutable channel state. */
interface GraphState {
  input: ExplainBackInput;
  deps: ExplainBackDeps;
  verdict: ExplainBackVerdict | undefined;
}

/** Non-precondition fail reason used when the judge ran but did not pass. Not part
 *  of `PreconditionReason` (that union is the deterministic/fail-closed reasons);
 *  the verdict's `reasons` is a free `string[]`, so this is a content-fail tag. */
const JUDGE_FAILED = 'judge_failed';

function buildGraph() {
  const graph = new StateGraph<GraphState>({
    channels: {
      input: { value: (_x: ExplainBackInput, y: ExplainBackInput) => y },
      deps: { value: (_x: ExplainBackDeps, y: ExplainBackDeps) => y },
      verdict: {
        value: (_x: ExplainBackVerdict | undefined, y: ExplainBackVerdict | undefined) => y,
        default: () => undefined,
      },
    },
  });

  // Node: deterministic preconditions (Stage 4a).
  graph.addNode('preconditions', (state: GraphState): Partial<GraphState> => {
    const result = checkPreconditions(state.input);
    if (!result.passed) {
      const reason = (result.failedReason ?? 'no_item_reference') as PreconditionReason;
      return { verdict: { passed: false, reasons: [reason] } };
    }
    return {}; // preconditions clear → no verdict yet; the judge runs
  });

  // Node: LLM judge (Stage 4b). Only reached when preconditions passed. Fail closed
  // on a missing judge or any throw.
  graph.addNode('judge', async (state: GraphState): Promise<Partial<GraphState>> => {
    const judge = state.deps.judge;
    if (!judge) {
      return { verdict: { passed: false, reasons: ['judge_unavailable'] } };
    }
    try {
      const { passed, subScores } = await judge.judge({
        transcript: state.input.transcript,
        itemTokens: state.input.itemTokens,
        kcVocabulary: state.input.kcVocabulary,
        ...(state.input.prosody ? { prosody: state.input.prosody } : {}),
      });
      if (passed) {
        return { verdict: { passed: true, reasons: [], llmJudgmentDetail: subScores } };
      }
      return { verdict: { passed: false, reasons: [JUDGE_FAILED], llmJudgmentDetail: subScores } };
    } catch {
      // No key / rate limit / timeout / malformed structured output → fail closed.
      return { verdict: { passed: false, reasons: ['judge_unavailable'] } };
    }
  });

  graph.addEdge(START, 'preconditions' as typeof START);
  // Conditional edge: if the preconditions node already set a (fail) verdict, end;
  // otherwise run the judge.
  graph.addConditionalEdges('preconditions' as typeof START, (state: GraphState) =>
    state.verdict ? 'done' : 'judge',
    { done: END, judge: 'judge' as typeof END },
  );
  graph.addEdge('judge' as typeof START, END);

  return graph.compile();
}

// Compile once — the graph topology is static.
const compiled = buildGraph();

/**
 * Run the explain-back rubric. Drives the real StateGraph fold (not a hand-set
 * verdict). Returns a frozen `ExplainBackVerdict`. Any unexpected graph error is
 * caught and downgraded to `judge_unavailable` — the subgraph can never throw into
 * the caller (the route persists whatever this returns; a throw would lose the row).
 */
export async function runExplainBack(
  input: ExplainBackInput,
  deps: ExplainBackDeps = {},
): Promise<ExplainBackVerdict> {
  try {
    const final = (await compiled.invoke({ input, deps, verdict: undefined })) as GraphState;
    return final.verdict ?? { passed: false, reasons: ['judge_unavailable'] };
  } catch {
    return { passed: false, reasons: ['judge_unavailable'] };
  }
}
