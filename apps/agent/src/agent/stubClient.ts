import type { AgentInput, MoveProvider } from './client.js';
import type { ProposedItem, TacticalMove } from './menu.js';
import type { Rep } from '@polymath/contract';
import { FlowAgentClient } from './flowClient.js';
import { generateL1, generateL2, generateL3Canned, L4_DEMORGAN_HINT } from '../hints/templates.js';
import { detectHalfwayMisconception, loadMisconceptions } from '../hints/misconceptions.js';
// F-27 (menu-lockstep): shared opening-move logic, used for both session_start and intro_advance.
import {
  openingMove,
  defaultItemPrompt,
  practiceAfterLatestExplanation,
  explanationBeforeNextItem,
} from './introAdvance.js';

/**
 * A deterministic, key-free `MoveProvider` (no LLM). It implements a small
 * hand-coded policy over the same tactical menu the LLM would pick from, so the
 * inner loop is fully exercisable — in F-01's integration test, in the smoke
 * test, and locally — without an `OPENAI_API_KEY`. The OpenAI provider replaces
 * this when a key is present; the *flow* (retry/fallback/Layer-2) is identical.
 *
 * Policy:
 *  - `session_start`     → mount the lesson's first practice item (kick off the loop
 *                          so the learner reaches a workspace from the intro).
 *  - `submit`            → next practice item from the lesson (or propose the mastery
 *                          transition if the rule-gate says the learner is ready).
 *  - `request_hint`      → propose_hint at the appropriate level (0 prior→L1,
 *                          1→L2, 2→L3, 3+→no_action/disabled). During the
 *                          `transferring` phase → no_action.
 *  - `learner_question`  → answer on-topic Boolean-logic questions, deflect others.
 *  - anything else       → no_action (wait for the learner).
 */
