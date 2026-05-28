import { z } from 'zod';
import type { ProsodyFeatures } from './prosody.js';

/**
 * Stage 4b — the explain-back LLM-as-judge (ADR-010 Layer 4b). Only ever invoked
 * AFTER the 5 deterministic preconditions pass. It scores a small set of yes/no
 * criteria (not free-form): is the explanation item-specific vs memorised-generic,
 * does it show item-specific reasoning, does prosody read as thinking-not-reading,
 * and an overall pass.
 *
 * Like `MoveProvider`, this is a DI seam: tests inject a deterministic double; the
 * real `@langchain/openai` impl is key-gated and only constructed when a key is
 * present. A missing key → no judge passed to `runExplainBack` → `judge_unavailable`
 * (fail closed). The judge NEVER decides correctness of the Boolean answer — that
 * is Layer 1/5; the judge assesses the *explanation*.
 */

export interface ExplainBackJudgeInput {
  transcript: string;
  /** THIS item's variable names + operators (the reasoning must reference them). */
  itemTokens: string[];
  /** Generic lesson KC terms. */
  kcVocabulary: string[];
  /** Disfluency signals for the thinking-vs-reading judgment (AC#10); optional. */
  prosody?: ProsodyFeatures;
}

export interface ExplainBackJudgeResult {
  passed: boolean;
  /** Opaque ADR-010 sub-scores, surfaced into `ExplainBackVerdict.llmJudgmentDetail`. */
  subScores: Record<string, boolean | number>;
}

export interface ExplainBackJudge {
  judge(input: ExplainBackJudgeInput): Promise<ExplainBackJudgeResult>;
}

/** The structured-output schema the LLM must fill (ADR-010 Layer 4b criteria). Each
 *  criterion is judged independently; `overall` is the verdict the rubric emits. */
export const JudgeSchema = z.object({
  /** memorised-generic (false) vs item-specific (true). */
  itemSpecific: z.boolean(),
  /** correctly describes the Boolean reasoning used for THIS item. */
  itemSpecificReasoning: z.boolean(),
  /** prosody matches thinking-while-speaking, not reading from elsewhere. */
  prosodyThinking: z.boolean(),
  /** overall pass (the conjunction the judge asserts). */
  overall: z.boolean(),
});
export type JudgeJudgment = z.infer<typeof JudgeSchema>;

/** Build the judge's user prompt from the explanation + the ADR-010 criteria. Kept
 *  pure + exported so the eval bank can assert on it without a live call. */
export function buildJudgePrompt(input: ExplainBackJudgeInput): string {
  const prosody = input.prosody;
  const prosodyLine = prosody
    ? `Prosody signals — filled pauses: ${prosody.filledPauses}, mid-utterance silences: ${prosody.midUtteranceSilences}, restarts: ${prosody.restarts}.`
    : 'Prosody signals — none captured.';
  return [
    'You are grading a learner\'s spoken explanation of how THEY solved a Boolean-logic problem.',
    `The problem involved these tokens (variables + operators): ${input.itemTokens.join(', ') || '(none)'}.`,
    `Lesson vocabulary: ${input.kcVocabulary.join(', ') || '(none)'}.`,
    prosodyLine,
    '',
    'Transcript:',
    input.transcript,
    '',
    'Judge each criterion independently and conservatively. A generic explanation that',
    'never engages with THIS problem\'s specific variables should NOT pass. Reading from',
    'a script (no disfluency, perfectly fluent recitation of a memorised template) should',
    'lower prosodyThinking.',
  ].join('\n');
}

/**
 * The key-gated `@langchain/openai` implementation. Constructed ONLY when a key is
 * present (the caller decides; this throws on a missing key so a half-configured
 * deploy fails closed rather than emitting a half-valid judge — CLAUDE.md
 * external-service invariant). The model uses `withStructuredOutput(JudgeSchema)`.
 */
export class OpenAIExplainBackJudge implements ExplainBackJudge {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      // Fail closed: never construct a judge without a key.
      throw new Error('OpenAIExplainBackJudge requires OPENAI_API_KEY');
    }
    this.apiKey = apiKey;
    this.model = opts.model ?? process.env['OPENAI_JUDGE_MODEL'] ?? 'gpt-4o-mini';
  }

  async judge(input: ExplainBackJudgeInput): Promise<ExplainBackJudgeResult> {
    // Imported lazily so the package (and the agent) load without the dep resolving
    // any network/key at module-eval; mirrors the openaiClient lazy pattern.
    const { ChatOpenAI } = await import('@langchain/openai');
    const llm = new ChatOpenAI({
      apiKey: this.apiKey,
      model: this.model,
      temperature: 0,
    }).withStructuredOutput(JudgeSchema, { name: 'explain_back_judgment' });

    const judgment = (await llm.invoke(buildJudgePrompt(input))) as JudgeJudgment;
    // CONJOIN the sub-criteria server-side rather than trusting the model's own
    // `overall` boolean alone. An LLM can self-contradict (emit overall:true while
    // itemSpecific:false); the item-specific reference + reasoning checks are the
    // load-bearing ones (ADR-010 §Tradeoffs). Requiring overall AND itemSpecific AND
    // itemSpecificReasoning makes the integrity boundary robust to a contradictory
    // judgment (fail closed). prosodyThinking is a softer signal — it is recorded but
    // not made a hard gate (prosody may be absent / unreliable on some devices), so a
    // genuine thinking explanation isn't blocked when prosody capture is unavailable. */
    const passed =
      judgment.overall && judgment.itemSpecific && judgment.itemSpecificReasoning;
    return {
      passed,
      subScores: {
        itemSpecific: judgment.itemSpecific,
        itemSpecificReasoning: judgment.itemSpecificReasoning,
        prosodyThinking: judgment.prosodyThinking,
        overall: judgment.overall,
      },
    };
  }
}

/** Construct the real judge when a key is present, else `undefined` (→ the subgraph
 *  yields `judge_unavailable`, fail closed). The single place the agent calls. */
export function makeExplainBackJudge(opts: { apiKey?: string; model?: string } = {}): ExplainBackJudge | undefined {
  const apiKey = opts.apiKey ?? process.env['OPENAI_API_KEY'];
  if (!apiKey) return undefined;
  return new OpenAIExplainBackJudge({ ...opts, apiKey });
}
