import { z } from 'zod';

/**
 * `ComponentSpec` — the curated component registry (ADR-005). A typed,
 * Zod-validated discriminated union on `kind`. The LLM picks a `kind` and fills
 * the typed slots; nothing outside this union is mountable.
 *
 * This is the most-extended contract in the project. The change protocol
 * (ROADMAP.md cross-cutting contracts) is: adding a `kind` variant is a
 * coordinated PR across the web renderer switch and the agent prompt+validator;
 * removals require a deprecation window. F-01 defines all 12 MVP+stretch variants
 * so downstream features only ever *consume* them.
 */

export const Rep = z.enum(['truth_table', 'circuit', 'pseudocode']);
export type Rep = z.infer<typeof Rep>;

export const Gate = z.enum(['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR']);
export type Gate = z.infer<typeof Gate>;

/** A single step in a WorkedExample. */
export const Step = z.object({
  label: z.string(),
  detail: z.string(),
});
export type Step = z.infer<typeof Step>;

/**
 * The agent's claimed canonical truth table for item-generating components
 * (ADR-010 Layer 2). The server independently recomputes this via
 * @polymath/booleans before forwarding the Action; the field exists so the agent
 * must commit to an answer up front. Encoded as 0/1 ints (the truth-table `out`
 * vector in @polymath/booleans MSB-first order).
 */
const ClaimedTruthTable = z.array(z.union([z.literal(0), z.literal(1)]));

export const ComponentSpec = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('LessonIntro'),
    lessonId: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    title: z.string(),
    body: z.string(),
  }),
  z.object({
    kind: z.literal('IntroExplanation'),
    topic: z.string(),
    body: z.string(),
    visibleReps: z.array(Rep),
  }),
  z.object({
    kind: z.literal('TruthTablePractice'),
    expression: z.string(),
    claimedTruthTable: ClaimedTruthTable,
    visibleReps: z.array(Rep),
  }),
  z.object({
    kind: z.literal('CircuitBuilder'),
    targetExpression: z.string(),
    claimedTruthTable: ClaimedTruthTable,
    allowedGates: z.array(Gate),
    visibleReps: z.array(Rep),
  }),
  z.object({
    kind: z.literal('PseudocodeChallenge'),
    targetExpression: z.string(),
    claimedTruthTable: ClaimedTruthTable,
    visibleReps: z.array(Rep),
  }),
  z.object({
    kind: z.literal('WorkedExample'),
    expression: z.string(),
    steps: z.array(Step),
    visibleReps: z.array(Rep),
  }),
  z.object({
    kind: z.literal('HintCard'),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    body: z.string(),
  }),
  z.object({
    kind: z.literal('TransferProbe'),
    expression: z.string(),
    hiddenReps: z.array(Rep),
    targetRep: Rep,
    itemId: z.string(),
  }),
  z.object({
    kind: z.literal('ExplainBackPrompt'),
    targetItemId: z.string(),
    promptBody: z.string(),
    maxDurationSec: z.number(),
  }),
  z.object({
    kind: z.literal('ConfidenceCheck'),
    targetItemId: z.string(),
    scale: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
  }),
  z.object({
    kind: z.literal('MasteryCelebration'),
    conceptsMastered: z.array(z.string()),
    nextLessonId: z.number().optional(),
  }),
  z.object({
    kind: z.literal('AgentAnswer'),
    question: z.string(),
    answer: z.string(),
    topicClassification: z.enum(['on_topic', 'off_topic']),
  }),
  // I3 barrier (F-14): a cross-lesson recall card. When a learner regresses on a
  // prior-lesson KC (L1 BKT drops below threshold mid-L2), the SERVER reflex mounts
  // a short text reminder of that KC. TEXT-ONLY by design — NO rep rendering and NO
  // `visibleReps` field — so a recall card can never expose a held-out probe rep
  // (the probe-integrity boundary). Mounted via the existing `mount` Action; the
  // server is the truth-maker (the BKT check IS the earned-it gate), so this is not
  // an LLM-emitted menu move.
  z.object({
    kind: z.literal('CrossLessonRecall'),
    kc: z.string(),
    currentItemId: z.string(),
    priorBktAtRegression: z.number(),
    reminderBody: z.string(),
  }),
]);
export type ComponentSpec = z.infer<typeof ComponentSpec>;

/** Every `kind` literal in the registry — the source for the web renderer
 *  switch's exhaustiveness check and the agent's menu. */
export const COMPONENT_KINDS = [
  'LessonIntro',
  'IntroExplanation',
  'TruthTablePractice',
  'CircuitBuilder',
  'PseudocodeChallenge',
  'WorkedExample',
  'HintCard',
  'TransferProbe',
  'ExplainBackPrompt',
  'ConfidenceCheck',
  'MasteryCelebration',
  'AgentAnswer',
  'CrossLessonRecall',
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];