export class HeuristicMoveProvider implements MoveProvider {
  proposeMove(input: AgentInput): Promise<TacticalMove> {
    const ev = input.event;

    // I7/F-27 (D1, menu-lockstep): "Got it — continue" from the web client advances
    // the deterministic opening intro sequence one stage.  The current stage is
    // derived from the mount count in recentHistory — idempotent on a reconnect,
    // and exactly the same logic as session_start's openingMove.  An intro_advance
    // on a session that has already started practice is a no-op.
    if (ev.kind === 'intro_advance') {
      const alreadyStarted = input.recentHistory.some(
        (t) => t.eventKind === 'submit' || t.eventKind === 'request_hint' || t.eventKind === 'transfer_submitted',
      );
      if (alreadyStarted) {
        const nextPractice = practiceAfterLatestExplanation(input);
        if (nextPractice) return Promise.resolve(nextPractice);
        return Promise.resolve({
          move: 'no_action',
          reason: 'wait_for_learner',
          rationale: 'intro_advance received after practice has started — ignoring (heuristic provider)',
        });
      }
      return Promise.resolve(openingMove(input));
    }

    if (ev.kind === 'session_start') {
      // Idempotent: if the learner has already been practicing (any submit, hint,
      // or transfer event in history), never re-mount intro or item 0 — a reconnect
      // re-sends session_start and must not yank the learner back.
      const alreadyStarted = input.recentHistory.some(
        (t) => t.eventKind === 'submit' || t.eventKind === 'request_hint' || t.eventKind === 'transfer_submitted',
      );
      if (alreadyStarted) {
        return Promise.resolve({
          move: 'no_action',
          reason: 'wait_for_learner',
          rationale: 'session already in progress — not remounting the first item (heuristic provider)',
        });
      }
      return Promise.resolve(openingMove(input));
    }

    if (ev.kind === 'submit') {
      // A wrong submit must NOT advance: re-present the same item (rephrase), and
      // on a *repeated* wrong attempt at the same item, drop to a simpler item
      // (ADR-003 menu; F-05 criterion 3). Correctness is the SERVER's recompute
      // (currentSubmitCorrect), never the client `correct` flag — a client can't
      // claim correct to skip remediation. Prior-miss count is also server-derived.
      if (input.currentSubmitCorrect === false) {
        // ADR-012 stretch (Lesson 4): before a generic rephrase, check whether the
        // wrong answer is the recognisable "halfway De Morgan" misconception — the
        // learner distributed the negation but kept the connective. The match is
        // SEMANTIC (the learner's truth-table OUTPUT column vs the per-item authored
        // halfway column), not string-based (D23-1), so it fires regardless of how
        // the answer is spelled. We read the column straight off the truth-table
        // `repSubmission` (a bounded 0/1 vector) — NEVER enumerating an expression,
        // so there is no var-cap DoS surface here. Fail-soft: a missing/empty bank or
        // a non-truth-table submission simply skips to the generic rephrase below.
        const named = detectHalfwayHint(input, ev.itemId);
        if (named) {
          return Promise.resolve({
            move: 'propose_hint',
            // D23-4: the named misconception rides as an L1 directional hint.
            level: 1,
            body: named,
            rationale: `detected the halfway De Morgan misconception on item "${ev.itemId}" — naming it (heuristic provider)`,
          });
        }
        const priorWrong = (input.priorMissesByItem?.[ev.itemId] ?? 0) > 0;
        const same = currentItem(input);
        if (same) {
          return Promise.resolve(
            priorWrong
              ? { move: 'simpler_item', item: simplerVariant(same, input), rationale: 'repeated miss on this item — dropping to a simpler one (heuristic provider)' }
              : { move: 'rephrase', item: same, rationale: 're-presenting the item after a miss (heuristic provider)' },
          );
        }
      }

      // Rule gate ready → fire a transfer probe from the held-out bank (an unseen
      // item). Mastery is NOT proposed from practice — it requires a passed transfer
      // probe AND the remaining mastery conditions (ADR-005 refusal #3 / ADR-011).
      // If the bank is exhausted we still cannot declare mastery here (a missing
      // probe is a degraded state, not a pass) — fail closed.
      if (input.learnerState.ruleGatePassed) {
        const candidate = input.transferCandidates?.[0];
        if (candidate) {
          return Promise.resolve({
            move: 'propose_transfer_probe',
            expression: candidate.targetExpression,
            targetRep: candidate.targetRep,
            hiddenReps: candidate.hiddenReps,
            itemId: candidate.itemId,
            rationale: 'rule-gate passed — firing a held-out transfer probe (heuristic provider)',
          });
        }
        return Promise.resolve({
          move: 'no_action',
          reason: 'wait_for_learner',
          rationale: 'rule-gate passed but no unseen transfer item available — cannot declare mastery (heuristic provider)',
        });
      }
      const explanation = explanationBeforeNextItem(input);
      if (explanation) return Promise.resolve(explanation);
      const next = pickLessonItem(input);
      if (next) return Promise.resolve(next);
      const targeted = pickGateRepairItem(input);
      if (targeted) return Promise.resolve(targeted);
      return Promise.resolve({
        move: 'no_action',
        reason: 'wait_for_learner',
        rationale: 'no further lesson items (heuristic provider)',
      });
    }

    if (ev.kind === 'transfer_submitted') {
      // The transfer probe's verdict gates the next move. A pass clears the rule +
      // transfer conditions, but mastery ALSO requires explain-back when the lesson
      // config demands it (ADR-011) — and explain-back lands in F-11/F-12. So a
      // passed transfer in I1 does NOT declare mastery: it records the pass (the
      // server logs the verdict) and waits. Only when no further condition is
      // required does the agent propose mastery. A fail remediates with a simpler
      // item. Correctness is computed server-side and threaded via `transferVerdict`.
      const passed = input.transferVerdict?.correct ?? false;
      if (passed) {
        // F-12: a passed transfer clears the rule + transfer conditions, but mastery
        // ALSO needs explain-back + a clean topic-guardrail (when required). Propose
        // mastery only when the full gate's signals hold; otherwise wait (the
        // explain_back_recording_ended turn re-triggers this decision once the
        // verdict lands). Blockers go in the rationale (AC#2). The server re-checks
        // the full gate and refuses an unearned transition regardless.
        return Promise.resolve(proposeMasteryOrWait(input));
      }
      const items = [...input.lesson.content.items].sort((a, b) => a.difficultyTier - b.difficultyTier);
      const easiest = items[0];
      if (easiest) {
        return Promise.resolve({
          move: 'simpler_item',
          item: {
            rep: 'truth_table',
            targetExpression: easiest.targetExpression,
            claimedTruthTable: easiest.truthTable,
            visibleReps: ['truth_table'],
            prompt: defaultItemPrompt(easiest.targetExpression, 'truth_table'),
          },
          rationale: 'transfer probe failed — remediating with a simpler item (heuristic provider)',
        });
      }
      return Promise.resolve({ move: 'no_action', reason: 'wait_for_learner', rationale: 'transfer failed, no item to remediate' });
    }

    if (ev.kind === 'request_hint') {
      // ADR-005 refusal #2 extends to hints: no hint during a transfer probe, even
      // if the (normally-disabled) affordance is somehow triggered. Server-side
      // defense in depth, not just the disabled button.
      if (input.inTransferProbe) {
        return Promise.resolve({
          move: 'no_action',
          reason: 'wait_for_learner',
          rationale: 'hints are withheld during a transfer probe (heuristic provider)',
        });
      }
      return Promise.resolve(proposeHint(ev.itemId, input));
    }

    if (ev.kind === 'explain_back_recording_ended') {
      // The explain-back recording just resolved. Its verdict (F-11) has been folded
      // into the snapshot's `explainBackPassed` by the server. If the full gate's
      // visible signals now hold, propose mastery; else wait with the blockers named.
      return Promise.resolve(proposeMasteryOrWait(input));
    }

    if (ev.kind === 'learner_question') {
      const onTopic = isBooleanTopic(ev.question);
      return Promise.resolve({
        move: 'answer_question',
        question: ev.question,
        answer: onTopic
          ? 'In Boolean logic, an expression is true or false depending on its inputs. Try working it through on the truth table.'
          : "I can help with Boolean logic and this lesson. For anything else, Nerdy has other tutors who can help.",
        topicClassification: onTopic ? 'on_topic' : 'off_topic',
        rationale: 'heuristic topic classification',
      });
    }

    return Promise.resolve({
      move: 'no_action',
      reason: 'wait_for_learner',
      rationale: `heuristic provider: nothing to do for "${ev.kind}"`,
    });
  }
}

