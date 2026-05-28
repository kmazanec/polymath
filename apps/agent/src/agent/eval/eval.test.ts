import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentInput } from '../client.js';
import { HeuristicMoveProvider } from '../stubClient.js';
import { OpenAIMoveProvider } from '../openaiClient.js';
import { loadLesson } from '../../lessons/loader.js';

/**
 * F-05 criterion 8: the inner-agent eval gate (≥95% agreement on labelled
 * scenarios). The live gate runs through the real OpenAI provider and is **skipped
 * without `OPENAI_API_KEY`** (the CI gate runs it when the key is present). The
 * deterministic subset is always asserted against the key-free heuristic provider,
 * so the labelled data is exercised offline and cannot silently rot.
 */

interface Scenario {
  id: string;
  event: Record<string, unknown>;
  learnerState: { consecutiveCorrect: number; hintsUsed: number; ruleGatePassed: boolean };
  transferCandidates?: AgentInput['transferCandidates'];
  expectMove?: string;
  expectMoveOneOf?: string[];
  expectTopic?: 'on_topic' | 'off_topic';
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const scenarios: Scenario[] = JSON.parse(
  fs.readFileSync(path.join(dir, 'scenarios.json'), 'utf8'),
).scenarios;
const lesson = loadLesson(1);
const SID = '00000000-0000-0000-0000-000000000000';

function inputFor(s: Scenario): AgentInput {
  return {
    event: { sessionId: SID, ...s.event } as AgentInput['event'],
    lesson,
    learnerState: { bktByKc: {}, ...s.learnerState },
    recentHistory: [],
    transferCandidates: s.transferCandidates,
  };
}

function matches(move: { move: string; topicClassification?: string }, s: Scenario): boolean {
  if (s.expectMove && move.move !== s.expectMove) return false;
  if (s.expectMoveOneOf && !s.expectMoveOneOf.includes(move.move)) return false;
  if (s.expectTopic && move.topicClassification !== s.expectTopic) return false;
  return true;
}

describe('inner-agent eval scenarios', () => {
  // The heuristic provider is deterministic; it must agree with every labelled
  // scenario (this keeps the data honest without a key).
  it('the key-free heuristic provider agrees with every labelled scenario', async () => {
    const provider = new HeuristicMoveProvider();
    for (const s of scenarios) {
      const move = await provider.proposeMove(inputFor(s));
      expect(matches(move, s), `heuristic disagreed on "${s.id}" (got ${move.move})`).toBe(true);
    }
  });

  // The live LLM gate (criterion 8). Skipped without a key.
  const liveIt = process.env.OPENAI_API_KEY ? it : it.skip;
  liveIt('the OpenAI provider agrees on ≥95% of labelled scenarios (live gate)', async () => {
    const provider = new OpenAIMoveProvider();
    let agree = 0;
    for (const s of scenarios) {
      const move = await provider.proposeMove(inputFor(s));
      if (matches(move, s)) agree++;
    }
    expect(agree / scenarios.length).toBeGreaterThanOrEqual(0.95);
  }, 60_000);
});
