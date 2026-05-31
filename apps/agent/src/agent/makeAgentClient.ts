import type { AgentClient } from './client.js';
import { FlowAgentClient } from './flowClient.js';
import { OpenAIMoveProvider } from './openaiClient.js';
import { StubAgentClient } from './stubClient.js';

/**
 * Self-gating factory for the production `AgentClient` (F-28 / ADR-006 / D2).
 *
 * Mirrors the `makeExplainBackJudge` / `makeOpenAiBaselineChatProvider` pattern:
 * when `OPENAI_API_KEY` is present → `FlowAgentClient(new OpenAIMoveProvider())`
 * (the real LLM path); when it is absent → `StubAgentClient` (the heuristic,
 * keyless path — unchanged behaviour from pre-F-28).
 *
 * This closes the production wiring gap identified in the BUILD-PLAN: before F-28,
 * `apps/agent/src/index.ts:44` hardcoded `new StubAgentClient()`, so
 * `OpenAIMoveProvider` was constructed in NO production code (only in eval.test.ts).
 * After F-28, `index.ts` calls `makeAgentClient()` and AC#4 becomes satisfiable.
 *
 * Tests construct clients directly (no factory call) so no key is needed in MR
 * pipelines (CLAUDE.md: never inject a provider secret into MR-reachable CI jobs).
 */
export function makeAgentClient(): AgentClient {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (apiKey) {
    console.log('[polymath] agent provider: OpenAI (OPENAI_API_KEY set)');
    return new FlowAgentClient(new OpenAIMoveProvider({ apiKey }));
  }
  console.log('[polymath] agent provider: heuristic (no OPENAI_API_KEY — keyless path)');
  return new StubAgentClient();
}