/**
 * Propose the appropriate hint level for the given item, based on how many hints
 * have ALREADY been served on THIS item this session.
 *
 * Level selection (ADR-010 Layer 3):
 *   0 prior served hints for item → L1
 *   1 prior                       → L2
 *   2 prior                       → L3
 *   3+                            → no_action (affordance is disabled)
 *
 * The count comes from the server-derived `hintsByItem` (the full session), not the
 * capped `recentHistory` window — a window-based count could reset the ladder when
 * other events push earlier hints out of view.
 */
function proposeHint(itemId: string, input: AgentInput): TacticalMove {
  const priorHints =
    input.hintsByItem?.[itemId] ??
    // Fallback only if the server didn't supply the derived map.
    input.recentHistory.filter((t) => t.eventKind === 'request_hint' && t.itemId === itemId).length;

  if (priorHints >= 3) {
    return {
      move: 'no_action',
      reason: 'wait_for_learner',
      rationale: 'all hint levels exhausted for this item (heuristic provider)',
    };
  }

  // Find the item in the lesson to get its targetExpression
  const lessonItem = input.lesson.content.items.find(
    (i) => i.itemId === itemId || i.targetExpression === itemId,
  );
  const targetExpression = lessonItem?.targetExpression ?? itemId;

  const level = (priorHints + 1) as 1 | 2 | 3;

  let body: string | null = null;
  if (level === 1) {
    body = generateL1(targetExpression);
  } else if (level === 2) {
    body = generateL2(targetExpression);
  } else {
    body = generateL3Canned(targetExpression);
  }

  if (!body) {
    return {
      move: 'no_action',
      reason: 'agent_unsure',
      rationale: `could not generate L${level.toString()} hint for expression "${targetExpression}" (heuristic provider)`,
    };
  }

  return {
    move: 'propose_hint',
    level,
    body,
    rationale: `L${level.toString()} hint for item "${itemId}" (${priorHints.toString()} prior hints; heuristic provider)`,
  };
}

/**
 * F-12: decide between proposing mastery and waiting, from the learner-state
 * snapshot's gate signals. The agent proposes `propose_mastery_transition` only
 * when rule-gate AND explain-back passed AND the topic-guardrail is clean (the
 * transfer pass is what got us here). Otherwise it waits with the unmet conditions
 * named in the rationale (AC#2). The SERVER re-evaluates the full gate and refuses
 * an unearned transition regardless — this is the agent's organic proposal, not the
 * truth-maker.
 */
function proposeMasteryOrWait(input: AgentInput): TacticalMove {
  const ls = input.learnerState;
  const blockers: string[] = [];
  if (!ls.ruleGatePassed) blockers.push('rule_gate_not_passed');
  if (input.lesson.masteryConfig.requireExplainBackPass && !ls.explainBackPassed) {
    blockers.push('explain_back_not_passed');
  }
  if (!ls.topicGuardrailClean) blockers.push('topic_guardrail_exceeded');

  if (blockers.length === 0) {
    return {
      move: 'propose_mastery_transition',
      rationale: 'rule-gate + transfer + explain-back passed and topic-guardrail clean — proposing mastery (heuristic provider)',
    };
  }
  return {
    move: 'no_action',
    reason: 'wait_for_learner',
    rationale: `not proposing mastery; blockers: [${blockers.join(',')}] (heuristic provider)`,
  };
}

