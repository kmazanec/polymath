import { type Action, noAction } from '@polymath/contract';
import type { AgentClient, AgentInput, MoveProvider } from './client.js';
import { buildAgentGraph } from './graph.js';
import { type DeliberationMemory, emptyMemory } from './deliberation.js';

/**
 * The provider-agnostic `AgentClient`: runs the inner-agent flow (graph + the
 * ADR-010 retry/fallback contract) against an injected `MoveProvider`. Production
 * passes `OpenAIMoveProvider` (via `makeAgentClient`); tests pass a deterministic
 * double.
 *
 * F-28: a per-session `DeliberationMemory` Map is maintained here (D3: in-process,
 * size-capped, lost on restart — it is a cache, NOT an integrity source). The graph
 * receives `memoryIn` each turn and returns `memoryOut`; this class threads them
 * across turns so the 5-node graph has cross-turn context without persisting to DB.
 *
 * **Memory is advisory only.** BKT/streak/gates are the server-derived integrity fold
 * and live in the DB. The memory map here lets the agent modulate its *style* (e.g.
 * last intent, turn count) but can never influence gate outcomes or mastery decisions.
 *
 * The LangGraph graph is compiled **once** (the provider is stable for the client's
 * lifetime), not per turn — `propose` just invokes the compiled graph.
 */

/** Maximum number of live sessions whose memory we track. Old entries are evicted
 *  (oldest-first) when the map exceeds this size. */
const MEMORY_CAP = 1000;

export class FlowAgentClient implements AgentClient {
  private readonly graph: ReturnType<typeof buildAgentGraph>;
  /** Per-session deliberation memory. Cache only — never read for any gate/integrity
   *  path. Size-capped at MEMORY_CAP. */
  private readonly memory = new Map<string, DeliberationMemory>();

  constructor(provider: MoveProvider) {
    this.graph = buildAgentGraph(provider);
  }

  async propose(input: AgentInput): Promise<Action> {
    const sessionId = input.event.sessionId;

    // Read the stored memory for this session (or start fresh).
    const memoryIn = this.memory.get(sessionId) ?? emptyMemory();

    const result = await this.graph.invoke({ input, memoryIn });

    // Persist the updated memory from the emit node.
    if (result.memoryOut) {
      // Evict the oldest entry if we hit the cap (Map insertion-order eviction).
      if (this.memory.size >= MEMORY_CAP && !this.memory.has(sessionId)) {
        const oldest = this.memory.keys().next().value;
        if (oldest !== undefined) this.memory.delete(oldest);
      }
      this.memory.set(sessionId, result.memoryOut);
    }

    return result.action ?? noAction('agent_unsure', 'graph produced no action');
  }

  /** Remove the memory entry for a session (call on session end to free memory).
   *  This is advisory cleanup — there is no integrity consequence of not calling it. */
  releaseSession(sessionId: string): void {
    this.memory.delete(sessionId);
  }
}
