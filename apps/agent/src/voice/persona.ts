/**
 * The voice-channel tutor persona + cache-friendly system-prompt construction.
 *
 * The voice loop (OpenAI-Realtime over LiveKit) sends a system prompt once per
 * turn. Realtime/Chat prompt caching keys on a *byte-identical leading prefix*,
 * so the design rule here is: the large, stable persona+rules block (`VOICE_PERSONA`)
 * comes FIRST and never varies within a session; only the small volatile lesson
 * context goes last. That keeps the cached prefix warm across turns — the cost
 * win this module exists for.
 *
 * This persona is the VOICE sibling of the text `SYSTEM_PROMPT` (apps/agent/src/agent/prompt.ts):
 * same warm, Socratic, Boolean-logic-only tone, but its own channel-specific
 * shape (spoken, concise, explain-back oriented — no component menu, since voice
 * never mounts UI).
 */

export interface PersonaInput {
  lessonId: number;
  lessonTitle: string;
  /** Statechart phase name (e.g. 'practicing', 'transferring', 'assessed'). */
  phase: string;
}

/**
 * The stable persona + rules block. This string is a constant (no interpolation)
 * so it is byte-identical across every turn and every session — the prefix a
 * provider prompt cache can reuse. Edits here invalidate all caches by design.
 */
export const VOICE_PERSONA = `You are the voice tutor for Polymath, a Boolean-logic mastery interface.
You speak with the learner out loud. You do NOT control the screen; another agent
mounts components. Your only job in voice is to talk: ask, listen, and judge
understanding.

Voice persona:
- Warm and encouraging, but concise. This is spoken conversation — short turns,
  one idea at a time, no walls of text. Never read out long lists or tables aloud.
- Socratic. Prefer a pointed question over a lecture; let the learner do the
  reasoning and the talking.
- Explain-back oriented. Your central move is to get the learner to explain a
  Boolean concept in their own words, then probe the gaps. A learner who can
  explain it back has demonstrated understanding; one who recites keywords has not.

Hard rules:
- On-topic ONLY: Boolean logic, this lesson, recall of prior lessons, or how to use
  the workspace. Anything else gets a brief, warm redirect back to the task — never
  answer off-topic content.
- Never reveal an answer the learner is being assessed on, and never hand them the
  conclusion you are asking them to reach. Nudge; do not solve.
- Speak naturally for text-to-speech: spell out operators as words ("A AND B", not
  symbols), avoid notation that does not survive being read aloud.`;

/**
 * Build the full voice system prompt: the stable persona prefix followed by the
 * small volatile lesson-context tail. `VOICE_PERSONA` is always the exact prefix
 * (asserted by tests) so the cached prefix is reused turn-to-turn.
 */
export function buildVoiceSystemPrompt(input: PersonaInput): string {
  const context = [
    '',
    'Current lesson context:',
    `- Lesson ${input.lessonId}: "${input.lessonTitle}".`,
    `- Phase: ${input.phase}.`,
  ].join('\n');
  return `${VOICE_PERSONA}\n${context}`;
}

/**
 * Stable cache key for a (session, lesson-state) prefix. Keyed on the lesson and
 * the statechart phase — the inputs that, if changed, justify a fresh cached
 * prefix segment. The volatile `lessonTitle` is deliberately excluded: it rides
 * in the non-cached tail and must not perturb the key. Deterministic and
 * order-independent so the same state always maps to the same key.
 */
export function voiceCacheKey(input: PersonaInput): string {
  return `lesson:${input.lessonId}|phase:${input.phase}`;
}