// NOTE: openingMove is now in ./introAdvance.ts (F-27 extraction for menu-lockstep:
// both HeuristicMoveProvider and OpenAIMoveProvider use the same opening-move logic
// for session_start and intro_advance).

/** Lesson 3 (NAND universality) constrains the circuit workspace to NAND only —
 *  the universality proof is "build any function from NAND alone", so the palette
 *  must offer NAND and nothing else. Returns the `allowedGates` restriction for a
 *  circuit `ProposedItem` on this lesson, or `undefined` (use the registry default
 *  AND/OR/NOT) for every other lesson. `allowedGates` is meaningful only for the
 *  circuit rep; the truth-table / pseudocode specs ignore it. */
function circuitAllowedGates(input: AgentInput, rep: ProposedItem['rep']): ProposedItem['allowedGates'] {
  if (rep !== 'circuit') return undefined;
  return input.lesson.content.lessonId === 3 ? ['NAND'] : undefined;
}

/** The lesson item the current submit concerns, as a `ProposedItem`. Identified by
 *  the submit's `itemId` only — matched against both the lesson `itemId` (e.g.
 *  "l1-and") and the item's `targetExpression` (e.g. "A AND B"), since the web
 *  client names the mounted item by its expression (the rep ComponentSpec carries
 *  no itemId). Crucially we do NOT identify by `ev.submission` — that's the
 *  learner's *answer*, which is wrong on a wrong submit and would misidentify the
 *  item. Null if the submit names no known item. */
function currentItem(input: AgentInput): ProposedItem | null {
  const ev = input.event;
  if (ev.kind !== 'submit') return null;
  const item = input.lesson.content.items.find(
    (i) => i.itemId === ev.itemId || i.targetExpression === ev.itemId,
  );
  if (!item) return null;
  const rep = ev.repSubmission ? ev.repSubmission.rep : 'truth_table';
  return {
    rep,
    targetExpression: item.targetExpression,
    claimedTruthTable: item.truthTable,
    visibleReps: [rep],
    allowedGates: circuitAllowedGates(input, rep),
    // F-27 AC#7: backfill prompt so rephrase/simpler moves never trip PromptMissing.
    prompt: defaultItemPrompt(item.targetExpression, rep),
  };
}

/**
 * If the current wrong submit is the recognisable halfway De Morgan misconception,
 * return its NAMED hint body; otherwise undefined (the caller falls back to a
 * generic rephrase). Pure-ish over `input` (it reads the lesson's misconception
 * bank from disk, fail-soft: a missing/invalid bank → undefined).
 *
 * The learner's truth-table OUTPUT column is read straight off the bounded
 * `repSubmission.cells` (0/1 ints, MSB-first) — we do NOT enumerate an expression,
 * so there is no var-cap DoS surface. The bank is matched by the lesson `itemId`;
 * the submit may name the item by itemId OR by targetExpression (the web mounts the
 * rep with no itemId), so we resolve to the lesson itemId first. The per-item
 * authored `hintBody` is preferred; absent it, the generic `L4_DEMORGAN_HINT`
 * still names the misconception.
 */
function detectHalfwayHint(input: AgentInput, submitItemId: string): string | undefined {
  const ev = input.event;
  if (ev.kind !== 'submit') return undefined;
  // Only a truth-table column can be matched against the authored halfway column;
  // a circuit/pseudocode submission has no MSB-first output vector to compare.
  if (!ev.repSubmission || ev.repSubmission.rep !== 'truth_table') return undefined;
  const learnerOutput = ev.repSubmission.cells;
  if (learnerOutput.length === 0) return undefined;

  // Resolve the lesson itemId (the bank's key) — the submit may name the item by
  // its targetExpression rather than its itemId.
  const lessonItem = input.lesson.content.items.find(
    (i) => i.itemId === submitItemId || i.targetExpression === submitItemId,
  );
  const itemId = lessonItem?.itemId ?? submitItemId;

  const bank = loadMisconceptions(input.lesson.content.lessonId);
  const matched = detectHalfwayMisconception(bank, itemId, learnerOutput);
  if (!matched) return undefined;
  // A detected halfway form gets its per-item named copy; if that copy is somehow
  // empty, fall back to the generic named hint so the misconception is still named —
  // never an empty body (a blank hint is worse than the generic one).
  return matched.hintBody.trim().length > 0 ? matched.hintBody : L4_DEMORGAN_HINT;
}

