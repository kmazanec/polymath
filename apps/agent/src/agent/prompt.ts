import type { AgentInput } from './client.js';

/**
 * The inner-agent prompts (ADR-003). The system prompt fixes the tutor persona,
 * enumerates the bounded menu, and states the topic guardrail + the rationale
 * expectation. The per-turn user prompt carries the structured learner-state
 * snapshot + recent history — the agent is instantiated fresh per turn with no
 * hidden memory beyond what is passed here.
 */

export const SYSTEM_PROMPT = `You are the inner tutoring agent for Polymath, a Boolean-logic mastery interface.
You do NOT write UI. Each turn you pick exactly ONE move from a fixed menu; the
interface mounts the corresponding component. You never invent components or leave
the topic.

Your menu (pick one):
- next_practice_item: advance to a new practice item the learner is ready for.
- simpler_item: after repeated misses, give an easier item on the same concept.
- rephrase: re-present the same item with different wording.
- worked_example: show a step-by-step solved example of the pattern.
- alt_representation: present the current item in a different representation
  (truth_table | circuit | pseudocode).
- answer_question: answer an on-topic Boolean-logic question; deflect off-topic ones.
- propose_mastery_transition: only when the learner-state snapshot says rule-gate
  AND transfer AND explain-back passed AND topic-guardrail clean. The server
  re-checks the full gate and refuses (downgrades to no_action) if any condition
  is unmet, so do NOT propose mastery on the rule gate alone.
- propose_hint: when the learner requests a hint, emit a levelled HintCard. Set
  hintLevel (1=light templated nudge, 2=concrete templated trace, 3=deep free-form
  prose) and hintBody. Advance the level each time the learner re-requests a hint
  on the same item (count prior request_hint turns for that item in recent turns:
  0 prior -> level 1, 1 -> level 2, 2 -> level 3). After level 3 is exhausted
  (3+ prior), pick no_action instead. L1/L2 bodies must reference the item's actual
  gates and variables.
- no_action: wait for the learner (e.g. nothing to do this turn).

Rules:
- For any item you propose (next_practice_item / simpler_item / rephrase /
  alt_representation), you MUST commit a targetExpression and its claimedTruthTable
  (0/1, MSB-first). The server independently recomputes and rejects a wrong table,
  so be exact.
- Topic guardrail: questions about Boolean logic, this lesson, prior-lesson recall,
  or how to use the workspace are on_topic. Everything else is off_topic — answer
  with a brief, warm deflection that redirects to the task; never answer off-topic
  content.
- Every move carries a one-sentence rationale (logged, never shown to the learner).`;

export function buildUserPrompt(input: AgentInput): string {
  const { event, lesson, learnerState, recentHistory, transferCandidates, transferVerdict, inTransferProbe } = input;
  const items = lesson.content.items
    .map((i) => `  - ${i.itemId} (tier ${i.difficultyTier}, KC ${i.kc}): ${i.targetExpression} => ${JSON.stringify(i.truthTable)}`)
    .join('\n');
  const history = recentHistory.length
    ? recentHistory.map((t) => `  - ${t.eventKind} → ${t.actionType}: ${t.rationale}`).join('\n')
    : '  (none)';
  // The held-out transfer items the agent may draw a probe from. A
  // propose_transfer_probe MUST copy one of these verbatim (the server rejects a
  // probe that doesn't match an allowed item).
  const candidates = transferCandidates?.length
    ? transferCandidates
        .map((c) => `  - itemId=${c.itemId} targetRep=${c.targetRep} hiddenReps=${JSON.stringify(c.hiddenReps)} expression=${c.targetExpression}`)
        .join('\n')
    : '  (none available — do not propose a transfer probe)';
  return `Lesson ${lesson.content.lessonId} — "${lesson.content.title}".
Knowledge components: ${lesson.content.knowledgeComponents.join(', ')}.
Lesson items (your source for valid expressions + answer keys):
${items}

Learner-state snapshot:
  BKT by KC: ${JSON.stringify(learnerState.bktByKc)}
  hints used: ${learnerState.hintsUsed}
  consecutive correct: ${learnerState.consecutiveCorrect}
  rule gate passed (transfer-ready): ${learnerState.ruleGatePassed}
  explain-back passed: ${learnerState.explainBackPassed}
  topic-guardrail clean (off-topic answers within budget): ${learnerState.topicGuardrailClean}
  in transfer probe (refuse hints + don't reveal hidden reps): ${inTransferProbe ? 'yes' : 'no'}
  last transfer verdict: ${transferVerdict ? (transferVerdict.correct ? 'passed' : 'failed') : 'none'}

Held-out transfer items (copy one VERBATIM for a propose_transfer_probe):
${candidates}

Recent turns (newest last):
${history}

Inbound event: ${JSON.stringify(event)}

Pick the single best move from the menu for this turn.`;
}
