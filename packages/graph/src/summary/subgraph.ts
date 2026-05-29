import { END, START, StateGraph } from '@langchain/langgraph';
import { SessionSummarySchema, type SessionSummary } from '@polymath/contract';
import { computeGrowthMultiplier } from './growth.js';

/**
 * The session-summary pipeline (the producer behind `GET /api/session/:id/report`
 * and the cross-cutting `SessionSummarySchema` seam — the metrics dashboard and
 * future session-wrap / handoff UIs read its output).
 *
 * Like the explain-back subgraph, this is a compile-once LangGraph `StateGraph`
 * and is PURE: it imports NO Drizzle / DB. The agent does all the I/O (loads the
 * session row, experiment pre/post tables, the bounded event fold, learner_state)
 * and passes the already-assembled numbers in as `SummaryInput`. Keeping the
 * pipeline DB-free is what lets F-24/F-25 reuse it without dragging in agent deps
 * (the same separation `explainback/` keeps).
 *
 * EVERYTHING is deterministic and fails closed (CLAUDE.md): no LLM call, a missing
 * pre-test ⇒ `growthMultiplier:null` (never a fabricated 0), no transfer probes ⇒
 * a `0` rate (never `NaN`), and the assembled shape is `SessionSummarySchema.parse`d
 * before it leaves so a drift is caught at this boundary.
 */

/** The pre-assembled inputs the agent hands the pipeline. The agent owns the DB
 *  reads (experiment tables vs. the event fold); the pipeline owns the composition
 *  (provenance, growth, the transfer rate, the contract shape). */
export interface SummaryInput {
  /** Pre-test fraction-correct in [0,1], or null when no pre-test was taken. Only
   *  meaningful on an experiment arm. */
  preTestScore: number | null;
  /** Post-test fraction-correct in [0,1] (experiment arm), or the in-session post
   *  score from the fold, or null. */
  postTestScore: number | null;
  /** Whether this session is linked to an experiment subject (pre/post tables).
   *  Drives `source`: an arm ⇒ 'experiment' even if its pre-test wasn't run. */
  hasExperimentArm: boolean;
  /** Total engaged time on task, in milliseconds (agent computes from the session
   *  start/end or last event). Guarded to a finite, non-negative number here. */
  timeOnTaskMs: number;
  /** Transfer probe tally: passed and total seen this session. `total === 0` ⇒
   *  rate 0 (no probes earned yet), never a NaN division. */
  transferProbes: { passed: number; total: number };
  /** The session's terminal mastery status (latched from learner_state; default
   *  `not_started`). A fail-soft default is never a pass. */
  masteryStatus: SessionSummary['masteryStatus'];
  /** The latched explain-back verdict (the integrity boundary), reported verbatim. */
  explainBackVerdict: SessionSummary['explainBackVerdict'];
  kcsMastered: string[];
  kcsStuck: string[];
}

/** The graph's mutable channel state. */
interface GraphState {
  input: SummaryInput;
  summary: SessionSummary | undefined;
}

/** Guard a value to a finite number, falling back when it is NaN/Infinity/missing. */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function buildGraph() {
  const graph = new StateGraph<GraphState>({
    channels: {
      input: { value: (_x: SummaryInput, y: SummaryInput) => y },
      summary: {
        value: (_x: SessionSummary | undefined, y: SessionSummary | undefined) => y,
        default: () => undefined,
      },
    },
  });

  // Single composition node: deterministic assembly. (One node keeps the topology
  // honest to the StateGraph pattern while leaving room for a future enrichment node
  // — e.g. an LLM narrative — to slot in front of `END` without re-plumbing callers.)
  graph.addNode('compose', (state: GraphState): Partial<GraphState> => {
    const { input } = state;
    const source = input.hasExperimentArm ? 'experiment' : 'in_session';
    // Pre-test is only meaningful on an experiment arm; an in-session summary has
    // no baseline (null), which makes growth null (computeGrowthMultiplier).
    const preTestScore = input.hasExperimentArm ? input.preTestScore : null;
    const growthMultiplier = computeGrowthMultiplier(preTestScore, input.postTestScore);
    const { passed, total } = input.transferProbes;
    // total === 0 ⇒ 0 (no probes earned), never a 0/0 NaN crossing the contract.
    const transferSuccessRate = total > 0 ? finiteOr(passed / total, 0) : 0;

    const summary: SessionSummary = {
      preTestScore,
      postTestScore: input.postTestScore,
      growthMultiplier,
      timeOnTaskMs: Math.max(0, finiteOr(input.timeOnTaskMs, 0)),
      transferSuccessRate,
      masteryStatus: input.masteryStatus,
      explainBackVerdict: input.explainBackVerdict,
      kcsMastered: input.kcsMastered,
      kcsStuck: input.kcsStuck,
      source,
    };
    return { summary };
  });

  graph.addEdge(START, 'compose' as typeof START);
  graph.addEdge('compose' as typeof START, END);
  return graph.compile();
}

// Compile once — the topology is static (mirrors explainback/subgraph.ts).
const compiled = buildGraph();

/**
 * Run the summary pipeline against pre-assembled inputs. Drives the real StateGraph
 * fold and validates the result through `SessionSummarySchema` (so a drifting
 * producer is caught here, not silently shipped). Never throws into the caller: any
 * graph/parse failure is downgraded to a fail-closed summary (null scores, empty KC
 * lists, a not-passed verdict) tagged with the input's provenance.
 */
export async function buildSessionSummary(input: SummaryInput): Promise<SessionSummary> {
  try {
    const final = (await compiled.invoke({ input, summary: undefined })) as GraphState;
    const summary = final.summary;
    if (!summary) return failClosed(input);
    return SessionSummarySchema.parse(summary);
  } catch {
    return failClosed(input);
  }
}

/** A fail-closed summary: nothing fabricated, provenance preserved. */
function failClosed(input: SummaryInput): SessionSummary {
  return SessionSummarySchema.parse({
    preTestScore: null,
    postTestScore: null,
    growthMultiplier: null,
    timeOnTaskMs: Math.max(0, finiteOr(input.timeOnTaskMs, 0)),
    transferSuccessRate: 0,
    masteryStatus: 'not_started',
    explainBackVerdict: { passed: false, reasons: [] },
    kcsMastered: [],
    kcsStuck: [],
    source: input.hasExperimentArm ? 'experiment' : 'in_session',
  } satisfies SessionSummary);
}
