import { describe, expect, it } from 'vitest';
import { loadLesson } from '../lessons/loader.js';
import { deriveState, recomputeCorrect, toLearnerState, type LoggedEvent } from './eventConsumer.js';
import { evaluateRuleGate } from './gate.js';

const { content, masteryConfig } = loadLesson(1);

// Correctness is recomputed server-side via @polymath/booleans, so a "correct"
// submit carries a submission equivalent to the item's target; a "wrong" one
// carries a non-equivalent expression. (No client `correct` flag is trusted.)
const RIGHT = { and: 'A AND B', or: 'A OR B', not: 'NOT A' };
const WRONG = 'A OR B'; // wrong for the AND item
// The CANONICAL target expressions the server mounts (must match content.json so the
// fold canonicalizes a mount's expression to the same item the submit names).
const AND_EXPR = 'B AND A'; // l1-and.targetExpression

type Rep3 = 'truth_table' | 'circuit' | 'pseudocode';

/** INTEGRITY: a server practice-mount turn carrying the SERVER-TRUSTED rep for an
 *  item — this is what the rep-gating fold credits, NOT the client `repSubmission.rep`.
 *  Mirrors how `toLoggedEvent` projects `mountedRep`/`mountedItemExpression` from the
 *  action the server actually emitted. Bind the trusted rep BEFORE the answering submit. */
function mountTurn(expression: string, rep: Rep3): LoggedEvent {
  return { kind: 'submit', mountedRep: rep, mountedItemExpression: expression };
}

/** A correct submit. `clientRep` is the (untrusted) client-declared rep label; the
 *  fold derives the trusted rep from the preceding `mountTurn`, not this. */
function correctSubmit(
  itemId: string,
  submission: string,
  ms: number,
  clientRep?: Rep3,
): LoggedEvent {
  return {
    kind: 'submit',
    itemId,
    submission,
    responseTimeMs: ms,
    ...(clientRep
      ? {
          repSubmission:
            clientRep === 'truth_table'
              ? { rep: clientRep, cells: submission === RIGHT.and ? [0, 0, 0, 1] : [0, 0, 1, 0] }
              : clientRep === 'circuit'
                ? { rep: clientRep, expression: submission, nodes: [], edges: [] }
                : { rep: clientRep, expression: submission, source: submission },
        }
      : {}),
  };
}

