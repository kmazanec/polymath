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

/** Deadline on the LLM judge call. `llm.invoke()` has no timeout of its own, and the
 *  explain-back route returns from the WS handler BEFORE the generic agent-turn
 *  timeout (which only wraps `proposeMove`). A hung/slow OpenAI call would otherwise
 *  block the explain-back frame indefinitely (violating AC#5 "verdict within ~2s").
 *  On timeout the judge resolves to `judge_unavailable` — fail closed, never a hang.
 *  Generous vs. the ~2s target so a normal call is never cut off. */
const JUDGE_TIMEOUT_MS = 10_000;

/** Race a promise against a deadline. The timer is unref'd-equivalent (cleared on
 *  settle) so it never keeps the event loop alive. On timeout the fallback resolves. */
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout());
    }, ms);
    p.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(onTimeout());
      },
    );
  });
}

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
      // Race the judge against a deadline: a hung/slow LLM call must not block the
      // explain-back WS frame (AC#5). On timeout → `judge_unavailable` (fail closed).
      const result = await withTimeout(
        judge.judge({
          transcript: state.input.transcript,
          itemTokens: state.input.itemTokens,
          kcVocabulary: state.input.kcVocabulary,
          ...(state.input.prosody ? { prosody: state.input.prosody } : {}),
        }),
        JUDGE_TIMEOUT_MS,
        () => null,
      );
      if (result === null) {
        // Timed out — fail closed (never a degraded pass on a hung judge).
        return { verdict: { passed: false, reasons: ['judge_unavailable'] } };
      }
      const { passed, subScores } = result;
      if (passed) {
        return { verdict: { passed: true, reasons: [], llmJudgmentDetail: subScores } };
      }
      return { verdict: { passed: false, reasons: [JUDGE_FAILED], llmJudgmentDetail: subScores } };
    } catch {
      // No key / rate limit / malformed structured output → fail closed.
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
