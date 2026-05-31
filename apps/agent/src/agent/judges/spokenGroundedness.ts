import { z } from 'zod';

/**
 * F-32 / ADR-017: The spoken-turn groundedness judge. A sibling of
 * `OpenAIExplainBackJudge` in `@polymath/graph`, adapted for the spoken-turn
 * use case (F-30).
 *
 * **What it judges:** given a learner's spoken question and the agent's answer,
 * is the answer factually grounded in Boolean logic? It does NOT judge correctness
 * of the learner's Boolean submission (that is Layer 1/Layer 2); it assesses
 * whether the agent's spoken-turn ANSWER is accurate and grounded.
 *
 * **Design mirrors the explain-back judge:**
 * - Key-gated: throws on a missing `OPENAI_API_KEY` (fail closed).
 * - Structured output via `withStructuredOutput` (the same pattern as `openaiClient.ts`).
 * - Pure function for prompt-building, exported for offline tests.
 * - `makeSpokenGroundednessJudge` factory: returns the judge when a key is present,
 *   `undefined` otherwise — exactly the `makeExplainBackJudge` pattern.
 *
 * **CI policy (ADR-017):** the live gate (≥90% agreement) runs ONLY in the
 * `agent_live_eval` CI job (protected main, `when:never` on MRs). Self-skips
 * without `OPENAI_API_KEY`. Offline fixture classification (topic ≠ groundedness)
 * is deterministic and runs in the keyless `agent_test` job.
 */

const GroundednessSchema = z.object({
  /** The answer is factually accurate about the Boolean logic topic in the question. */
  factuallyAccurate: z.boolean(),
  /** The answer is grounded in Boolean logic (not generic filler or a deflection of
   *  an on-topic question). For off-topic deflections the expected answer IS a
   *  redirect, which is still "grounded" (correct behavior). */
  grounded: z.boolean(),
  /** Overall verdict: the answer is appropriate for the question. */
  overall: z.boolean(),
});
type GroundednessJudgment = z.infer<typeof GroundednessSchema>;

/** Build the groundedness judge prompt. Exported for offline tests. */
export function buildGroundednessPrompt(question: string, answer: string): string {
  return [
    'You are evaluating whether a Boolean-logic tutor\'s spoken answer is factually accurate and grounded.',
    '',
    `Learner question: "${question}"`,
    `Tutor answer: "${answer}"`,
    '',
    'Judge each criterion independently and conservatively:',
    '- factuallyAccurate: is the factual content of the answer correct? (For off-topic deflections, a redirect is correct behavior and counts as accurate.)',
    '- grounded: does the answer address the question appropriately? (A redirect for an off-topic question is grounded; a vague non-answer for an on-topic Boolean question is not.)',
    '- overall: would a student asking this question receive a helpful, accurate response?',
    '',
    'Boolean logic correctness criteria:',
    '- AND: output is 1 only when ALL inputs are 1.',
    '- OR: output is 1 when ANY input is 1 (false only when all inputs are 0).',
    '- NOT: inverts the input (0→1, 1→0).',
    '- XOR: output is 1 when inputs DIFFER.',
    '- NAND: NOT AND (output is 0 only when all inputs are 1).',
    '- NOR: NOT OR (output is 0 when any input is 1).',
    '',
    'A wrong Boolean rule (e.g. "AND is true when either input is true") must be marked factuallyAccurate:false.',
  ].join('\n');
}

/**
 * The key-gated OpenAI implementation of the spoken groundedness judge.
 * Constructed ONLY when a key is present (throws on missing key — fail closed).
 */
export class OpenAISpokenGroundednessJudge {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error('OpenAISpokenGroundednessJudge requires OPENAI_API_KEY');
    }
    this.apiKey = apiKey;
    this.model = opts.model ?? process.env['OPENAI_JUDGE_MODEL'] ?? 'gpt-4o-mini';
  }

  /**
   * Judge whether a tutor answer is grounded and factually accurate.
   * Returns `true` if the answer passes (overall + factuallyAccurate must both hold).
   * Returns `false` on any failure — fail closed is the right behavior for an
   * eval oracle.
   */
  async isGrounded(question: string, answer: string): Promise<boolean> {
    const { ChatOpenAI } = await import('@langchain/openai');
    const llm = new ChatOpenAI({
      apiKey: this.apiKey,
      model: this.model,
      temperature: 0,
    }).withStructuredOutput(GroundednessSchema, { name: 'groundedness_judgment' });

    const judgment = (await llm.invoke(
      buildGroundednessPrompt(question, answer),
    )) as GroundednessJudgment;

    // Conjoin the criteria server-side (same pattern as the explain-back judge):
    // overall alone is not sufficient — the LLM can self-contradict. Require both
    // overall AND factuallyAccurate for the verdict to pass.
    return judgment.overall && judgment.factuallyAccurate;
  }
}

/** Factory: construct the judge when a key is present, else `undefined` (fail closed). */
export function makeSpokenGroundednessJudge(
  opts: { apiKey?: string; model?: string } = {},
): OpenAISpokenGroundednessJudge | undefined {
  const apiKey = opts.apiKey ?? process.env['OPENAI_API_KEY'];
  if (!apiKey) return undefined;
  return new OpenAISpokenGroundednessJudge({ ...opts, apiKey });
}
