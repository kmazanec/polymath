import type { Action, ClientEvent, Lesson } from './types.js';
import type { TacticalMove } from './menu.js';

/**
 * The provider-abstraction seam (ADR-006 / ADR-007). The inner agent's reasoning
 * is behind two layers:
 *
 *  - `MoveProvider` is the raw LLM call: given the turn input, return one
 *    `TacticalMove` from the menu (or throw / return a malformed move). LangChain
 *    `ChatOpenAI`/`ChatAnthropic` plug in here behind structured output, so the
 *    provider can be A/B'd. F-05 ships the OpenAI implementation + a deterministic
 *    test double.
 *  - `AgentClient.propose` is the *flow*: snapshot → classify → call provider →
 *    Layer-2 validate → retry once → fall back → compile to a wire `Action`. It is
 *    what the server calls. The flow is provider-agnostic and fully testable with
 *    a mock provider.
 */

/** Everything the agent needs to decide a turn. Widened from F-01's bare
 *  `ClientEvent` so the flow can read learner state, lesson content, and recent
 *  history (ADR-003: the agent is instantiated fresh per turn with structured
 *  state + recent history, no hidden memory). */
export interface AgentInput {
  event: ClientEvent;
  lesson: Lesson;
  /** Per-KC behavioral snapshot the agent reasons over. F-09 fills this from
   *  `learner_state`; F-05 threads through whatever the server supplies. */
  learnerState: LearnerSnapshot;
  /** Most-recent turns (event + action) for short context; newest last. */
  recentHistory: TurnSummary[];
}

export interface LearnerSnapshot {
  /** BKT estimate per KC (0–1); empty before any submit. */
  bktByKc: Record<string, number>;
  /** Hints requested this session. */
  hintsUsed: number;
  /** Consecutive correct submits on the current item chain. */
  consecutiveCorrect: number;
  /** Whether the rule-gate currently judges the learner ready for a transfer
   *  probe. F-05 leaves this false (F-09 wires the real predicate). */
  ruleGatePassed: boolean;
}

export interface TurnSummary {
  eventKind: string;
  actionType: string;
  rationale: string;
  /** For a `submit` turn: the client-computed correctness verdict, if it was
   *  supplied. Lets the agent see a run of wrong attempts on an item. */
  correct?: boolean;
  /** For an item-bearing turn: the item the turn concerned (canonical
   *  expression), so the agent can tell "wrong twice on the SAME item". */
  itemId?: string;
}

/** The raw model call. Returns one tactical move; may throw or return a value the
 *  flow then validates. A second call carries `validationError` so the model can
 *  correct itself (ADR-010 Layer 2 retry). */
export interface MoveProvider {
  proposeMove(input: AgentInput, validationError?: string): Promise<TacticalMove>;
}

/** What the server calls each turn. */
export interface AgentClient {
  propose(input: AgentInput): Promise<Action>;
}
