import { z } from 'zod';
import { SessionSummarySchema } from './sessionReport.js';

/**
 * `HandoffArtifact` — the tutor handoff artifact (ADR-012 stretch). An additive,
 * standalone contract: a warm, human-readable summary a learner can hand to a
 * tutor, carrying which KCs they mastered, where they got stuck, and a few
 * tutor-facing questions to pick up from.
 *
 * The `summary` field is the session summary produced by F-18's summary pipeline.
 * F-18 landed (I5), so `summary` now uses the REAL `SessionSummarySchema` (imported
 * from `./sessionReport.js`, never redefined) — the F-24↔F-18 reconcile the F-24
 * plan flagged. The rest of the shape is frozen.
 */

/** A tutor-facing question keyed to the KC it probes. */
export const TutorQuestionSchema = z.object({
  kc: z.string(),
  question: z.string().min(1),
});
export type TutorQuestion = z.infer<typeof TutorQuestionSchema>;

export const HandoffArtifactSchema = z.object({
  sessionId: z.string().uuid(),
  generatedAt: z.string(),
  warmIntro: z.string(),
  /** OWNED BY F-18's summary pipeline (`SessionSummarySchema` in `sessionReport.ts`) —
   *  imported, never redefined. */
  summary: SessionSummarySchema,
  masteredKcs: z.array(z.string()),
  stuckKcs: z.array(z.string()),
  tutorQuestions: z.array(TutorQuestionSchema).min(3).max(5),
  nerdyFooter: z.string(),
});
export type HandoffArtifact = z.infer<typeof HandoffArtifactSchema>;