describe('deriveState (the single learner_state writer, pure core)', () => {
  it('updates BKT per KC on each correct submit (correctness recomputed server-side)', () => {
    const events: LoggedEvent[] = [
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and },
      { kind: 'submit', itemId: 'l1-or', submission: RIGHT.or },
    ];
    const d = deriveState(events, content, masteryConfig);
    expect(d.bktByKc['AND']!.pMastered).toBeGreaterThan(masteryConfig.bktPrior_L0);
    expect(d.bktByKc['OR']!.pMastered).toBeGreaterThan(masteryConfig.bktPrior_L0);
  });

  it('does NOT trust a client correct flag — a non-equivalent submission is wrong', () => {
    // Even though older clients sent `correct:true`, the server recomputes: this
    // submission is NOT equivalent to A AND B, so it does not advance the streak.
    const d = deriveState(
      [{ kind: 'submit', itemId: 'l1-and', submission: WRONG }],
      content,
      masteryConfig,
    );
    expect(d.consecutiveCorrect).toBe(0);
    expect(d.bktByKc['AND']!.pMastered).toBeLessThan(masteryConfig.bktPrior_L0);
  });

  it('scores truth-table submissions from output cells, not the echoed target expression', () => {
    expect(
      recomputeCorrect(content, 'l1-and', RIGHT.and, {
        rep: 'truth_table',
        cells: [0, 0, 0, 1],
      }),
    ).toBe(true);
    expect(
      recomputeCorrect(content, 'l1-and', RIGHT.and, {
        rep: 'truth_table',
        cells: [0, 1, 1, 1],
      }),
    ).toBe(false);
  });

  it('BUG-05: scores a truth-table submit when the client names the item by its DISPLAYED expression, not the authored targetExpression', () => {
    // PRODUCTION REPRO: the web client sends `itemId = spec.expression` — the
    // expression the agent/engine DISPLAYED ("A AND B"), which is commutatively
    // equivalent to but NOT string-equal to the authored item ("B AND A"). The old
    // lookup (`itemId === i.itemId || i.targetExpression === itemId`) found NO item
    // and returned false, so EVERY correct answer was scored wrong and the learner
    // could never progress. Correctness must come from the truth table of the
    // expression actually shown.
    expect(
      recomputeCorrect(content, 'A AND B', 'A AND B', { rep: 'truth_table', cells: [0, 0, 0, 1] }),
    ).toBe(true);
    expect(
      recomputeCorrect(content, 'A AND B', 'A AND B', { rep: 'truth_table', cells: [1, 1, 1, 0] }),
    ).toBe(false);
    // The OR item, named by its displayed expression, scored against its own table.
    expect(
      recomputeCorrect(content, 'A OR B', 'A OR B', { rep: 'truth_table', cells: [0, 1, 1, 1] }),
    ).toBe(true);
  });

  it('BUG-05: scores a pseudocode/circuit submit when the item is named by the displayed expression', () => {
    // Circuit/pseudocode submit: itemId = the displayed target expression, submission
    // = the learner's built expression. A correct, equivalent answer must score true
    // even when the displayed expression isn't string-equal to the authored one.
    expect(recomputeCorrect(content, 'A AND B', 'A AND B')).toBe(true);
    expect(recomputeCorrect(content, 'A AND B', 'B AND A')).toBe(true);
    expect(recomputeCorrect(content, 'A AND B', 'A OR B')).toBe(false);
  });

  it('counts consecutive correct, resetting on a wrong submit or a hint', () => {
    const d1 = deriveState(
      [
        { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and },
        { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and },
        { kind: 'submit', itemId: 'l1-and', submission: WRONG },
        { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and },
      ],
      content,
      masteryConfig,
    );
    expect(d1.consecutiveCorrect).toBe(1);

    const d2 = deriveState(
      [
        { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and },
        { kind: 'request_hint', itemId: 'l1-and', hintMounted: true }, // a SERVED hint
        { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and },
      ],
      content,
      masteryConfig,
    );
    expect(d2.consecutiveCorrect).toBe(1); // the served hint reset the streak
    expect(d2.hintsUsed).toBe(1);
  });

  it('a request_hint that was REFUSED (no HintCard mounted) does not count', () => {
    const d = deriveState(
      [
        { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and },
        { kind: 'request_hint', itemId: 'l1-and' }, // hintMounted falsy → refused
        { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and },
      ],
      content,
      masteryConfig,
    );
    expect(d.hintsUsed).toBe(0); // refused hint doesn't poison the gate
    expect(d.consecutiveCorrect).toBe(2); // streak intact
  });

  it('counts retries (a repeat after a miss on the same item) and a transfer pass', () => {
    const d = deriveState(
      [
        { kind: 'submit', itemId: 'l1-and', submission: WRONG },
        { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and }, // retry after a miss
        { kind: 'transfer_submitted', itemId: 'L1-01', transferCorrect: true },
      ],
      content,
      masteryConfig,
    );
    expect(d.retries).toBe(1);
    expect(d.transferPassed).toBe(true);
  });

  it('AND-only practice BLOCKS the gate — OR and NOT sit unpracticed at prior (all-KC fix)', () => {
    // A clean 3-correct AND streak drives AND's BKT past threshold, but the gate
    // now requires EVERY lesson KC (AND, OR, NOT) to clear it — not just the best
    // one (the old Math.max bug let practicing only AND mint mastery of OR + NOT).
    const events: LoggedEvent[] = [
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 5000 },
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 6000 },
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 4000 },
    ];
    const ls = toLearnerState(deriveState(events, content, masteryConfig), masteryConfig);
    expect(ls.bktByKc['AND']).toBeGreaterThanOrEqual(masteryConfig.bktMasteryThreshold);
    // OR and NOT are pre-seeded at prior and never practiced → below threshold.
    expect(ls.bktByKc['OR']).toBeLessThan(masteryConfig.bktMasteryThreshold);
    expect(ls.bktByKc['NOT']).toBeLessThan(masteryConfig.bktMasteryThreshold);
    const gate = evaluateRuleGate(ls, masteryConfig);
    expect(gate.passed).toBe(false);
    expect(gate.blockers).toContain('bkt_below_threshold');
  });

  it('clean 3-correct on ALL THREE KCs across TWO reps (in-band times) drives the rule gate to passed', () => {
    // The positive case: every KC must be practiced to clear the all-KC BKT check.
    // Two corrects per KC clears 0.95 from prior; the streak/timing come from the
    // hardest-tier items. L1 is single-tier, so any correct submit counts. #1: the
    // hardest-tier ladder must now span ≥2 reps, so the closing AND ladder is
    // INTERLEAVED across truth_table / circuit / pseudocode (#3 produces exactly
    // this rep-varying ladder).
    // The AND ladder spans ≥2 reps because the SERVER MOUNTED different reps for the
    // AND item across the ladder (the trusted signal) — each mount turn precedes the
    // submit that answers it (#3 produces exactly this rep-rotating ladder).
    const events: LoggedEvent[] = [
      correctSubmit('l1-or', RIGHT.or, 5000),
      correctSubmit('l1-or', RIGHT.or, 5200),
      correctSubmit('l1-not', RIGHT.not, 4800),
      correctSubmit('l1-not', RIGHT.not, 5100),
      mountTurn(AND_EXPR, 'truth_table'),
      correctSubmit('l1-and', RIGHT.and, 5000, 'truth_table'),
      mountTurn(AND_EXPR, 'circuit'),
      correctSubmit('l1-and', RIGHT.and, 6000, 'circuit'),
      mountTurn(AND_EXPR, 'pseudocode'),
      correctSubmit('l1-and', RIGHT.and, 4000, 'pseudocode'),
    ];
    const ls = toLearnerState(deriveState(events, content, masteryConfig), masteryConfig);
    expect(ls.bktByKc['AND']).toBeGreaterThanOrEqual(masteryConfig.bktMasteryThreshold);
    expect(ls.bktByKc['OR']).toBeGreaterThanOrEqual(masteryConfig.bktMasteryThreshold);
    expect(ls.bktByKc['NOT']).toBeGreaterThanOrEqual(masteryConfig.bktMasteryThreshold);
    expect(ls.distinctRepsAtHardestTier).toBeGreaterThanOrEqual(2);
    expect(evaluateRuleGate(ls, masteryConfig).passed).toBe(true);
  });

  it('#1 tracks distinct reps from the SERVER-MOUNTED rep (not the client label)', () => {
    // Single rep: the server mounted truth_table both times → one distinct rep.
    const single = deriveState(
      [
        mountTurn(AND_EXPR, 'truth_table'),
        correctSubmit('l1-and', RIGHT.and, 5000, 'truth_table'),
        mountTurn(AND_EXPR, 'truth_table'),
        correctSubmit('l1-and', RIGHT.and, 5000, 'truth_table'),
      ],
      content,
      masteryConfig,
    );
    expect(single.repsCorrectAtHardestTier.size).toBe(1);
    // Genuinely different MOUNTED reps (server mounted truth_table, then circuit) → two.
    const multi = deriveState(
      [
        mountTurn(AND_EXPR, 'truth_table'),
        correctSubmit('l1-and', RIGHT.and, 5000, 'truth_table'),
        mountTurn(AND_EXPR, 'circuit'),
        correctSubmit('l1-and', RIGHT.and, 5000, 'circuit'),
      ],
      content,
      masteryConfig,
    );
    expect([...multi.repsCorrectAtHardestTier].sort()).toEqual(['circuit', 'truth_table']);
  });

  it('#1 INTEGRITY: a FORGED client rep label on a single server-mounted rep does NOT fake interleaving', () => {
    // The attack (this finding): the server only ever MOUNTED truth_table for l1-and,
    // but a scripted client cycles `repSubmission.rep` truth_table→circuit→pseudocode
    // on the SAME correct expression. Distinct (item, CLIENT-rep) keys would (pre-fix)
    // credit each as interleaved and reach ≥2 reps. With the server-trusted rep, all
    // three resolve to the MOUNTED truth_table → ONE distinct rep, and the massed-repeat
    // dedupe declines the 2nd/3rd → the ladder does not climb and single_representation
    // still blocks.
    const d = deriveState(
      [
        mountTurn(AND_EXPR, 'truth_table'),
        correctSubmit('l1-and', RIGHT.and, 5000, 'truth_table'),
        correctSubmit('l1-and', RIGHT.and, 5000, 'circuit'), // forged client label
        correctSubmit('l1-and', RIGHT.and, 5000, 'pseudocode'), // forged client label
      ],
      content,
      masteryConfig,
    );
    expect(d.repsCorrectAtHardestTier.size).toBe(1);
    expect([...d.repsCorrectAtHardestTier]).toEqual(['truth_table']);
    expect(d.consecutiveCorrectAtHardestTier).toBe(1); // massed repeats not credited
    const ls = toLearnerState(d, masteryConfig);
    expect(ls.distinctRepsAtHardestTier).toBe(1);
    expect(evaluateRuleGate(ls, masteryConfig).blockers).toContain('single_representation');
  });

  it('#1 FAIL-CLOSED: a submit with NO known server-mounted rep defaults to single-rep (truth_table), not a new distinct rep', () => {
    // No mount turn precedes these submits → the fold cannot prove a rep → it must NOT
    // credit a "different" rep. Both resolve to the safe truth_table default.
    const d = deriveState(
      [
        correctSubmit('l1-and', RIGHT.and, 5000, 'circuit'),
        correctSubmit('l1-review-mix', 'A AND NOT B', 5000, 'pseudocode'),
      ],
      content,
      masteryConfig,
    );
    expect(d.repsCorrectAtHardestTier.size).toBe(1);
    expect([...d.repsCorrectAtHardestTier]).toEqual(['truth_table']);
  });

  it('#2 does NOT credit a massed identical (item,rep) repeat to the hardest-tier ladder', () => {
    // Three correct submits on the IDENTICAL (l1-and, truth_table) back-to-back are a
    // massed/blocked repeat — a memorized answer. Only the FIRST counts; the ladder
    // stays at 1, not 3, and only one rep is demonstrated.
    const same: LoggedEvent = {
      kind: 'submit',
      itemId: 'l1-and',
      submission: RIGHT.and,
      responseTimeMs: 5000,
      repSubmission: { rep: 'truth_table', cells: [0, 0, 0, 1] },
    };
    const d = deriveState([same, same, same], content, masteryConfig);
    expect(d.consecutiveCorrectAtHardestTier).toBe(1);
    expect(d.repsCorrectAtHardestTier.size).toBe(1);
  });

  it('#2 DOES credit interleaved correct submits (different item OR rep between repeats)', () => {
    const tt = (itemId: string): LoggedEvent => ({
      kind: 'submit',
      itemId,
      submission: itemId === 'l1-and' ? RIGHT.and : 'A AND NOT B',
      responseTimeMs: 5000,
      repSubmission: { rep: 'truth_table', cells: itemId === 'l1-and' ? [0, 0, 0, 1] : [0, 0, 1, 0] },
    });
    // l1-and and l1-review-mix are both tier-1 AND items (the hardest tier in L1):
    // alternating between them is interleaved, so every correct submit credits.
    const d = deriveState([tt('l1-and'), tt('l1-review-mix'), tt('l1-and')], content, masteryConfig);
    expect(d.consecutiveCorrectAtHardestTier).toBe(3);
  });

  it('#2 a hint between two identical (item,rep) submits re-opens crediting (break in massing)', () => {
    const same: LoggedEvent = {
      kind: 'submit',
      itemId: 'l1-and',
      submission: RIGHT.and,
      responseTimeMs: 5000,
      repSubmission: { rep: 'truth_table', cells: [0, 0, 0, 1] },
    };
    // A served hint resets the ladder to 0; the post-hint correct submit starts a
    // fresh ladder at 1 (the hint cost the streak, but the repeat is no longer
    // "massed" against a pre-hint key).
    const d = deriveState(
      [same, { kind: 'request_hint', itemId: 'l1-and', hintMounted: true }, same],
      content,
      masteryConfig,
    );
    expect(d.consecutiveCorrectAtHardestTier).toBe(1);
    expect(d.repsCorrectAtHardestTier.size).toBe(1);
  });

  it('a sub-floor response time blocks the gate (gaming guard, ADR-011 2s floor)', () => {
    const events: LoggedEvent[] = [
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 500 },
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 600 },
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 700 },
    ];
    const gate = evaluateRuleGate(toLearnerState(deriveState(events, content, masteryConfig), masteryConfig), masteryConfig);
    expect(gate.passed).toBe(false);
    expect(gate.blockers).toContain('response_time_out_of_band');
  });

  it('a hinty session is blocked by the hint ratio', () => {
    const events: LoggedEvent[] = [
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 5000 },
      { kind: 'request_hint', itemId: 'l1-and', hintMounted: true },
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 6000 },
    ];
    const gate = evaluateRuleGate(toLearnerState(deriveState(events, content, masteryConfig), masteryConfig), masteryConfig);
    expect(gate.passed).toBe(false);
    expect(gate.blockers).toContain('hint_ratio_exceeded');
  });

  // F-11 → F-12 seam: a persisted PASSING explain-back verdict must flip the
  // derived `explainBackPassed` to true. This is the input F-12's mastery gate
  // reads. Fails closed: a session with no explain_back_recording_ended stays false.
  it('explainBackPassed stays false with no explain-back event (fail closed)', () => {
    const d = deriveState(
      [{ kind: 'submit', itemId: 'l1-and', submission: RIGHT.and }],
      content,
      masteryConfig,
    );
    expect(d.explainBackPassed).toBe(false);
    expect(toLearnerState(d, masteryConfig).explainBackPassed).toBe(false);
  });

  it('a logged PASSING explain-back verdict flips explainBackPassed to true', () => {
    const d = deriveState(
      [
        { kind: 'transfer_submitted', itemId: 'L1-01', transferCorrect: true },
        { kind: 'explain_back_recording_ended', itemId: 'L1-01', explainBackPassed: true },
      ],
      content,
      masteryConfig,
    );
    expect(d.explainBackPassed).toBe(true);
    expect(toLearnerState(d, masteryConfig).explainBackPassed).toBe(true);
  });

  it('a logged FAILING explain-back verdict leaves explainBackPassed false (fail closed)', () => {
    const d = deriveState(
      [{ kind: 'explain_back_recording_ended', itemId: 'L1-01', explainBackPassed: false }],
      content,
      masteryConfig,
    );
    expect(d.explainBackPassed).toBe(false);
  });
});

