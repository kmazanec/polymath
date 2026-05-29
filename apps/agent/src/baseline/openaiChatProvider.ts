import { ChatOpenAI } from '@langchain/openai';
import {
  BASELINE_SYSTEM_PROMPT,
  type BaselineChatProvider,
  type BaselineChatTurn,
} from './chatProvider.js';

/**
 * The GPT-5 baseline chat provider (ADR-011 fairness: the baseline uses the SAME
 * strong model as Polymath, so it is never disadvantaged on model strength).
 *
 * Wired but inert without `OPENAI_API_KEY` — `makeOpenAiBaselineChatProvider`
 * returns `undefined` so the baseline route fails CLOSED with a 503 (the
 * `/api/realtime/session` pattern), never a half-configured success. Tests inject
 * a deterministic double instead (CI is offline; no key).
 */
export class OpenAiBaselineChatProvider implements BaselineChatProvider {
  private readonly model: ChatOpenAI;

  constructor(opts: { apiKey: string; model?: string }) {
    this.model = new ChatOpenAI({
      apiKey: opts.apiKey,
      // Strong model by default (gpt-5), env-overridable like the inner agent.
      model: opts.model ?? process.env['INNER_AGENT_STRONG_MODEL'] ?? 'gpt-5',
    });
  }

  async reply(turn: BaselineChatTurn): Promise<string> {
    const verdictNote =
      turn.verdict === true
        ? 'The learner\'s last message was a CORRECT Boolean expression for the current item.'
        : turn.verdict === false
          ? 'The learner\'s last message was an INCORRECT Boolean expression for the current item.'
          : 'The learner\'s last message was NOT a Boolean expression (a question or prose).';

    const messages: Array<{ role: 'system' | 'assistant' | 'user'; content: string }> = [
      { role: 'system', content: BASELINE_SYSTEM_PROMPT },
      {
        role: 'system',
        content:
          `Current lesson item: ${turn.item.itemId} (knowledge component: ${turn.item.kc}). ` +
          `The target Boolean expression for this item is "${turn.item.targetExpression}". ` +
          'Do NOT reveal the target expression verbatim. ' +
          verdictNote,
      },
      ...turn.history.map((m) => ({
        role: (m.role === 'tutor' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.text,
      })),
      { role: 'user', content: turn.message },
    ];

    const res = await this.model.invoke(messages);
    const content = res.content;
    return typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((c) => (typeof c === 'string' ? c : 'text' in c && typeof c.text === 'string' ? c.text : ''))
            .join('')
        : String(content);
  }
}

/** Construct the GPT-5 provider when `OPENAI_API_KEY` is set; else `undefined` so
 *  the route fails closed (503). Matches `makeExplainBackJudge`'s self-gating. */
export function makeOpenAiBaselineChatProvider(): BaselineChatProvider | undefined {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) return undefined;
  return new OpenAiBaselineChatProvider({ apiKey });
}
