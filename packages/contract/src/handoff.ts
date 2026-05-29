import { z } from 'zod';

/**
 * `HandoffArtifact` — the tutor handoff artifact (ADR-012 stretch). An additive,
 * standalone contract: a warm, human-readable summary a learner can hand to a
 * tutor, carrying which KCs they mastered, where they got stuck, and a few
 * tutor-facing questions to pick up from.
 *
 * The `summary` field is the session summary produced by the summary pipeline
 * (owned elsewhere). That pipeline's `SessionSummarySchema` is NOT yet present in
 * this branch, so `summary` is typed here as a forward-compatible passthrough
 * (`z.unknown()`); the owning feature replaces this single line with
 * `import { SessionSummarySchema } from './sessionSummary.js'` (import, never
 * redefine) when the summary pipeline lands — the rest of the shape is frozen.
 */

/** A tutor-facing question keyed to the KC it probes. */
export const TutorQuestionSchema = z.object({
  kc: z.string(),
  question: z.string().min(1),
});
export type TutorQuestion = z.infer<typeof TutorQuestionSchema>;

/** Placeholder for the summary-pipeline schema (owned elsewhere; not yet in this
 *  branch). Swap to the real `SessionSummarySchema` import when it merges. */
const SummaryPlaceholderSchema = z.unknown();

export const HandoffArtifactSchema = z.object({
  sessionId: z.string().uuid(),
  generatedAt: z.string(),
  warmIntro: z.string(),
  /** OWNED BY the summary pipeline — import its `SessionSummarySchema`, never redefine. */
  summary: SummaryPlaceholderSchema,
  masteredKcs: z.array(z.string()),
  stuckKcs: z.array(z.string()),
  tutorQuestions: z.array(TutorQuestionSchema).min(3).max(5),
  nerdyFooter: z.string(),
});
export type HandoffArtifact = z.infer<typeof HandoffArtifactSchema>;