/** A simpler item than the given one: the lesson's lowest-tier item that differs
 *  from it; falls back to the same item if none is strictly simpler. */
function simplerVariant(current: ProposedItem, input: AgentInput): ProposedItem {
  const items = [...input.lesson.content.items].sort((a, b) => a.difficultyTier - b.difficultyTier);
  const simpler = items.find((i) => i.targetExpression !== current.targetExpression);
  if (!simpler) return current;
  return proposedItemFromLessonItem(input, simpler, current.rep);
}

type LessonItem = AgentInput['lesson']['content']['items'][number];

function proposedItemFromLessonItem(input: AgentInput, item: LessonItem, rep: Rep): ProposedItem {
  return {
    rep,
    targetExpression: item.targetExpression,
    claimedTruthTable: item.truthTable,
    visibleReps: [rep],
    allowedGates: circuitAllowedGates(input, rep),
    prompt: defaultItemPrompt(item.targetExpression, rep),
  };
}

/** Pick the next lesson item as a `next_practice_item` move, cycling through the
 *  lesson's items. The current item is identified by the submit's `itemId`,
 *  matched against both the lesson `itemId` and the `targetExpression` (the web
 *  names the item by its expression). Identifying by `itemId` (not the learner's
 *  answer `submission`) keeps advancing correct even on a near-miss answer. An
 *  unrecognised item starts the lesson from item 0. */
function pickLessonItem(input: AgentInput): TacticalMove | null {
  const items = input.lesson.content.items;
  if (items.length === 0) return null;
  const ev = input.event;
  const currentId = ev.kind === 'submit' ? ev.itemId : undefined;
  const idx = items.findIndex((i) => i.itemId === currentId || i.targetExpression === currentId);
  // No wrap: once the learner clears the last practice item, there is no next one
  // to serve — return null so the flow waits for the mastery/transfer path instead
  // of looping back to item 0 and re-teaching the lesson.
  const next = items[idx + 1];
  if (!next) return null;
  const rep = ev.kind === 'submit' && ev.repSubmission ? ev.repSubmission.rep : 'truth_table';
  return {
    move: 'next_practice_item',
    tier: next.difficultyTier,
    rationale: `advancing to "${next.itemId}" (heuristic provider)`,
    item: proposedItemFromLessonItem(input, next, rep),
  };
}

/** When the learner reaches the end of the authored item list before the rule gate
 *  passes, keep serving targeted practice instead of dead-ending. The all-KC gate
 *  requires every KC's BKT to clear the threshold; L1 has only one OR and one NOT
 *  authored item, so a clean first pass can legitimately need a second exposure.
 *  Pick the first below-threshold KC in lesson order, avoiding the just-submitted
 *  item when another item for that KC exists. */
function pickGateRepairItem(input: AgentInput): TacticalMove | null {
  const ev = input.event;
  if (ev.kind !== 'submit') return null;
  const items = input.lesson.content.items;
  if (items.length === 0) return null;

  const rep = ev.repSubmission ? ev.repSubmission.rep : 'truth_table';
  const threshold = input.lesson.masteryConfig.bktMasteryThreshold;
  const belowThreshold = input.lesson.content.knowledgeComponents.find(
    (kc) => (input.learnerState.bktByKc[kc] ?? 0) < threshold,
  );
  const currentId = ev.itemId;

  let item: LessonItem | undefined;
  if (belowThreshold) {
    const candidates = items.filter((i) => i.kc === belowThreshold);
    item =
      candidates.find((i) => i.itemId !== currentId && i.targetExpression !== currentId) ??
      candidates[0];
  }
  item ??= items.find((i) => i.itemId !== currentId && i.targetExpression !== currentId) ?? items[0];
  if (!item) return null;

  return {
    move: 'next_practice_item',
    tier: item.difficultyTier,
    rationale: `rule-gate still blocked — targeted practice for "${item.kc}" via "${item.itemId}" (heuristic provider)`,
    item: proposedItemFromLessonItem(input, item, rep),
  };
}

const BOOLEAN_TERMS = /\b(and|or|not|true|false|gate|circuit|truth\s*table|boolean|input|output|expression|xor|nand)\b/i;
function isBooleanTopic(q: string): boolean {
  return BOOLEAN_TERMS.test(q);
}

/** The F-01-era export name, preserved for the integration test + boot wiring.
 *  Now the heuristic (key-free) client driving the real flow. */
export class StubAgentClient extends FlowAgentClient {
  constructor() {
    super(new HeuristicMoveProvider());
  }
}
