import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { AgentInput, MoveProvider } from './client.js';
import { F26_MENU, type ProposedItem, type TacticalMove } from './menu.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import {
  openingMove,
  practiceAfterLatestExplanation,
  explanationBeforeNextItem,
} from './introAdvance.js';

/**
 * The OpenAI `MoveProvider` (ADR-006). Uses LangChain structured output against a
 * Zod schema for the tactical menu, so the model can only emit a shape we then map
 * to a `TacticalMove`. Model routing: the fast model handles routing turns; the
 * strong model handles mastery/transfer turns (higher stakes). Reads the model
 * names + key from env so deployment can swap them without a code change.
 *
 * This is wired but inert without `OPENAI_API_KEY`; the flow + heuristic provider
 * cover everything testable offline (the LangSmith ≥95% eval gate runs live only
 * when a key is present — see eval/ and feature file).
 */

const Rep = z.enum(['truth_table', 'circuit', 'pseudocode']);
const ItemSchema = z.object({
  rep: Rep,
  targetExpression: z.string(),
  claimedTruthTable: z.array(z.union([z.literal(0), z.literal(1)])),
  visibleReps: z.array(Rep),
  // F-29 / ADR-015: lockstep with ProposedItem.prompt in menu.ts.
  // The model MUST emit a prompt for every item it generates (the rails check
  // enforces this). Nullable in the schema so OpenAI strict mode accepts it
  // (missing vs null are both treated as absent in toTacticalMove below).
  prompt: z.string().max(2000).nullable(),
});

/** The structured-output schema the model fills. Mapped to `TacticalMove` below.
 *  Flat (not a discriminated union of disjoint shapes) so OpenAI strict JSON-schema
 *  mode accepts it; we narrow by `move` and read the relevant fields. */
const MoveSchema = z.object({
  // The enum is the agent's full internal menu (F26_MENU = the prior menu + the
  // scaffold-only playground move). Sourcing it from the menu module keeps the LLM's
  // option set in lockstep with the TacticalMove union — adding a menu move can't
  // silently leave the keyed path unable to emit it.
  move: z.enum(F26_MENU),
  rationale: z.string(),
  item: ItemSchema.nullable(),
  tier: z.number().nullable(),
  altRep: Rep.nullable(),
  workedExpression: z.string().nullable(),
  workedSteps: z.array(z.object({ label: z.string(), detail: z.string() })).nullable(),
  workedVisibleReps: z.array(Rep).nullable(),
  question: z.string().nullable(),
  answer: z.string().nullable(),
  topicClassification: z.enum(['on_topic', 'off_topic']).nullable(),
  noActionReason: z.enum(['wait_for_learner', 'thinking', 'agent_unsure']).nullable(),
  /** ADR-010 Layer 3 hint fields (F-06). `hintLevel` selects the ladder rung;
   *  `hintBody` is the templated (L1/L2) or free-form (L3) text. */
  hintLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  hintBody: z.string().nullable(),
  /** Transfer-probe fields (F-07). The held-out item the learner must reproduce
   *  in `probeTargetRep`, with `probeHiddenReps` excluded from the workspace. */
  probeExpression: z.string().nullable(),
  probeTargetRep: Rep.nullable(),
  probeHiddenReps: z.array(Rep).nullable(),
  probeItemId: z.string().nullable(),
  /** ADR-012 stretch: optional scaffold text for the scaffold-only playground
   *  move (`verify_playground_equivalence`). */
  scaffold: z.string().nullable(),
});
type RawMove = z.infer<typeof MoveSchema>;

/** Convert a nullable Zod-validated ItemSchema output to a ProposedItem.
 *  Translates prompt: null → undefined (ProposedItem.prompt is optional, not nullable). */
function toProposedItem(raw: z.infer<typeof ItemSchema>): ProposedItem {
  return {
    rep: raw.rep,
    targetExpression: raw.targetExpression,
    claimedTruthTable: raw.claimedTruthTable,
    visibleReps: raw.visibleReps,
    ...(raw.prompt !== null ? { prompt: raw.prompt } : {}),
  };
}