describe('F-12 topic-guardrail counter (the real fold, NOT a hand-set LearnerState)', () => {
  it('counts ONLY off-topic answer_question events the AGENT gave; on-topic answers do not', () => {
    const events: LoggedEvent[] = [
      { kind: 'learner_question', offTopic: false }, // on-topic answer
      { kind: 'learner_question', offTopic: true }, // off-topic answer #1
      { kind: 'learner_question', offTopic: false },
      { kind: 'learner_question', offTopic: true }, // #2
    ];
    const d = deriveState(events, content, masteryConfig);
    expect(d.offTopicCount).toBe(2);
  });

  it('a learner_question without an off-topic flag (refused/on-topic) does not increment', () => {
    const d = deriveState(
      [
        { kind: 'learner_question' }, // no off-topic flag — does not count
        { kind: 'learner_question', offTopic: false },
      ],
      content,
      masteryConfig,
    );
    expect(d.offTopicCount).toBe(0);
  });

  it('toLearnerState keeps topicGuardrailClean=true while off-topic count is within budget', () => {
    // budget = 3 in lesson 1 config; 3 off-topic answers is AT the budget (<=), still clean.
    const events: LoggedEvent[] = [
      { kind: 'learner_question', offTopic: true },
      { kind: 'learner_question', offTopic: true },
      { kind: 'learner_question', offTopic: true },
    ];
    const ls = toLearnerState(deriveState(events, content, masteryConfig), masteryConfig);
    expect(ls.topicGuardrailClean).toBe(true);
  });

  it('toLearnerState flips topicGuardrailClean=false once off-topic count EXCEEDS the budget', () => {
    const events: LoggedEvent[] = [
      { kind: 'learner_question', offTopic: true },
      { kind: 'learner_question', offTopic: true },
      { kind: 'learner_question', offTopic: true },
      { kind: 'learner_question', offTopic: true }, // 4 > budget 3
    ];
    const ls = toLearnerState(deriveState(events, content, masteryConfig), masteryConfig);
    expect(ls.topicGuardrailClean).toBe(false);
  });

  it('a clean session (no off-topic answers) leaves topicGuardrailClean=true', () => {
    const ls = toLearnerState(deriveState([], content, masteryConfig), masteryConfig);
    expect(ls.topicGuardrailClean).toBe(true);
  });
});

