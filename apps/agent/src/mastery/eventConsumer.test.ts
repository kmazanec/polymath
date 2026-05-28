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
        { kind: 'request_hint', itemId: 'l1-and' },
        { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and },
      ],
      content,
      masteryConfig,
    );
    expect(d2.consecutiveCorrect).toBe(1); // the hint reset the streak
    expect(d2.hintsUsed).toBe(1);
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
      { kind: 'request_hint', itemId: 'l1-and' },
      { kind: 'submit', itemId: 'l1-and', submission: RIGHT.and, responseTimeMs: 6000 },
    ];
    const gate = evaluateRuleGate(toLearnerState(deriveState(events, content, masteryConfig)), masteryConfig);
    expect(gate.passed).toBe(false);
    expect(gate.blockers).toContain('hint_ratio_exceeded');
  });
});
