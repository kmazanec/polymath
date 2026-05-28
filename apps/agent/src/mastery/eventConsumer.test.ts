import { describe, expect, it } from 'vitest';
import { loadLesson } from '../lessons/loader.js';
import { deriveState, toLearnerState, type LoggedEvent } from './eventConsumer.js';
import { evaluateRuleGate } from './gate.js';

const { content, masteryConfig } = loadLesson(1);

// Correctness is recomputed server-side via @polymath/booleans, so a "correct"
// submit carries a submission equivalent to the item's target; a "wrong" one
// carries a non-equivalent expression. (No client `correct` flag is trusted.)
const RIGHT = { and: 'A AND B', or: 'A OR B', not: 'NOT A' };
const WRONG = 'A OR B'; // wrong for the AND item

describe('deriveState (the single learner_state writer, pure core)', () => {
  it('updates BKT per KC on each correct submit (correctness recomputed server-side)', () => {
    const events: LoggedEvent[] = [
      { kind: 'submit', itemId: 'A AND B', submission: RIGHT.and },
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

  it('a clean 3-correct AND streak (in-band response times) drives the rule gate to passed', () => {
    const events: LoggedEvent[] = [
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 5000 },
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 6000 },
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 4000 },
    ];
    const ls = toLearnerState(deriveState(events, content, masteryConfig));
    expect(ls.bktByKc['AND']).toBeGreaterThanOrEqual(masteryConfig.bktMasteryThreshold);
    expect(evaluateRuleGate(ls, masteryConfig).passed).toBe(true);
  });

  it('a sub-floor response time blocks the gate (gaming guard, ADR-011 2s floor)', () => {
    const events: LoggedEvent[] = [
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 500 },
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 600 },
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 700 },
    ];
    const gate = evaluateRuleGate(toLearnerState(deriveState(events, content, masteryConfig)), masteryConfig);
    expect(gate.passed).toBe(false);
    expect(gate.blockers).toContain('response_time_out_of_band');
  });

  it('a hinty session is blocked by the hint ratio', () => {
    const events: LoggedEvent[] = [
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 5000 },
      { kind: 'request_hint', itemId: 'l1-and', hintMounted: true },
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 6000 },
    ];
    const gate = evaluateRuleGate(toLearnerState(deriveState(events, content, masteryConfig)), masteryConfig);
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
    expect(toLearnerState(d).explainBackPassed).toBe(false);
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
    expect(toLearnerState(d).explainBackPassed).toBe(true);
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