describe('F-12 explain-back fold (the real fold over a MOCKED verdict, never the live judge)', () => {
  it('a folded explain_back_recording_ended with passed:true sets explainBackPassed', () => {
    const events: LoggedEvent[] = [
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and },
      { kind: 'explain_back_recording_ended', explainBackPassed: true },
    ];
    const d = deriveState(events, content, masteryConfig);
    expect(d.explainBackPassed).toBe(true);
    expect(toLearnerState(d, masteryConfig).explainBackPassed).toBe(true);
  });

  it('FAIL-CLOSED: NO explain_back turn → explainBackPassed stays false (block, never pass)', () => {
    const d = deriveState([{ kind: 'submit', itemId: 'l1-and', submission: RIGHT.and }], content, masteryConfig);
    expect(d.explainBackPassed).toBe(false);
    expect(toLearnerState(d, masteryConfig).explainBackPassed).toBe(false);
  });

  it('FAIL-CLOSED: an explain_back turn with passed:false (e.g. judge_unavailable) stays false', () => {
    const d = deriveState(
      [{ kind: 'explain_back_recording_ended', explainBackPassed: false }],
      content,
      masteryConfig,
    );
    expect(d.explainBackPassed).toBe(false);
  });

  it('once passed, a later non-passing explain-back turn does NOT un-set it (latching pass)', () => {
    const d = deriveState(
      [
        { kind: 'explain_back_recording_ended', explainBackPassed: true },
        { kind: 'explain_back_recording_ended', explainBackPassed: false },
      ],
      content,
      masteryConfig,
    );
    expect(d.explainBackPassed).toBe(true);
  });
});
