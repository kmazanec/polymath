/**
 * F-16 baseline chat-provider seam (ADR-006-style injectable provider, mirrors the
 * inner agent's `MoveProvider`).
 *
 * The baseline tutor is a plain GPT-5 chat loop — NO LangGraph, NO statechart, NO
 * curated components. But the LLM call is behind this seam so:
 *   - tests run OFFLINE against a deterministic stub (no `OPENAI_API_KEY` in CI),
 *   - production uses the STRONG model (gpt-5) — the baseline is never disadvantaged
 *     on model strength (ADR-011 fairness),
 *   - a key-less deploy fails CLOSED (the route serves 503, like /api/realtime/session).
 *
 * The provider ONLY produces dialogue. It is NEVER asked "is this answer right?" —
 * correctness is decided server-side by the shared `scoreEquivalence`
 * (`@polymath/booleans`), the same truth-maker Polymath uses. The provider receives
 * the server-computed verdict so it can phrase its reply, but it cannot grant a pass.
 */

/** One content item injected into the tutor's context (from `lessons/1/content.json`).
 *  The LLM does NOT invent problems — it tutors the exact authored items. */
export interface BaselineContentItem {
  itemId: string;
  kc: string;
  targetExpression: string;
}

/** A single message in the chat history (newest last). */
export interface BaselineChatMessage {
  role: 'tutor' | 'learner';
  text: string;
}

/** Everything the tutor needs to phrase its next reply for the current turn. */
export interface BaselineChatTurn {
  /** The content item currently being worked. */
  item: BaselineContentItem;
  /** Prior dialogue this session (newest last). */
  history: BaselineChatMessage[];
  /** The learner's latest message. */
  message: string;
  /** The SERVER-computed verdict for this turn: `true`/`false` if the message
   *  parsed as a Boolean expression and was scored; `null` if it was prose / a
   *  question (no expression to score — the tutor should re-prompt, not mark wrong). */
  verdict: boolean | null;
}

/** The injectable chat provider. Real impl = gpt-5; test double = deterministic. */
export interface BaselineChatProvider {
  reply(turn: BaselineChatTurn): Promise<string>;
}

export const BASELINE_SYSTEM_PROMPT =
  'You are a patient tutor for Boolean logic, Lesson 1 (the operators AND, OR, NOT). ' +
  'Work through ONLY the provided lesson items, in order — never invent new problems. ' +
  'Ask the learner to express the answer for the current item as a Boolean expression ' +
  'using the variables given and the operators AND, OR, NOT (and parentheses). ' +
  'Render Boolean expressions and any math in LaTeX (inline $...$). ' +
  'The system tells you whether the learner\'s last expression was correct, incorrect, ' +
  'or not an expression at all — use that verdict to respond: celebrate a correct answer ' +
  'and move on; on an incorrect one, give a short hint without revealing the full answer; ' +
  'on a non-expression (a question or prose), answer briefly and re-prompt for the expression. ' +
  'Never tell the learner an answer is correct unless the system says so.';
