import { TutorQuestionSchema, type TutorQuestion } from '@polymath/contract';

/**
 * The tutor-questions generation node (ADR-012 stretch). Turns a session's
 * stuck/mastered KCs into 3–5 concrete questions a learner brings to a Nerdy human
 * tutor — the warm "here's what to ask next" beat that frames the AI as preparation
 * for, not a replacement of, live tutoring.
 *
 * Design (mirrors the explain-back judge's env-gate + fail-soft):
 *  - Deterministic templates are ALWAYS on. The offline MR pipeline exercises the
 *    full behaviour with no key and no network — the templates ARE the product; the
 *    LLM is an optional polish.
 *  - An LLM rephrase runs only behind `OPENAI_API_KEY` and is fail-SOFT: any throw,
 *    or a rephrase that fails to validate (wrong count / blank question), is
 *    discarded and the templates stand. This node NEVER throws and NEVER returns
 *    fewer than 3 or more than 5 questions — the `HandoffArtifactSchema.min(3).max(5)`
 *    invariant holds by construction.
 *  - The framing is warm + Nerdy-aligned even when nothing is stuck: a fully
 *    mastered session gets enrichment / depth questions, never "I failed to teach
 *    you". A degraded (empty-on-both-sides) session still gets generic starter
 *    questions so the artifact is always handoff-ready.
 */

const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 5;

/** The minimal session signal this node needs. Deliberately NOT typed against the
 *  summary-pipeline `SessionSummary` (owned elsewhere, not in this branch) — the
 *  caller projects the two KC lists it already derives, keeping this node decoupled
 *  from the unbuilt schema. */
export interface TutorQuestionInput {
  /** KCs below the lesson's mastery threshold — the ones worth a tutor's time. */
  stuckKcs: string[];
  /** KCs the learner reached mastery on — used for enrichment questions when there
   *  is nothing stuck. */
  masteredKcs: string[];
}

/** An optional LLM rephrase seam (DI). Tests inject a deterministic double; the real
 *  impl is key-gated. It receives the deterministic templates and returns a warmer
 *  phrasing keyed identically; any deviation is discarded by the caller. */
export type TutorQuestionRephrase = (
  templates: TutorQuestion[],
) => Promise<TutorQuestion[]>;

export interface GenerateTutorQuestionsOpts {
  /** Override the rephrase seam (tests). Production defaults to the key-gated impl. */
  rephrase?: TutorQuestionRephrase;
}

/** Deterministic per-KC question templates. A KC without a bespoke template falls
 *  back to a generic-but-specific phrasing keyed to its name. */
function templateForStuckKc(kc: string): TutorQuestion {
  const bespoke: Record<string, string> = {
    AND: 'Can we walk through a few cases of an AND together — especially when the output should be 0 even though one input is 1?',
    OR: 'I keep slipping on OR. Can we contrast it with AND on the rows where exactly one input is 1?',
    NOT: 'Can we go over NOT and double-negation — when does inverting twice cancel out?',
    NAND: 'NAND is still fuzzy for me. Can we build it up from AND-then-NOT and check a full truth table?',
    NOR: 'Can we work through NOR by comparing it to OR-then-NOT, row by row?',
    XOR: 'XOR trips me up. Can we look at why it differs from OR on the all-ones row?',
  };
  const question =
    bespoke[kc] ??
    `I got stuck on ${kc}. Can we work through a couple of examples and check my reasoning out loud?`;
  return { kc, question };
}

/** Enrichment questions for a learner who got nothing wrong — depth, transfer,
 *  and real-world connection. Warm + forward-looking, never apologetic. */
function enrichmentQuestions(masteredKcs: string[]): TutorQuestion[] {
  const focus = masteredKcs[0] ?? 'Boolean logic';
  return [
    {
      kc: masteredKcs[0] ?? 'general',
      question: `I felt solid on ${focus} here — can we push into a harder, multi-gate problem to stretch it?`,
    },
    {
      kc: masteredKcs[1] ?? 'transfer',
      question:
        'Can you show me how these gates show up in real code or a real circuit, so I can connect it to something I build?',
    },
    {
      kc: masteredKcs[2] ?? 'depth',
      question:
        'What is a common trick question on this topic that I might still get wrong under time pressure?',
    },
  ];
}

/** Build the deterministic template set, always 3–5 questions. */
function buildTemplates(input: TutorQuestionInput): TutorQuestion[] {
  if (input.stuckKcs.length === 0) {
    // Nothing stuck — enrichment. Always exactly 3 warm forward-looking questions.
    return enrichmentQuestions(input.masteredKcs);
  }
  // One question per stuck KC, clamped to MAX. If fewer than MIN stuck KCs, top up
  // with enrichment questions so the artifact always carries at least 3.
  const stuck = input.stuckKcs.slice(0, MAX_QUESTIONS).map(templateForStuckKc);
  if (stuck.length >= MIN_QUESTIONS) return stuck;
  const enrichment = enrichmentQuestions(input.masteredKcs);
  const topped = [...stuck];
  for (const q of enrichment) {
    if (topped.length >= MIN_QUESTIONS) break;
    topped.push(q);
  }
  return topped;
}

/** Validate a candidate question set against the frozen contract bounds. A set that
 *  is the wrong size or carries a blank question is rejected (the caller keeps the
 *  templates instead). */
function isValidQuestionSet(qs: unknown): qs is TutorQuestion[] {
  if (!Array.isArray(qs)) return false;
  if (qs.length < MIN_QUESTIONS || qs.length > MAX_QUESTIONS) return false;
  return qs.every((q) => TutorQuestionSchema.safeParse(q).success);
}

/**
 * Generate 3–5 tutor questions for a session. Always returns a contract-valid set;
 * never throws.
 */
export async function generateTutorQuestions(
  input: TutorQuestionInput,
  opts: GenerateTutorQuestionsOpts = {},
): Promise<TutorQuestion[]> {
  const templates = buildTemplates(input);

  // LLM rephrase is optional + key-gated. No key → templates as-is (the offline
  // path). The seam may also be injected directly (tests / a future real impl).
  const rephrase = opts.rephrase ?? makeDefaultRephrase();
  if (!rephrase) return templates;

  try {
    const rephrased = await rephrase(templates);
    // Keep the rephrase only if it is contract-valid; otherwise fall back to the
    // templates (fail-soft — a bad model response never degrades the artifact).
    if (isValidQuestionSet(rephrased)) return rephrased;
  } catch {
    // Network / provider error — keep the deterministic templates.
  }
  return templates;
}

/** The production rephrase seam: key-gated, returns `undefined` without a key so the
 *  template path is used. (The live LLM rephrase impl is intentionally deferred —
 *  the templates are the shipped product; this hook is where a polish pass plugs in
 *  without changing the node's contract.) */
function makeDefaultRephrase(): TutorQuestionRephrase | undefined {
  if (!process.env['OPENAI_API_KEY']) return undefined;
  return undefined;
}