function toTacticalMove(raw: RawMove): TacticalMove {
  const r = raw.rationale;
  const item: ProposedItem | null = raw.item !== null ? toProposedItem(raw.item) : null;
  switch (raw.move) {
    case 'next_practice_item':
      if (!item) throw new Error('next_practice_item requires item');
      return { move: 'next_practice_item', item, tier: raw.tier ?? 1, rationale: r };
    case 'simpler_item':
      if (!item) throw new Error('simpler_item requires item');
      return { move: 'simpler_item', item, rationale: r };
    case 'rephrase':
      if (!item) throw new Error('rephrase requires item');
      return { move: 'rephrase', item, rationale: r };
    case 'alt_representation':
      if (!item || !raw.altRep) throw new Error('alt_representation requires item + altRep');
      return { move: 'alt_representation', item, rep: raw.altRep, rationale: r };
    case 'worked_example':
      return {
        move: 'worked_example',
        expression: raw.workedExpression ?? '',
        steps: raw.workedSteps ?? [],
        visibleReps: raw.workedVisibleReps ?? ['truth_table'],
        rationale: r,
      };
    case 'answer_question':
      return {
        move: 'answer_question',
        question: raw.question ?? '',
        answer: raw.answer ?? '',
        topicClassification: raw.topicClassification ?? 'off_topic',
        rationale: r,
      };
    case 'propose_mastery_transition':
      return { move: 'propose_mastery_transition', rationale: r };
    case 'propose_transfer_probe':
      if (!raw.probeExpression || !raw.probeTargetRep || !raw.probeItemId) {
        throw new Error('propose_transfer_probe requires probeExpression + probeTargetRep + probeItemId');
      }
      return {
        move: 'propose_transfer_probe',
        expression: raw.probeExpression,
        targetRep: raw.probeTargetRep,
        hiddenReps: raw.probeHiddenReps ?? [],
        itemId: raw.probeItemId,
        rationale: r,
      };
    case 'propose_hint':
      return {
        move: 'propose_hint',
        level: raw.hintLevel ?? 1,
        body: raw.hintBody ?? '',
        rationale: r,
      };
    case 'verify_playground_equivalence':
      return {
        move: 'verify_playground_equivalence',
        ...(raw.scaffold ? { scaffold: raw.scaffold } : {}),
        rationale: r,
      };
    case 'no_action':
      return { move: 'no_action', reason: raw.noActionReason ?? 'agent_unsure', rationale: r };
  }
}

/** Turns where we route to the strong model (higher stakes than routine practice). */
function needsStrongModel(input: AgentInput): boolean {
  return input.event.kind === 'transfer_submitted' || input.learnerState.ruleGatePassed;
}

export interface OpenAIProviderOptions {
  apiKey?: string;
  fastModel?: string;
  strongModel?: string;
}

export class OpenAIMoveProvider implements MoveProvider {
  private readonly fast: ChatOpenAI;
  private readonly strong: ChatOpenAI;

  constructor(opts: OpenAIProviderOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAIMoveProvider requires OPENAI_API_KEY (or opts.apiKey)');
    }
    const fastModel = opts.fastModel ?? process.env.INNER_AGENT_FAST_MODEL ?? 'gpt-5-mini';
    const strongModel = opts.strongModel ?? process.env.INNER_AGENT_STRONG_MODEL ?? 'gpt-5';
    this.fast = new ChatOpenAI({ apiKey, model: fastModel });
    this.strong = new ChatOpenAI({ apiKey, model: strongModel });
  }

  async proposeMove(input: AgentInput, validationError?: string): Promise<TacticalMove> {
    // I7/F-27 (D1, menu-lockstep): `intro_advance` advances the deterministic opening
    // sequence — the same logic as session_start.openingMove.  The LLM is not involved
    // in intro navigation; this is a heuristic short-circuit.
    if (input.event.kind === 'intro_advance') {
      const alreadyStarted = input.recentHistory.some(
        (t) => t.eventKind === 'submit' || t.eventKind === 'request_hint' || t.eventKind === 'transfer_submitted',
      );
      if (alreadyStarted) {
        const nextPractice = practiceAfterLatestExplanation(input);
        if (nextPractice) return nextPractice;
        return {
          move: 'no_action',
          reason: 'wait_for_learner',
          rationale: 'intro_advance received after practice has started — ignoring (OpenAI provider)',
        };
      }
      return openingMove(input);
    }

    const requiredExplanation = explanationBeforeNextItem(input);
    if (requiredExplanation) return requiredExplanation;

    const model = needsStrongModel(input) ? this.strong : this.fast;
    const structured = model.withStructuredOutput(MoveSchema, { name: 'tactical_move' });
    const correction = validationError
      ? `\n\nYour previous move failed server validation: ${validationError}\nFix it and return a corrected move.`
      : '';
    const raw = await structured.invoke([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(input) + correction },
    ]);
    return toTacticalMove(raw);
  }
}
